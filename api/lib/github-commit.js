// Commits a single file back to a GitHub repo using the "create or update
// file contents" REST endpoint. This is how the serverless function persists
// fresh market data — a real `git commit` isn't possible from inside a
// Vercel function, so we go through GitHub's API instead. The resulting push
// triggers Vercel's normal git-integration auto-deploy.
//
// Every function here takes an optional `overrides` object ({ token, repo,
// branch }) so the same client can target either this site's public repo
// (the default, via GITHUB_TOKEN/GITHUB_REPO/GITHUB_BRANCH) or the separate
// PRIVATE repo used to store email subscribers (see
// api/lib/subscribers-store.js) — subscriber emails can't live in this
// site's public data/*.json files, which are readable by anyone on GitHub.
//
// Default env vars (used when overrides is omitted):
//   GITHUB_TOKEN  - personal access token with write access to the repo (see README)
//   GITHUB_REPO   - "owner/repo-name"
//   GITHUB_BRANCH - defaults to "main"

const GITHUB_API = 'https://api.github.com';

function config(overrides) {
  const token = (overrides && overrides.token) || process.env.GITHUB_TOKEN;
  const repo = (overrides && overrides.repo) || process.env.GITHUB_REPO;
  const branch = (overrides && overrides.branch) || process.env.GITHUB_BRANCH || 'main';
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  if (!repo) throw new Error('GITHUB_REPO is not set (expected "owner/repo-name")');
  return { token, repo, branch };
}

async function githubRequest(url, options, overrides) {
  const { token } = config(overrides);
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

// Fetches a file's current content + SHA (the SHA is required by the GitHub
// API to update an existing file). Returns null if the file doesn't exist
// yet. Content is decoded from GitHub's base64 response into a UTF-8 string.
async function getFileContent(filePath, overrides) {
  const { repo, branch } = config(overrides);
  const url = `${GITHUB_API}/repos/${repo}/contents/${filePath}?ref=${branch}`;
  const res = await githubRequest(url, { method: 'GET' }, overrides);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET contents failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf8') };
}

// Looks up just the current file's SHA — kept as a thin wrapper over
// getFileContent() for callers (like the daily cron) that only need to know
// whether a file exists / its SHA and don't need its content.
async function getFileSha(filePath, overrides) {
  const file = await getFileContent(filePath, overrides);
  return file ? file.sha : null;
}

async function commitFile(filePath, contentString, commitMessage, overrides) {
  const { repo, branch } = config(overrides);
  const sha = await getFileSha(filePath, overrides);

  const url = `${GITHUB_API}/repos/${repo}/contents/${filePath}`;
  const body = {
    message: commitMessage,
    content: Buffer.from(contentString, 'utf8').toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  };

  const res = await githubRequest(url, { method: 'PUT', body: JSON.stringify(body) }, overrides);
  if (!res.ok) throw new Error(`GitHub PUT contents failed: ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = { commitFile, getFileContent, getFileSha };
