import { Config, requireValue } from "./config.js";
import { http, HttpError } from "./http.js";

/** Bitbucket Server / Data Center REST API 1.0, xác thực bằng HTTP access token (Bearer). */
function base(cfg: Config, projectKey: string, slug: string): { url: string; token: string } {
  return {
    url: `${requireValue(cfg.bitbucket.url, "bitbucket.url")}/rest/api/1.0/projects/${projectKey}/repos/${slug}`,
    token: requireValue(cfg.bitbucket.token, "bitbucket.token"),
  };
}

function ref(branch: string, projectKey: string, slug: string) {
  return { id: `refs/heads/${branch}`, repository: { slug, project: { key: projectKey } } };
}

function prSummary(pr: any) {
  return {
    id: pr.id,
    title: pr.title,
    state: pr.state,
    from: pr.fromRef?.displayId,
    to: pr.toRef?.displayId,
    url: pr.links?.self?.[0]?.href,
    updated: pr.updatedDate ? new Date(pr.updatedDate).toISOString() : undefined,
  };
}

export async function createPullRequests(
  cfg: Config,
  projectKey: string,
  slug: string,
  from: string,
  targets: string[],
  title: string,
  description?: string,
) {
  const { url, token } = base(cfg, projectKey, slug);
  const results = [];
  for (const to of targets) {
    try {
      const pr = await http<any>(`${url}/pull-requests`, {
        method: "POST",
        token,
        body: {
          title,
          description: description ?? "",
          fromRef: ref(from, projectKey, slug),
          toRef: ref(to, projectKey, slug),
        },
      });
      results.push({ target: to, result: "created", ...prSummary(pr) });
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) {
        let existing: any;
        try {
          existing = JSON.parse(e.body)?.errors?.[0]?.existingPullRequest;
        } catch {
          /* bỏ qua */
        }
        if (existing) {
          results.push({ target: to, result: "already-open", ...prSummary(existing) });
          continue;
        }
        results.push({ target: to, result: "error", error: e.body.slice(0, 500) });
        continue;
      }
      results.push({ target: to, result: "error", error: (e as Error).message });
    }
  }
  return results;
}

export async function pullRequestStatus(cfg: Config, projectKey: string, slug: string, from: string) {
  const { url, token } = base(cfg, projectKey, slug);
  const q = new URLSearchParams({
    direction: "OUTGOING",
    at: `refs/heads/${from}`,
    state: "ALL",
    limit: "50",
  });
  const data = await http<any>(`${url}/pull-requests?${q}`, { token });
  const prs = [];
  for (const pr of data.values ?? []) {
    const s: any = prSummary(pr);
    if (pr.state === "OPEN") {
      try {
        const m = await http<any>(`${url}/pull-requests/${pr.id}/merge`, { token });
        s.canMerge = m.canMerge;
        s.conflicted = m.conflicted;
        s.vetoes = (m.vetoes ?? []).map((v: any) => v.summaryMessage);
      } catch (e) {
        s.mergeCheckError = (e as Error).message;
      }
    }
    if (pr.state === "MERGED") s.mergeCommit = pr.properties?.mergeCommit?.id;
    prs.push(s);
  }
  return prs;
}
