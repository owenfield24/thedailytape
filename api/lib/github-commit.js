// Commits a single file back to the GitHub repo using the "create or update
// file contents" REST endpoint. This is how the serverless function persists
// fresh market data — a real `git commit` isn't possible from inside a
// Vercel function, so we go through GitHub's API instead. The resulting push
// triggers Vercel's normal git-integration auto-deploy.
//
// Requires env vars:
//   GITHUB_TOKEN  - personal access token with write access to the repo (see README)
//   GITHUB_REPO   - "owner/repo-name"
//   GITHUB_BRANCH - defaults to "main"

const GITHUB_API = 'https://api.github.com';

function config() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  if (!repo) throw new Error('GITHUB_REPO is not set (expected "owner/repo-name")');
  return { token, repo, branch };
}

async function githubRequest(url, options) {
  const { token } = config();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(options && options.headers),
    },
  });
  return res;
}

// Looks up the current file's SHA, required by the GitHub API to update an
// existing file. Returns null if the file doesn't exist yet (first run).
async function getFileSha(filePath) {
  const { repo, branch } = config();
  const url = `${GITHUB_API}/repos/${repo}/contents/${filePath}?ref=${branch}`;
  const res = await githubRequest(url, { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET contents failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.sha;
}

async function commitFile(filePath, contentString, commitMessage) {
  const { repo, branch } = config();
  const sha = await getFileSha(filePath);

  const url = `${GITHUB_API}/repos/${repo}/contents/${filePath}`;
  const body = {
    message: commitMessage,
    content: Buffer.from(contentString, 'utf8').toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  };

  const res = await githubRequest(url, { method: 'PUT', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub PUT contents failed: ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = { commitFile };
