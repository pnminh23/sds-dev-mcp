import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RepoConfig {
  /** Đường dẫn repo; bỏ trống thì lấy <reposRoot>/<tên repo> */
  path?: string;
  /** Các nhánh môi trường cần tạo pull request vào, vd ["test", "dev-99"] */
  prTargets?: string[];
  /** Tên repo trên Gitea mirror nếu khác tên Bitbucket, vd 88ebweb -> ebweb88 */
  giteaRepo?: string;
  /** Nhánh gốc để tạo nhánh task, mặc định lấy git.baseBranch */
  baseBranch?: string;
}

/** Tên trạng thái Jira của team (đúng chữ hiển thị trên Jira) */
export interface JiraStatuses {
  /** Tester giao, chưa làm */
  todo: string;
  /** Đang làm: bắt đầu làm ticket nào thì chuyển ticket đó sang đây */
  inProgress: string;
  /** Tester trả lại từ In Review vì chưa đúng yêu cầu */
  reopened: string;
  /** Dev làm xong, đã build, chờ tester */
  inReview: string;
  /** Tester xác nhận xong */
  done: string;
}

export const DEFAULT_STATUSES: JiraStatuses = {
  todo: "To do",
  inProgress: "In Progress",
  reopened: "Reopened",
  inReview: "In Review",
  done: "Done Test",
};

export interface Config {
  /** projectKeys: tiền tố mã Jira của team (EBW, EB133...), sensor chỉ coi các tiền tố này là mã Jira */
  jira: { url: string; token: string; statuses: JiraStatuses; projectKeys: string[] };
  bitbucket: { url: string; token: string };
  gitea?: { url: string; owner: string; token?: string };
  git: { user: string; baseBranch: string; protectedBranches: string[] };
  insecureTls?: boolean;
  /** Thư mục chứa các repo trên máy, vd C:/PNMINH/sds */
  reposRoot?: string;
  /** Thư mục lưu worklog <KEY>.md (tạo khi bắt đầu code, MCP tự ghi mốc); bỏ trống = Claude hỏi khi cần */
  worklogDir?: string;
  /** Thư mục nhật ký gọi tool (JSONL theo tháng); mặc định <thư mục MCP>/logs */
  logDir?: string;
  repos: Record<string, RepoConfig>;
  /** DB local/test, CHỈ ĐỌC. Khóa là tên ngắn dùng khi gọi tool, vd "test1" */
  databases: Record<string, DbConfig>;
  /** Host không bao giờ được kết nối (vd IP DB production) */
  blockedDbHosts: string[];
}

export interface DbConfig {
  server: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  /** Ghi chú hiển thị cho Claude, vd "DB test nhóm 1 app133" */
  note?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Thư mục cài MCP (chứa docs/, logs/) */
export function mcpRoot(): string {
  return ROOT;
}

export function configPath(): string {
  return process.env.SDS_MCP_CONFIG ?? join(ROOT, "config.local.json");
}

/** Đọc lại file cấu hình ở mỗi lần gọi tool, sửa file không cần khởi động lại MCP. */
export function loadConfig(): Config {
  const p = configPath();
  if (!existsSync(p)) {
    throw new Error(
      `Chưa có file cấu hình ${p}. Copy config.example.json thành config.local.json rồi điền URL và token.`,
    );
  }
  const raw = JSON.parse(readFileSync(p, "utf8")) as any;
  const cfg: Config = {
    jira: {
      url: trimSlash(raw.jira?.url ?? ""),
      token: raw.jira?.token ?? "",
      statuses: { ...DEFAULT_STATUSES, ...(raw.jira?.statuses ?? {}) },
      projectKeys: Array.isArray(raw.jira?.projectKeys) ? raw.jira.projectKeys.map(String) : [],
    },
    bitbucket: { url: trimSlash(raw.bitbucket?.url ?? ""), token: raw.bitbucket?.token ?? "" },
    gitea: raw.gitea ? { ...raw.gitea, url: trimSlash(raw.gitea.url) } : undefined,
    git: {
      user: raw.git?.user ?? "",
      baseBranch: raw.git?.baseBranch ?? "prod",
      protectedBranches: raw.git?.protectedBranches ?? ["prod", "master", "main", "test", "dev-99", "dev-mix"],
    },
    insecureTls: raw.insecureTls ?? false,
    reposRoot: raw.reposRoot,
    worklogDir: raw.worklogDir,
    logDir: raw.logDir,
    repos: raw.repos ?? {},
    databases: raw.databases ?? {},
    blockedDbHosts: raw.blockedDbHosts ?? [],
  };
  if (cfg.insecureTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  return cfg;
}

export function requireValue(value: string | undefined, name: string): string {
  if (!value || value.startsWith("DAN_")) {
    throw new Error(`Chưa cấu hình ${name} trong ${configPath()}.`);
  }
  return value;
}

export interface ResolvedRepo {
  name: string;
  path: string;
  conf: RepoConfig;
}

/**
 * Nhận tên repo (trong cấu hình, hoặc thư mục con của reposRoot) hoặc đường dẫn tuyệt đối tới thư mục repo.
 */
export function resolveRepo(cfg: Config, repo: string): ResolvedRepo {
  const byName = (name: string): string | null => {
    const conf = cfg.repos[name];
    if (conf?.path) return resolve(conf.path);
    if (cfg.reposRoot) return resolve(cfg.reposRoot, name);
    return null;
  };

  const named = byName(repo);
  if (named && existsSync(join(named, ".git"))) {
    return { name: repo, path: named, conf: cfg.repos[repo] ?? {} };
  }
  const abs = resolve(repo);
  if (existsSync(join(abs, ".git"))) {
    const name = basename(abs);
    return { name, path: abs, conf: cfg.repos[name] ?? {} };
  }
  const known = Object.keys(cfg.repos).join(", ") || "(chưa có)";
  throw new Error(
    `Không tìm thấy repo "${repo}"${named ? ` tại ${named}` : ""}. Repo đã cấu hình: ${known}. Kiểm tra reposRoot/path trong ${configPath()} hoặc truyền đường dẫn tuyệt đối.`,
  );
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}
