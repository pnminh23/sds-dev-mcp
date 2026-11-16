import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Config, requireValue, ResolvedRepo } from "./config.js";
import { checkIssueKey } from "./jira.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CODE_EXT, scanDiff } from "./sensors.js";

const run = promisify(execFile);

/** Không cho git mở hộp thoại hỏi mật khẩu (MCP chạy nền sẽ treo); thiếu đăng nhập thì báo lỗi ngay. */
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };

export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      env: GIT_ENV,
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout.trim();
  } catch (e: any) {
    const msg = (e.stderr || e.stdout || e.message || "").toString().trim();
    throw new Error(`git ${args.join(" ")} thất bại: ${msg}`);
  }
}

/** true: là tổ tiên; false: không phải; null: thiếu commit trong repo local. */
export async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean | null> {
  try {
    await run("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd, env: GIT_ENV, windowsHide: true });
    return true;
  } catch (e: any) {
    return e.code === 1 ? false : null;
  }
}

export async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

export type BranchKind = "fixbug" | "task" | "features";

export function branchName(cfg: Config, kind: BranchKind, issueKey: string): string {
  return `${kind}/${requireValue(cfg.git.user, "git.user (tên dùng trong nhánh, vd minhpm)")}/${checkIssueKey(issueKey)}`;
}

const TASK_BRANCH = /^(fixbug|task|features|feature|bugfix|hotfix)\/[^/]+\/[A-Z][A-Z0-9_]+-\d+$/;

export function assertTaskBranch(cfg: Config, branch: string) {
  if (cfg.git.protectedBranches.includes(branch)) {
    throw new Error(`Nhánh "${branch}" là nhánh môi trường được bảo vệ, không commit/push tự động.`);
  }
  if (!TASK_BRANCH.test(branch)) {
    throw new Error(`Nhánh "${branch}" không phải nhánh task (dạng fixbug|task/<user>/<JIRA-KEY>), không commit/push tự động.`);
  }
}

export async function currentBranch(cwd: string): Promise<string> {
  return git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

/** Bitbucket Server: https://host:7990/scm/ea/repo.git hoặc ssh://git@host:7999/ea/repo.git */
export async function bitbucketCoords(cwd: string): Promise<{ projectKey: string; slug: string }> {
  const remote = await git(cwd, ["remote", "get-url", "origin"]);
  const m = remote.match(/(?:\/scm)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`Không đọc được project/repo từ remote origin: ${remote}`);
  return { projectKey: m[1].toUpperCase(), slug: m[2] };
}

export async function startBranch(cfg: Config, repo: ResolvedRepo, kind: BranchKind, issueKey: string, base?: string) {
  const cwd = repo.path;
  const branch = branchName(cfg, kind, issueKey);
  const baseBranch = base ?? repo.conf.baseBranch ?? cfg.git.baseBranch;
  const steps: string[] = [];

  const dirty = await git(cwd, ["status", "--porcelain", "--untracked-files=no"]);
  const before = await currentBranch(cwd);
  if (dirty && before !== branch) {
    throw new Error(
      `Repo ${repo.name} đang ở nhánh ${before} và có thay đổi chưa commit:\n${dirty}\nHãy commit/stash trước khi chuyển nhánh.`,
    );
  }

  await git(cwd, ["fetch", "origin", "--prune"]);
  steps.push("fetch origin");

  if (before === branch) {
    steps.push(`đã ở sẵn nhánh ${branch}`);
    return { repo: repo.name, branch, created: false, base: baseBranch, steps };
  }

  if (await tryGit(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) {
    await git(cwd, ["checkout", branch]);
    steps.push(`checkout nhánh local có sẵn ${branch}`);
    return { repo: repo.name, branch, created: false, base: baseBranch, steps };
  }

  if (await tryGit(cwd, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`])) {
    await git(cwd, ["checkout", "-b", branch, "--track", `origin/${branch}`]);
    steps.push(`checkout nhánh ${branch} từ remote`);
    return { repo: repo.name, branch, created: false, base: baseBranch, steps };
  }

  await git(cwd, ["checkout", baseBranch]);
  await git(cwd, ["pull", "--ff-only", "origin", baseBranch]);
  steps.push(`checkout ${baseBranch} và pull mới nhất`);
  await git(cwd, ["checkout", "-b", branch]);
  steps.push(`tạo nhánh ${branch} từ ${baseBranch}`);
  return { repo: repo.name, branch, created: true, base: baseBranch, steps };
}

export async function commitPush(cfg: Config, repo: ResolvedRepo, files?: string[], message?: string) {
  const cwd = repo.path;
  const branch = await currentBranch(cwd);
  assertTaskBranch(cfg, branch);

  if (files && files.length) await git(cwd, ["add", "--", ...files]);
  else await git(cwd, ["add", "-u"]);

  const staged = (await git(cwd, ["diff", "--cached", "--name-only"])).split("\n").filter(Boolean);
  let commit: string | null = null;
  if (staged.length) {
    await git(cwd, ["commit", "-m", message?.trim() || branch]);
    commit = await git(cwd, ["rev-parse", "HEAD"]);
  }

  await git(cwd, ["push", "-u", "origin", branch]);
  const untracked = (await git(cwd, ["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean);

  return {
    repo: repo.name,
    branch,
    committedFiles: staged,
    commit,
    pushed: true,
    note: staged.length ? undefined : "Không có thay đổi mới để commit; chỉ push các commit đã có.",
    untrackedNotIncluded: untracked.slice(0, 50),
  };
}

/**
 * Toàn bộ thay đổi của nhánh task so với nhánh gốc (gồm cả phần chưa commit), để reviewer độc lập đọc.
 * So với merge-base nên không lẫn code người khác đã vào prod sau khi tạo nhánh.
 */
export async function reviewDiff(cfg: Config, repo: ResolvedRepo, base?: string, maxBytes = 200_000) {
  const cwd = repo.path;
  const branch = await currentBranch(cwd);
  const baseBranch = base ?? repo.conf.baseBranch ?? cfg.git.baseBranch;
  await tryGit(cwd, ["fetch", "origin", baseBranch]);
  const mergeBase = await git(cwd, ["merge-base", `origin/${baseBranch}`, "HEAD"]);

  const stat = await git(cwd, ["diff", "--stat", mergeBase]);
  // quotePath=false: đường dẫn tiếng Việt không bị git bọc ngoặc kép/escape
  let diff = await git(cwd, ["-c", "core.quotePath=false", "diff", "--unified=8", "--no-color", mergeBase]);
  const untracked = (await git(cwd, ["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"]))
    .split("\n")
    .filter(Boolean);
  // quét trên diff đầy đủ, trước khi cắt
  const untrackedContents = untracked
    .filter((f) => CODE_EXT.test(f))
    .slice(0, 100)
    .flatMap((f) => {
      const p = join(cwd, f);
      try {
        return existsSync(p) && statSync(p).size <= 500_000 ? [{ file: f, content: readFileSync(p, "utf8") }] : [];
      } catch {
        return [];
      }
    });
  const branchKey = branch.match(/([A-Z][A-Z0-9_]+)-\d+$/)?.[1];
  const sensors = scanDiff(diff, untracked, untrackedContents, [...cfg.jira.projectKeys, ...(branchKey ? [branchKey] : [])]);
  const truncated = diff.length > maxBytes;
  if (truncated) diff = diff.slice(0, maxBytes);

  return {
    repo: repo.name,
    repoPath: cwd,
    branch,
    base: baseBranch,
    mergeBase,
    stat,
    untrackedFiles: untracked.slice(0, 100),
    sensors,
    truncated,
    note: truncated ? `Diff dài hơn ${maxBytes} ký tự, đã cắt. Đọc thêm file trực tiếp trong repoPath.` : undefined,
    diff,
  };
}
