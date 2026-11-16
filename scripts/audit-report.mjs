// Tổng hợp nhật ký gọi tool: node scripts/audit-report.mjs [YYYY-MM] [thư mục log]
// Mặc định: tháng hiện tại, thư mục logs/ của MCP (hoặc logDir trong config.local.json).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let dir = join(root, "logs");
try {
  const cfg = JSON.parse(readFileSync(process.env.SDS_MCP_CONFIG ?? join(root, "config.local.json"), "utf8"));
  if (cfg.logDir) dir = resolve(cfg.logDir);
} catch {
  /* dùng mặc định */
}
const d = new Date();
const month = process.argv[2] ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
if (process.argv[3]) dir = resolve(process.argv[3]);
const file = join(dir, `${month}.jsonl`);
if (!existsSync(file)) {
  console.log(`Chưa có nhật ký ${file}`);
  process.exit(0);
}

const rows = readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const byTool = {};
const errors = {};
const tickets = {};
for (const r of rows) {
  const t = (byTool[r.tool] ??= { calls: 0, errors: 0, ms: 0 });
  t.calls++;
  t.ms += r.ms ?? 0;
  if (!r.ok) {
    t.errors++;
    const msg = `${r.tool}: ${(r.error ?? "").split("\n")[0].slice(0, 120)}`;
    errors[msg] = (errors[msg] ?? 0) + 1;
  }
  const key = r.ticket ?? r.args?.key ?? r.args?.issueKey;
  if (key) {
    const k = (tickets[key] ??= { calls: 0, startBranch: 0, inReview: 0 });
    k.calls++;
    if (r.tool === "git_start_branch" && r.ok) k.startBranch++;
    if (r.tool === "jira_transition" && r.ok && /review/i.test(r.args?.to ?? "")) k.inReview++;
  }
}

console.log(`Nhật ký ${month}: ${rows.length} lần gọi tool\n`);
console.log("Theo tool (lần gọi | lỗi | trung bình ms):");
for (const [n, t] of Object.entries(byTool).sort((a, b) => b[1].calls - a[1].calls)) {
  console.log(`  ${n.padEnd(26)} ${String(t.calls).padStart(5)} | ${String(t.errors).padStart(4)} | ${Math.round(t.ms / t.calls)}`);
}
const errList = Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 10);
if (errList.length) {
  console.log("\nLỗi lặp nhiều nhất (ứng viên cho BAI-HOC / sensor):");
  for (const [m, n] of errList) console.log(`  ${n}x  ${m}`);
}
const reworked = Object.entries(tickets).filter(([, k]) => k.inReview > 1);
console.log(`\nTicket: ${Object.keys(tickets).length}, chuyển In Review hơn 1 lần (bị Reopened, phải làm lại): ${reworked.length}`);
for (const [k, v] of reworked) console.log(`  ${k}: ${v.inReview} lần In Review`);
