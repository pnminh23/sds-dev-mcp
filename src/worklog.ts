import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Config } from "./config.js";

/**
 * Worklog = checkpoint của ticket: tạo từ lúc dev xác nhận nguyên nhân, MCP tự ghi các mốc
 * (nhánh, commit, PR, build, Jira) vào mục nhật ký cuối file. Phiên mới đọc file này để làm tiếp.
 * Không bao giờ ném lỗi ra ngoài: ghi worklog hỏng không được chặn việc chính.
 */

const AUTO_HEADER = "## Nhật ký tự động (MCP ghi)";
const KEY_IN_BRANCH = /([A-Z][A-Z0-9_]+-\d+)$/;

export function keyFromBranch(branch?: string | null): string | undefined {
  return branch?.match(KEY_IN_BRANCH)?.[1];
}

export function worklogPath(cfg: Config, key: string): string | null {
  return cfg.worklogDir ? join(resolve(cfg.worklogDir), `${key}.md`) : null;
}

function now(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function template(cfg: Config, key: string, repo: string, branch: string, base: string, cause: string): string {
  return `# ${key}

| Mục | Nội dung |
|---|---|
| Jira | ${cfg.jira.url}/browse/${key} |
| Người làm | ${cfg.git.user} |
| Bắt đầu | ${now()} |

## Trạng thái các bước

- [x] Đọc ticket, điều tra
- [x] Xác nhận nguyên nhân với dev
- [x] Tạo nhánh
- [ ] Sửa code
- [ ] Review độc lập
- [ ] Commit + push
- [ ] Tạo PR
- [ ] Build lên môi trường
- [ ] Chuyển In Review

## 1. Nguyên nhân (đã xác nhận với dev)

${cause.trim()}

## 2. Cách xử lý

_(cập nhật khi sửa xong: file đã sửa, cách sửa, kiểm chứng, phần ngoài phạm vi)_

## 3. Phạm vi code

| Repo | Nhánh | Nhánh gốc |
|---|---|---|
| \`${repo}\` | \`${branch}\` | \`${base}\` |

## 4. Pull request

_(MCP tự ghi link PR vào nhật ký bên dưới)_

## 5. Việc tiếp theo

- [ ] PR được merge
- [ ] Kiểm tra build
- [ ] Chuyển Jira sang In Review (hỏi dev)

${AUTO_HEADER}

`;
}

/**
 * Ghi 1 dòng vào nhật ký tự động của worklog ĐÃ CÓ; trả đường dẫn file, null nếu chưa có file/chưa cấu hình/lỗi.
 * Không tự tạo file: file chỉ được tạo ở startWorklog (có template đầy đủ).
 */
export function appendWorklog(cfg: Config, key: string | undefined, line: string): string | null {
  if (!key) return null;
  try {
    const p = worklogPath(cfg, key);
    if (!p || !existsSync(p)) return null;
    const has = readFileSync(p, "utf8").includes(AUTO_HEADER);
    appendFileSync(p, `${has ? "" : `\n\n${AUTO_HEADER}\n\n`}- ${now()} — ${line}\n`, "utf8");
    return p;
  } catch {
    return null;
  }
}

/** Gọi lúc bắt đầu code (git_start_branch): tạo file nếu chưa có, ghi nguyên nhân đã xác nhận. */
export function startWorklog(
  cfg: Config,
  key: string,
  info: { repo: string; branch: string; base: string; causeSummary: string; created: boolean },
): { path: string | null; created: boolean; note?: string } {
  let p: string | null;
  let created = false;
  try {
    p = worklogPath(cfg, key);
    if (!p) {
      return { path: null, created: false, note: "Chưa cấu hình worklogDir: hỏi dev lưu worklog ở đâu rồi tự tạo file." };
    }
    mkdirSync(resolve(cfg.worklogDir!), { recursive: true });
    if (!existsSync(p)) {
      writeFileSync(p, template(cfg, key, info.repo, info.branch, info.base, info.causeSummary), "utf8");
      created = true;
    }
  } catch (e) {
    return { path: null, created: false, note: `Không ghi được worklog: ${(e as Error).message}` };
  }
  const oneLine = info.causeSummary.replace(/\s+/g, " ").trim();
  appendWorklog(
    cfg,
    key,
    `${info.created ? "Tạo" : "Checkout"} nhánh \`${info.branch}\` ở \`${info.repo}\` (gốc \`${info.base}\`). Nguyên nhân đã xác nhận: ${oneLine}`,
  );
  return {
    path: p,
    created,
    note: created
      ? "Đã tạo worklog. Cập nhật mục 'Trạng thái các bước' và 'Cách xử lý' khi làm xong từng bước."
      : "Worklog đã có (ticket làm tiếp/Reopened): đọc file để biết đã làm tới đâu.",
  };
}
