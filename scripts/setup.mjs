// Cài đặt cho máy hiện tại: tạo config.local.json (nếu chưa có) và đăng ký MCP vào ~/.claude.json.
// Chạy: npm run setup   (sau khi npm install)
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "dist", "index.js").replace(/\\/g, "/");

if (!existsSync(entry)) {
  console.error("Chưa build. Chạy: npm run build");
  process.exit(1);
}

// 1. File cấu hình cá nhân
const local = join(root, "config.local.json");
if (existsSync(local)) {
  console.log(`✓ Đã có ${local} (giữ nguyên)`);
} else {
  copyFileSync(join(root, "config.example.json"), local);
  console.log(`✓ Tạo ${local} từ config.example.json -> MỞ FILE NÀY ĐỂ ĐIỀN các giá trị bắt đầu bằng DAN_`);
}

// 2. Đăng ký vào Claude Code (phạm vi user: dùng được ở mọi thư mục)
const claudeJson = join(homedir(), ".claude.json");
let data = {};
if (existsSync(claudeJson)) {
  const raw = readFileSync(claudeJson, "utf8");
  try {
    data = JSON.parse(raw);
  } catch {
    console.error(`✗ ${claudeJson} không phải JSON hợp lệ, không sửa. Hãy kiểm tra file này.`);
    process.exit(1);
  }
  writeFileSync(claudeJson + ".bak-sds-dev", raw);
}
const want = { type: "stdio", command: "node", args: [entry] };
const cur = data.mcpServers?.["sds-dev"];
if (cur && JSON.stringify(cur) === JSON.stringify(want)) {
  console.log("✓ MCP sds-dev đã được đăng ký sẵn");
} else {
  data.mcpServers = { ...(data.mcpServers ?? {}), "sds-dev": want };
  writeFileSync(claudeJson, JSON.stringify(data, null, 2));
  console.log(`✓ Đăng ký MCP sds-dev vào ${claudeJson} (bản cũ: .claude.json.bak-sds-dev)`);
}

console.log("\nViệc tiếp theo:");
console.log("  1. Điền config.local.json (jira.url, jira.token, bitbucket.token, git.user, prTargets)");
console.log("  2. Tắt hẳn app/CLI Claude rồi mở lại");
console.log("  3. Trong phiên mới gõ: gọi config_show");
