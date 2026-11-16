import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Config, mcpRoot } from "./config.js";

/**
 * Nhật ký gọi tool: mỗi lần gọi 1 dòng JSON trong <logDir>/YYYY-MM.jsonl.
 * Chỉ ghi tham số trong danh sách cho phép; không ghi token, câu SQL, nội dung comment, nguyên nhân.
 * Lỗi của tool khác db_* ghi 300 ký tự đầu (có thể gồm URL, body lỗi HTTP, stderr git; không có token).
 * Không bao giờ ném lỗi ra ngoài.
 */

const SAFE_ARGS = [
  "key",
  "issueKey",
  "repo",
  "kind",
  "base",
  "to",
  "targets",
  "targetBranch",
  "sourceBranch",
  "db",
  "table",
  "name",
  "keyword",
  "scope",
  "maxRows",
  "maxResults",
];

/** Giờ địa phương kèm múi giờ, khớp với tên file theo tháng */
function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const tz = `${off >= 0 ? "+" : "-"}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${tz}`;
}

export function logDir(cfg: Config | null): string {
  return cfg?.logDir ? resolve(cfg.logDir) : join(mcpRoot(), "logs");
}

export function audit(
  cfg: Config | null,
  tool: string,
  args: unknown,
  result: { isError?: boolean; content?: { text?: string }[] },
  ms: number,
  extra?: Record<string, unknown>,
) {
  try {
    const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    const safe: Record<string, unknown> = {};
    for (const k of SAFE_ARGS) if (a[k] !== undefined) safe[k] = a[k];
    if (typeof a.sql === "string") safe.sqlLength = a.sql.length;
    // tool git/PR chỉ nhận repo: lấy mã ticket từ tên nhánh trong kết quả
    let ticket = (a.key ?? a.issueKey) as string | undefined;
    if (!ticket && !result?.isError) {
      try {
        const out = JSON.parse(result.content?.[0]?.text ?? "");
        ticket = String(out.branch ?? out.from ?? "").match(/[A-Z][A-Z0-9_]+-\d+$/)?.[0];
      } catch {
        /* kết quả không phải JSON */
      }
    }
    const d = new Date();
    const entry = {
      ts: localIso(d),
      user: cfg?.git.user,
      tool,
      ticket: ticket?.toUpperCase(),
      args: safe,
      ok: !result?.isError,
      ms,
      // lỗi SQL Server có thể chứa đoạn câu lệnh/giá trị: với db_* không ghi chi tiết
      error: result?.isError
        ? tool.startsWith("db_")
          ? "(lỗi DB, không ghi chi tiết)"
          : (result.content?.[0]?.text ?? "").replace(/\/\/[^/@\s]+@/g, "//***@").slice(0, 300)
        : undefined,
      ...extra,
    };
    const dir = logDir(cfg);
    mkdirSync(dir, { recursive: true });
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    appendFileSync(join(dir, `${month}.jsonl`), JSON.stringify(entry) + "\n", "utf8");
  } catch {
    /* ghi log hỏng không được chặn tool */
  }
}
