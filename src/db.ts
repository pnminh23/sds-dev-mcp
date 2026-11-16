import sql from "mssql";
import { Config, DbConfig, requireValue } from "./config.js";

/**
 * Truy vấn DB local/test, CHỈ ĐỌC.
 * Nhiều lớp bảo vệ:
 *  1. checkReadOnly: chỉ cho 1 câu SELECT / WITH ... SELECT, chặn mọi từ khóa ghi/DDL/EXEC/INTO.
 *  2. Chạy trong transaction và luôn ROLLBACK.
 *  3. Kết nối với ApplicationIntent=ReadOnly.
 *  4. Khuyến nghị dùng login chỉ có quyền db_datareader (lớp chắc chắn nhất, do DBA cấp).
 *  5. blockedDbHosts: không bao giờ kết nối các host này (vd DB production).
 */

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|DENY|INTO|BACKUP|RESTORE|DBCC|SHUTDOWN|KILL|RECONFIGURE|OPENROWSET|OPENQUERY|OPENDATASOURCE|OPENXML|BULK|WAITFOR|USE|SET|DECLARE|GO|COMMIT|ROLLBACK|BEGIN|SAVE|DISABLE|ENABLE|CHECKPOINT|SEND|RECEIVE)\b/i;
const SYSTEM_PROC = /\b(sp|xp)_\w+/i;

/** Bỏ comment, chuỗi, tên trong [] và "" để quét từ khóa không bị lừa. */
function normalize(q: string): string {
  let out = "";
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    const n = q[i + 1];
    if (c === "-" && n === "-") {
      while (i < q.length && q[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (c === "/" && n === "*") {
      const e = q.indexOf("*/", i + 2);
      if (e < 0) throw new Error("Comment /* chưa đóng.");
      i = e + 2;
      out += " ";
      continue;
    }
    if (c === "'") {
      i++;
      for (;;) {
        if (i >= q.length) throw new Error("Chuỗi '...' chưa đóng.");
        if (q[i] === "'") {
          if (q[i + 1] === "'") {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      out += "''";
      continue;
    }
    if (c === "[") {
      const e = q.indexOf("]", i);
      if (e < 0) throw new Error("Dấu [ chưa đóng.");
      i = e + 1;
      out += "[x]";
      continue;
    }
    if (c === '"') {
      const e = q.indexOf('"', i + 1);
      if (e < 0) throw new Error('Dấu " chưa đóng.');
      i = e + 1;
      out += '""';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function checkReadOnly(query: string): void {
  const s = normalize(query).trim().replace(/;\s*$/, "");
  if (!/^(SELECT|WITH)\b/i.test(s)) {
    throw new Error("Chỉ được chạy câu SELECT (hoặc WITH ... SELECT). DB này chỉ đọc.");
  }
  if (s.includes(";")) throw new Error("Chỉ được chạy 1 câu lệnh mỗi lần.");
  const m = s.match(FORBIDDEN) ?? s.match(SYSTEM_PROC);
  if (m) {
    throw new Error(
      `Câu lệnh chứa "${m[0]}" không được phép. DB chỉ được SELECT; cần sửa dữ liệu thì đưa câu SQL cho user tự chạy.`,
    );
  }
}

function getDb(cfg: Config, name: string): DbConfig {
  const db = cfg.databases[name];
  if (!db) {
    const known = Object.keys(cfg.databases).join(", ") || "(chưa cấu hình DB nào)";
    throw new Error(`Không có DB "${name}". DB đã cấu hình: ${known}.`);
  }
  const host = db.server.toLowerCase();
  if (cfg.blockedDbHosts.some((h) => h.toLowerCase() === host)) {
    throw new Error(`Host ${db.server} nằm trong blockedDbHosts (DB production?), không kết nối.`);
  }
  requireValue(db.password, `databases.${name}.password`);
  return db;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  ms: number;
}

function cell(v: unknown, full = false): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return `0x${v.subarray(0, 32).toString("hex")}${v.length > 32 ? "…" : ""}`;
  if (!full && typeof v === "string" && v.length > 1000) return v.slice(0, 1000) + `… (${v.length} ký tự)`;
  return v;
}

/** Chạy SELECT nội bộ (đã kiểm tra) trong transaction luôn rollback, giới hạn số dòng bằng SET ROWCOUNT. */
async function run(
  db: DbConfig,
  query: string,
  params: Record<string, string> = {},
  maxRows = 200,
  timeoutMs = 30_000,
  fullStrings = false,
): Promise<QueryResult> {
  const pool = new sql.ConnectionPool({
    server: db.server,
    port: db.port ?? 1433,
    database: db.database,
    user: db.user,
    password: db.password,
    connectionTimeout: 15_000,
    requestTimeout: timeoutMs,
    pool: { max: 1, min: 0 },
    options: {
      encrypt: db.encrypt ?? false,
      trustServerCertificate: db.trustServerCertificate ?? true,
      readOnlyIntent: true,
      appName: "sds-dev-mcp (read-only)",
    },
  });
  await pool.connect();
  const tx = new sql.Transaction(pool);
  const t0 = Date.now();
  try {
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    const req = new sql.Request(tx);
    for (const [k, v] of Object.entries(params)) req.input(k, sql.NVarChar, v);
    const res = await req.query(`SET LOCK_TIMEOUT 10000; SET ROWCOUNT ${maxRows + 1};\n${query}`);
    const rs = (res.recordsets as unknown as any[])[0] ?? [];
    const columns = rs.columns ? Object.keys(rs.columns) : rs[0] ? Object.keys(rs[0]) : [];
    const truncated = rs.length > maxRows;
    const rows = (truncated ? rs.slice(0, maxRows) : rs).map((r: Record<string, unknown>) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) o[k] = cell(v, fullStrings);
      return o;
    });
    return { columns, rows, rowCount: rows.length, truncated, ms: Date.now() - t0 };
  } finally {
    await tx.rollback().catch(() => undefined);
    await pool.close().catch(() => undefined);
  }
}

export function listDatabases(cfg: Config) {
  return Object.entries(cfg.databases).map(([name, d]) => ({
    name,
    server: d.server,
    database: d.database,
    user: d.user,
    note: d.note,
    passwordConfigured: !!d.password && !d.password.startsWith("DAN_"),
  }));
}

export async function query(cfg: Config, name: string, text: string, maxRows = 200) {
  checkReadOnly(text);
  return run(getDb(cfg, name), text, {}, Math.min(Math.max(maxRows, 1), 2000));
}

export async function describeTable(cfg: Config, name: string, table: string) {
  const db = getDb(cfg, name);
  const p = { t: table };
  const cols = await run(
    db,
    `SELECT c.name AS col, t.name AS type, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity,
            dc.definition AS default_value
       FROM sys.columns c
       JOIN sys.types t ON t.user_type_id = c.user_type_id
       LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
      WHERE c.object_id = OBJECT_ID(@t)
      ORDER BY c.column_id`,
    p,
    1000,
  );
  if (!cols.rowCount) throw new Error(`Không tìm thấy bảng/view "${table}" trong ${db.database}.`);

  const idx = await run(
    db,
    `SELECT i.name AS idx, i.type_desc, i.is_unique, i.is_primary_key, c.name AS col, ic.is_included_column,
            i.filter_definition
       FROM sys.indexes i
       JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.object_id = OBJECT_ID(@t)
      ORDER BY i.name, ic.is_included_column, ic.key_ordinal`,
    p,
    1000,
  );
  const indexes: Record<string, any> = {};
  for (const r of idx.rows as any[]) {
    const x = (indexes[r.idx] ??= {
      name: r.idx,
      type: r.type_desc,
      unique: r.is_unique,
      primaryKey: r.is_primary_key,
      keys: [] as string[],
      include: [] as string[],
      filter: r.filter_definition ?? undefined,
    });
    (r.is_included_column ? x.include : x.keys).push(r.col);
  }

  const checks = await run(
    db,
    `SELECT name, definition FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(@t)`,
    p,
  );
  const fks = await run(
    db,
    `SELECT fk.name, COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS col,
            OBJECT_NAME(fkc.referenced_object_id) AS ref_table,
            COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS ref_col
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      WHERE fk.parent_object_id = OBJECT_ID(@t)`,
    p,
  );
  const cnt = await run(
    db,
    `SELECT SUM(p.rows) AS approx_rows FROM sys.partitions p WHERE p.object_id = OBJECT_ID(@t) AND p.index_id IN (0, 1)`,
    p,
  );

  return {
    table,
    database: db.database,
    approxRows: (cnt.rows[0] as any)?.approx_rows,
    columns: cols.rows,
    indexes: Object.values(indexes),
    checkConstraints: checks.rows,
    foreignKeys: fks.rows,
  };
}

export async function findObjects(cfg: Config, name: string, keyword: string) {
  const db = getDb(cfg, name);
  const p = { k: `%${keyword}%` };
  const objects = await run(
    db,
    `SELECT TOP 100 o.type_desc AS type, SCHEMA_NAME(o.schema_id) + '.' + o.name AS name
       FROM sys.objects o
      WHERE o.name LIKE @k AND o.type IN ('U', 'V', 'P', 'FN', 'IF', 'TF', 'TR')
      ORDER BY o.type_desc, o.name`,
    p,
    100,
  );
  const columns = await run(
    db,
    `SELECT TOP 100 OBJECT_NAME(c.object_id) AS [table], c.name AS col
       FROM sys.columns c
       JOIN sys.tables t ON t.object_id = c.object_id
      WHERE c.name LIKE @k
      ORDER BY 1, 2`,
    p,
    100,
  );
  return { objects: objects.rows, columns: columns.rows };
}

export async function objectSource(cfg: Config, name: string, objectName: string) {
  const db = getDb(cfg, name);
  const r = await run(db, `SELECT OBJECT_DEFINITION(OBJECT_ID(@n)) AS def`, { n: objectName }, 1, 30_000, true);
  const def = (r.rows[0] as any)?.def;
  if (!def) throw new Error(`Không lấy được mã nguồn "${objectName}" (không tồn tại hoặc login thiếu quyền VIEW DEFINITION).`);
  return def as string;
}
