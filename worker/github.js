// Minimal GitHub Git Data client. Saves are made as ONE commit per action, so a batch of 60 prompts and
// 60 images is a single, atomic change (and a single site rebuild).
import { UserError } from '../scripts/lib/shared.mjs';

export class GitHubError extends UserError {
  constructor(message, status = 502) {
    super([message], status);
  }
}

export function createRepo(env, fetchImpl = (...a) => fetch(...a)) {
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const base = `https://api.github.com/repos/${repo}`;

  async function gh(path, { method = 'GET', body, raw = false } = {}) {
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'promptrin-admin',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError('Could not reach GitHub. Try again in a moment.');
    }
    if (res.ok) return raw ? res : res.status === 204 ? null : res.json();
    if (res.status === 401) throw new GitHubError('GitHub rejected the access token. It may have expired or been revoked. Create a new one and update GITHUB_TOKEN.');
    if (res.status === 403) throw new GitHubError('GitHub refused this action (rate limit or the token lacks "Contents: Read and write" on this repository).');
    if (res.status === 404) throw new GitHubError(`GitHub could not find ${repo} (branch "${branch}"). Check GITHUB_REPO, GITHUB_BRANCH and that the token can access that repository.`);
    if (res.status === 422 && /fast forward/i.test(await res.text().catch(() => ''))) throw new GitHubError('The site was changed by someone or something else while you were saving. Reload the page and try again.', 409);
    throw new GitHubError(`GitHub returned an error (${res.status}).`);
  }

  return {
    repo,
    branch,
    /** Latest commit and its tree. */
    async head() {
      const ref = await gh(`/git/ref/heads/${encodeURIComponent(branch)}`);
      const commit = await gh(`/git/commits/${ref.object.sha}`);
      return { commit: ref.object.sha, tree: commit.tree.sha, message: commit.message, date: commit.committer?.date };
    },
    async tree(treeSha) {
      const t = await gh(`/git/trees/${treeSha}?recursive=1`);
      if (t.truncated) throw new GitHubError('The repository is too large to list through the API.');
      return t.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha, size: e.size }));
    },
    async blobText(sha) {
      return (await gh(`/git/blobs/${sha}`, { raw: true })).text();
    },
    async blobStream(sha) {
      return gh(`/git/blobs/${sha}`, { raw: true });
    },
    /** Stores an image (base64) and returns its sha. The image is not part of the site until a commit uses it. */
    async createBlob(base64) {
      const r = await gh('/git/blobs', { method: 'POST', body: { content: base64, encoding: 'base64' } });
      return r.sha;
    },
    /**
     * Makes one commit. changes: [{ path, content } | { path, sha } | { path, remove: true }].
     * Fails (without changing anything) if the branch moved since `parent` was read.
     */
    async commit({ parent, parentTree, changes, message }) {
      const entries = changes.map((c) =>
        c.remove ? { path: c.path, mode: '100644', type: 'blob', sha: null }
          : c.sha ? { path: c.path, mode: '100644', type: 'blob', sha: c.sha }
          : { path: c.path, mode: '100644', type: 'blob', content: c.content });
      const tree = await gh('/git/trees', { method: 'POST', body: { base_tree: parentTree, tree: entries } });
      const commit = await gh('/git/commits', { method: 'POST', body: { message, tree: tree.sha, parents: [parent] } });
      await gh(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
      return { commit: commit.sha, url: `https://github.com/${repo}/commit/${commit.sha}` };
    },
  };
}
