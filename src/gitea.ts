import { Config, ResolvedRepo } from "./config.js";
import { http } from "./http.js";
import { git, isAncestor, tryGit } from "./git.js";

/**
 * Kiểm tra nhánh đã được build lên môi trường chưa, theo cách user vẫn làm tay:
 * trên Gitea mirror, tìm commit mới nhất của nhánh môi trường có tích xanh (status success),
 * rồi xem commit của mình có nằm "dưới" (là tổ tiên của) commit đó không.
 * Thứ tự hiển thị trên trang không phản ánh đúng quan hệ cha-con, nên kiểm tra bằng git merge-base --is-ancestor.
 */
export async function buildCheck(cfg: Config, repo: ResolvedRepo, targetBranch: string, sourceBranch: string, scan = 60) {
  if (!cfg.gitea) throw new Error("Chưa cấu hình gitea trong file cấu hình.");
  const giteaRepo = repo.conf.giteaRepo ?? repo.name;
  const apiBase = `${cfg.gitea.url}/api/v1/repos/${cfg.gitea.owner}/${giteaRepo}`;
  const token = cfg.gitea.token || undefined;

  await git(repo.path, ["fetch", "origin", targetBranch]);
  // Nhánh nguồn có thể đã bị xóa trên remote sau khi merge: khi đó lấy commit ở nhánh local
  const remoteSrc = await tryGit(repo.path, ["fetch", "origin", sourceBranch]);
  const mySha =
    (remoteSrc !== null ? await tryGit(repo.path, ["rev-parse", `origin/${sourceBranch}`]) : null) ??
    (await git(repo.path, ["rev-parse", sourceBranch]));

  const info = await http<any>(apiBase, { token });

  const commits: { sha: string; message: string; date: string }[] = [];
  for (let page = 1; commits.length < scan; page++) {
    const q = new URLSearchParams({
      sha: targetBranch,
      limit: "50",
      page: String(page),
      stat: "false",
      verification: "false",
      files: "false",
    });
    const batch = await http<any[]>(`${apiBase}/commits?${q}`, { token });
    if (!batch?.length) break;
    for (const c of batch) {
      commits.push({ sha: c.sha, message: (c.commit?.message ?? "").split("\n")[0], date: c.commit?.committer?.date });
    }
    if (batch.length < 50) break;
  }

  const recent: { sha: string; state: string; message: string }[] = [];
  let green: { sha: string; message: string; date: string } | null = null;
  for (const c of commits.slice(0, scan)) {
    const st = await http<any>(`${apiBase}/commits/${c.sha}/status`, { token });
    const state = st?.state || "";
    if (recent.length < 8) recent.push({ sha: c.sha.slice(0, 10), state: state || "(không có)", message: c.message });
    if (state === "success") {
      green = c;
      break;
    }
  }

  const inTarget = (await isAncestor(repo.path, mySha, `origin/${targetBranch}`)) ?? false;
  let built = false;
  let greenMissingLocally = false;
  if (green) {
    const r = await isAncestor(repo.path, mySha, green.sha);
    greenMissingLocally = r === null;
    built = r === true;
  }

  let verdict: string;
  if (built) verdict = `ĐÃ BUILD: commit ${mySha.slice(0, 10)} nằm dưới commit tích xanh mới nhất của ${targetBranch}.`;
  else if (!inTarget) verdict = `CHƯA MERGE: commit ${mySha.slice(0, 10)} chưa có trong ${targetBranch} trên Bitbucket.`;
  else if (!green) verdict = `CHƯA THẤY TÍCH XANH trong ${scan} commit gần nhất của ${targetBranch} trên Gitea.`;
  else verdict = `ĐANG CHỜ BUILD: đã merge vào ${targetBranch} nhưng chưa nằm dưới commit tích xanh mới nhất (hoặc Gitea mirror chưa đồng bộ).`;

  return {
    verdict,
    built,
    mergedIntoTarget: inTarget,
    myCommit: mySha,
    latestGreen: green ? { sha: green.sha, message: green.message, date: green.date } : null,
    recentStatuses: recent,
    note: greenMissingLocally
      ? "Commit tích xanh trên Gitea chưa có trong repo local (nhánh môi trường đã bị force-push?). Mở trang Gitea để kiểm tra tay."
      : undefined,
    giteaMirrorUpdated: info?.mirror_updated,
    giteaUrl: `${cfg.gitea.url}/${cfg.gitea.owner}/${giteaRepo}/commits/branch/${targetBranch}`,
  };
}
