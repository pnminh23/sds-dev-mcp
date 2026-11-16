/**
 * Sensor tính toán: quét diff bằng quy tắc cố định, không cần LLM.
 * Chỉ xét dòng được THÊM (+) để không bắt lỗi của code cũ.
 * Thêm quy tắc mới khi một lỗi lặp lại (xem docs/BAI-HOC.md).
 */

export type Severity = "LỖI" | "CẢNH BÁO";

export interface Violation {
  /** true: nằm trong file mới chưa add; chỉ cần sửa nếu file sẽ được commit */
  untracked?: boolean;
  rule: string;
  severity: Severity;
  file: string;
  line?: number;
  text?: string;
  message: string;
}

interface AddedLine {
  file: string;
  line: number;
  text: string;
}

const JIRA_KEY = /\b([A-Z][A-Z0-9]+)-\d+\b/g;
// Chuẩn/thuật ngữ trông giống mã Jira (UTF-8, SHA-256, ISO-8601...), không báo
const NOT_JIRA = new Set([
  "UTF", "SHA", "ISO", "AES", "RFC", "X", "HTTP", "TLS", "SSL", "MD", "CP", "UTC", "GMT", "IEC", "RSA",
  "ECMA", "ES", "PKCS", "BASE", "LATIN", "WINDOWS", "WIN", "IPV", "TCVN", "EUC", "KOI", "GB", "BIG", "CRC",
  "HMAC", "JSR", "JDK", "JAVA", "TS", "COVID", "A", "B", "C", "F", "P", "V", "R", "Q", "W", "H", "DDR", "USB",
]);

/**
 * Có projectKeys (cấu hình + tiền tố của nhánh hiện tại): chỉ bắt đúng các tiền tố đó, không phân biệt hoa thường.
 * Không có: bắt mọi dạng ABC-123 trừ các chuẩn trong NOT_JIRA.
 */
function jiraMatcher(projectKeys: string[]): (s: string) => boolean {
  const keys = [...new Set(projectKeys.map((k) => k.trim().toUpperCase()).filter((k) => /^[A-Z][A-Z0-9_]*$/.test(k)))];
  if (keys.length) {
    const re = new RegExp(`\\b(${keys.join("|")})-\\d+\\b`, "i");
    return (s) => re.test(s);
  }
  return (s) => {
    for (const m of s.matchAll(JIRA_KEY)) if (!NOT_JIRA.has(m[1])) return true;
    return false;
  };
}
export const CODE_EXT = /\.(java|ts|tsx|js|jsx|mjs|html|scss|css|sql|xml|jrxml|kt|groovy)$/i;
const JAVA_TS = /\.(java|ts|tsx|js|jsx|mjs|kt|groovy)$/i;

/** Đọc unified diff, trả các dòng được thêm kèm file và số dòng ở bản mới. */
export function addedLines(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file = "";
  let line = 0;
  let inHeader = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git")) {
      inHeader = true;
      file = "";
      continue;
    }
    // "+++ "/"--- " chỉ là tiêu đề khi chưa tới @@ đầu tiên của file
    if (inHeader && raw.startsWith("+++ ")) {
      const p = raw.slice(4).trim().replace(/^"(.*)"$/, "$1");
      file = p === "/dev/null" ? "" : p.replace(/^b\//, "");
      continue;
    }
    if (inHeader && raw.startsWith("--- ")) continue;
    const h = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) {
      line = Number(h[1]);
      inHeader = false;
      continue;
    }
    if (!file) continue;
    if (raw.startsWith("+")) {
      out.push({ file, line, text: raw.slice(1) });
      line++;
    } else if (raw.startsWith(" ")) {
      line++;
    }
    // dòng "-" không tăng số dòng bản mới; "\ No newline" bỏ qua
  }
  return out;
}

/** Che nội dung chuỗi "...", '...', `...` (giữ nguyên độ dài) để không nhầm "http://" là comment. */
function maskStrings(t: string): string {
  return t.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) => m[0] + "x".repeat(m.length - 2) + m[m.length - 1]);
}

// Tách 1 dòng thành phần code và phần comment: //, /* ... */, * đầu dòng, -- của SQL, <!-- -->

export function splitComment(file: string, text: string): { code: string; comment: string | null } {
  const t = text.trim();
  if (/^(\*|\/\*|\/\/)/.test(t)) return { code: "", comment: t };
  if (/\.(html|xml|jrxml)$/i.test(file)) {
    const i = t.indexOf("<!--");
    return i >= 0 ? { code: t.slice(0, i), comment: t.slice(i) } : { code: t, comment: null };
  }
  const masked = maskStrings(t);
  if (/\.sql$/i.test(file)) {
    const k = masked.indexOf("--");
    if (k >= 0) return { code: t.slice(0, k), comment: t.slice(k) };
  }
  let i = masked.indexOf("//");
  const j = masked.indexOf("/*");
  if (i < 0 || (j >= 0 && j < i)) i = j;
  if (i < 0) return { code: t, comment: null };
  // comment khối cùng dòng dừng ở */, phần sau vẫn là code
  const end = i === j ? masked.indexOf("*/", i + 2) : -1;
  return end >= 0
    ? { code: t.slice(0, i) + " " + t.slice(end + 2), comment: t.slice(i, end + 2) }
    : { code: t.slice(0, i), comment: t.slice(i) };
}

function looksLikeCommentedCode(comment: string): boolean {
  // Javadoc/khối comment (* ..., /** ..., {@code}) không phải code bị comment bỏ
  if (/^(\*|\/\*\*)/.test(comment) || comment.includes("{@")) return false;
  const body = comment.replace(/^(\/\/+|\/\*+|\*+)\s?/, "").replace(/\*\/\s*$/, "").trim();
  if (body.length < 4) return false;
  return /[;{}]\s*$/.test(body) || /^(if|for|while|return|else|try|catch)\b.*[({]/.test(body);
}

const JUNK_FILE = /(\.(log|bak|orig|rej|tmp|swp)$|(^|\/)(\.DS_Store|Thumbs\.db)$|(^|\/)(target|out|dist|node_modules)\/)/i;

const MAX_VIOLATIONS = 100;

/**
 * untrackedContents: nội dung file mới chưa add (git diff không chứa), mọi dòng coi là dòng thêm.
 */
export function scanDiff(
  diff: string,
  untracked: string[] = [],
  untrackedContents: { file: string; content: string }[] = [],
  projectKeys: string[] = [],
): { violations: Violation[]; total: number; summary: string } {
  const hasJiraKey = jiraMatcher(projectKeys);
  const newFiles = new Set(untrackedContents.map((f) => f.file));
  const v: Violation[] = [];
  const add = (x: Violation) =>
    v.push({
      ...(newFiles.has(x.file) ? { untracked: true } : {}),
      ...x,
      text: x.text && x.text.length > 160 ? x.text.slice(0, 160) + "…" : x.text,
    });

  const lines = addedLines(diff);
  for (const f of untrackedContents) {
    f.content.split(/\r?\n/).forEach((text, i) => lines.push({ file: f.file, line: i + 1, text }));
  }

  for (const { file, line, text } of lines) {
    if (/^(<{7}|>{7}|={7})(\s|$)/.test(text)) {
      add({ rule: "conflict-marker", severity: "LỖI", file, line, text, message: "Còn dấu conflict merge." });
      continue;
    }
    if (!CODE_EXT.test(file)) continue;

    const { code, comment } = splitComment(file, text);
    if (comment && hasJiraKey(comment)) {
      add({ rule: "jira-key-in-comment", severity: "LỖI", file, line, text, message: "Comment chứa mã Jira; mã ticket đã nằm trong tên nhánh/commit." });
    }
    if (comment && JAVA_TS.test(file) && looksLikeCommentedCode(comment)) {
      add({ rule: "commented-out-code", severity: "CẢNH BÁO", file, line, text, message: "Có vẻ là code bị comment bỏ; xoá nếu không dùng." });
    }

    if (/\.java$/i.test(file)) {
      if (/List\s*<\s*Object\s*\[\s*\]\s*>/.test(code)) {
        add({ rule: "list-object-array", severity: "LỖI", file, line, text, message: "Dùng List<Object[]>; query nên trả kiểu cụ thể (String/UUID/DTO)." });
      }
      if (/System\.(out|err)\.print|\.printStackTrace\s*\(/.test(code)) {
        add({ rule: "debug-output", severity: "LỖI", file, line, text, message: "System.out/err hoặc printStackTrace; dùng logger." });
      }
    }
    if (/\.(ts|tsx|js|jsx)$/i.test(file) && /\bconsole\.log\s*\(/.test(code)) {
      add({ rule: "debug-output", severity: "LỖI", file, line, text, message: "console.log còn sót." });
    }
    if (/\.(java|sql)$/i.test(file) && /\bSELECT\s+\*/i.test(code)) {
      add({ rule: "select-star", severity: "CẢNH BÁO", file, line, text, message: "SELECT *; nên liệt kê cột cần dùng." });
    }
  }

  for (const f of untracked) {
    if (JUNK_FILE.test(f)) {
      add({ rule: "junk-file", severity: "CẢNH BÁO", file: f, message: "File rác/sinh tự động chưa được git theo dõi; không commit." });
    }
  }

  const err = v.filter((x) => x.severity === "LỖI").length;
  const warn = v.length - err;
  const inNew = v.filter((x) => x.untracked).length;
  const cut = v.length > MAX_VIOLATIONS ? ` Chỉ trả ${MAX_VIOLATIONS} mục đầu.` : "";
  const newNote = inNew
    ? ` Trong đó ${inNew} mục ở file mới chưa add (untracked=true): chỉ cần sửa nếu file đó thuộc task và sẽ được commit.`
    : "";
  const summary = v.length
    ? `Sensor: ${err} LỖI, ${warn} CẢNH BÁO. LỖI phải sửa trước khi commit; CẢNH BÁO cần xem lại.${newNote}${cut}`
    : "Sensor: không phát hiện vi phạm quy tắc cố định (vẫn cần review logic).";
  // LỖI xếp trước khi cắt
  v.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "LỖI" ? -1 : 1));
  return { violations: v.slice(0, MAX_VIOLATIONS), total: v.length, summary };
}
