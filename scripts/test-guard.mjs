// Kiểm tra bộ chặn SQL chỉ-đọc: node scripts/test-guard.mjs
import { checkReadOnly } from "../dist/db.js";
const allow = [
  "SELECT TOP 10 * FROM SAInvoice WHERE CompanyID = 'x'",
  "select * from RepositoryLedger with (nolock) where RefID = 'a;b'",
  "WITH x AS (SELECT 1 a) SELECT * FROM x;",
  "SELECT [Update], UpdatedDate FROM T -- delete from T",
  "SELECT 'drop table x' AS note",
  "SELECT * FROM T FOR JSON PATH",
];
const deny = [
  "UPDATE SAInvoice SET A = 1",
  "DELETE FROM T",
  "SELECT 1; DELETE FROM T",
  "SELECT 1 DELETE FROM T",
  "SELECT * INTO NewT FROM T",
  "EXEC Proc_TONG_HOP_TON_KHO",
  "SELECT * FROM OPENROWSET('x','y','z')",
  "WITH x AS (SELECT 1 a) DELETE FROM x",
  "SELECT 1 /* */ ; DROP TABLE T",
  "INSERT INTO T VALUES (1)",
  "SELECT * FROM T; WAITFOR DELAY '00:01'",
  "SELECT dbo.f() EXEC sp_who",
  "MERGE T USING S ON 1=1 WHEN MATCHED THEN DELETE;",
  "TRUNCATE TABLE T",
  "SELECT 1 GO DROP TABLE T",
];
let bad = 0;
for (const q of allow) { try { checkReadOnly(q); } catch (e) { bad++; console.log("SAI (bị chặn nhầm):", q, "->", e.message); } }
for (const q of deny) { try { checkReadOnly(q); bad++; console.log("SAI (lọt):", q); } catch {} }
console.log(bad ? `${bad} trường hợp sai` : `OK: ${allow.length} câu được phép, ${deny.length} câu bị chặn`);
process.exit(bad ? 1 : 0);
