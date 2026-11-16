import { Config, requireValue } from "./config.js";
import { http } from "./http.js";

/** Jira Server / Data Center, REST API v2, xác thực bằng Personal Access Token (Bearer). */
function api(cfg: Config, path: string): { url: string; token: string } {
  return {
    url: `${requireValue(cfg.jira.url, "jira.url")}/rest/api/2${path}`,
    token: requireValue(cfg.jira.token, "jira.token"),
  };
}

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
export function checkIssueKey(key: string): string {
  const k = key.trim().toUpperCase();
  if (!ISSUE_KEY.test(k)) throw new Error(`Mã Jira không hợp lệ: "${key}" (dạng ABC-123).`);
  return k;
}

function show(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(show);
  const o = v as Record<string, unknown>;
  for (const k of ["displayName", "name", "value", "key"]) {
    if (typeof o[k] === "string") return o[k];
  }
  const s = JSON.stringify(v);
  return s.length > 300 ? s.slice(0, 300) + "…" : v;
}

function isEmpty(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

export async function getIssue(cfg: Config, key: string) {
  const k = checkIssueKey(key);
  const { url, token } = api(cfg, `/issue/${k}?expand=names`);
  const data = await http<any>(url, { token });
  const f = data.fields ?? {};
  const names: Record<string, string> = data.names ?? {};

  const customFields: Record<string, unknown> = {};
  for (const [id, val] of Object.entries(f)) {
    if (!id.startsWith("customfield_") || isEmpty(val)) continue;
    customFields[names[id] ?? id] = show(val);
  }

  const comments = (f.comment?.comments ?? []).slice(-10).map((c: any) => ({
    author: c.author?.displayName,
    created: c.created,
    body: c.body,
  }));

  return {
    key: data.key,
    url: `${cfg.jira.url}/browse/${data.key}`,
    summary: f.summary,
    type: f.issuetype?.name,
    status: f.status?.name,
    priority: f.priority?.name,
    assignee: f.assignee?.displayName,
    reporter: f.reporter?.displayName,
    created: f.created,
    updated: f.updated,
    environment: f.environment,
    components: show(f.components),
    labels: f.labels,
    fixVersions: show(f.fixVersions),
    description: f.description,
    customFields,
    attachments: (f.attachment ?? []).map((a: any) => ({ filename: a.filename, url: a.content })),
    links: (f.issuelinks ?? []).map((l: any) => ({
      type: l.type?.name,
      issue: (l.outwardIssue ?? l.inwardIssue)?.key,
      summary: (l.outwardIssue ?? l.inwardIssue)?.fields?.summary,
    })),
    subtasks: (f.subtasks ?? []).map((s: any) => ({ key: s.key, summary: s.fields?.summary, status: s.fields?.status?.name })),
    lastComments: comments,
  };
}

export type WorkScope = "work" | "review" | "all";

/** JQL việc của tôi: work = To do + In Progress + Reopened (việc cần làm), review = In Review, all = mọi ticket chưa đóng. */
export function myWorkJql(cfg: Config, scope: WorkScope = "work"): string {
  const s = cfg.jira.statuses;
  const q = (x: string) => `"${x.replace(/"/g, '\\"')}"`;
  const base = "assignee = currentUser()";
  if (scope === "review") return `${base} AND status = ${q(s.inReview)} ORDER BY updated DESC`;
  if (scope === "all") return `${base} AND resolution = Unresolved ORDER BY updated DESC`;
  return `${base} AND status in (${[s.reopened, s.inProgress, s.todo].map(q).join(", ")}) ORDER BY priority DESC, updated DESC`;
}

export async function search(cfg: Config, jql: string, maxResults = 30) {
  const { url, token } = api(cfg, "/search");
  const data = await http<any>(url, {
    method: "POST",
    token,
    body: { jql, maxResults, fields: ["summary", "status", "issuetype", "priority", "updated", "assignee"] },
  });
  const issues = (data.issues ?? []).map((i: any) => ({
    key: i.key,
    type: i.fields?.issuetype?.name,
    status: i.fields?.status?.name,
    priority: i.fields?.priority?.name,
    summary: i.fields?.summary,
    updated: i.fields?.updated,
  }));
  const byStatus: Record<string, number> = {};
  for (const i of issues) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
  return { jql, total: data.total, byStatus, issues };
}

export async function listTransitions(cfg: Config, key: string) {
  const k = checkIssueKey(key);
  const { url, token } = api(cfg, `/issue/${k}/transitions`);
  const data = await http<any>(url, { token });
  return (data.transitions ?? []).map((t: any) => ({ id: t.id, name: t.name, to: t.to?.name }));
}

export async function transition(cfg: Config, key: string, target: string) {
  const k = checkIssueKey(key);
  const all = await listTransitions(cfg, k);
  const want = target.trim().toLowerCase();
  const t = all.find((x: any) => x.name?.toLowerCase() === want || x.to?.toLowerCase() === want);
  if (!t) {
    throw new Error(
      `Ticket ${k} không có bước chuyển "${target}". Các bước hiện có: ${all.map((x: any) => `${x.name} → ${x.to}`).join("; ")}`,
    );
  }
  const { url, token } = api(cfg, `/issue/${k}/transitions`);
  await http(url, { method: "POST", token, body: { transition: { id: t.id } } });
  return { key: k, transition: t.name, newStatus: t.to };
}

/**
 * Bắt đầu làm ticket: To do / Reopened -> In Progress. Đã In Progress thì giữ nguyên.
 * Trạng thái khác (In Review, Done Test...) không tự chuyển, trả về để Claude hỏi user.
 */
export async function startWork(cfg: Config, key: string) {
  const k = checkIssueKey(key);
  const s = cfg.jira.statuses;
  const { url, token } = api(cfg, `/issue/${k}?fields=status,summary`);
  const data = await http<any>(url, { token });
  const current: string = data.fields?.status?.name ?? "";
  const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  if (eq(current, s.inProgress)) {
    return { key: k, changed: false, status: current, note: "Ticket đã ở trạng thái đang làm." };
  }
  if (eq(current, s.todo) || eq(current, s.reopened)) {
    const r = await transition(cfg, k, s.inProgress);
    return {
      key: k,
      changed: true,
      from: current,
      status: r.newStatus,
      wasReopened: eq(current, s.reopened),
      note: eq(current, s.reopened)
        ? "Ticket bị tester trả lại: đọc comment gần nhất (jira_get_issue) để biết lý do, tiếp tục trên nhánh task cũ."
        : undefined,
    };
  }
  return {
    key: k,
    changed: false,
    status: current,
    note: `Ticket đang ở "${current}", không tự chuyển sang ${s.inProgress}. Hỏi user trước khi đổi trạng thái.`,
  };
}

export async function addComment(cfg: Config, key: string, body: string) {
  const k = checkIssueKey(key);
  const { url, token } = api(cfg, `/issue/${k}/comment`);
  const data = await http<any>(url, { method: "POST", token, body: { body } });
  return { key: k, commentId: data.id };
}
