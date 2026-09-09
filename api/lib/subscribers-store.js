// Stores email subscribers in a SEPARATE, PRIVATE GitHub repo — not this
// site's public repo, whose data/*.json files are readable by anyone (see
// CLAUDE.md). Reuses the same "commit via GitHub's contents API" pattern as
// api/lib/github-commit.js (a real database was ruled out to keep this
// project's zero-dependency, no-database philosophy), just pointed at a
// different repo via its own credentials.
//
// Requires env vars:
//   SUBSCRIBERS_GITHUB_TOKEN  - fine-grained PAT scoped to the private repo, Contents: Read/write
//   SUBSCRIBERS_GITHUB_REPO   - "owner/repo-name" of the private subscribers repo
//   SUBSCRIBERS_GITHUB_BRANCH - defaults to "main"
//
// File format (subscribers.json in that repo):
//   { "subscribers": [ { "email": "...", "topics": ["today-brief", "pod:technology"], "unsubscribeToken": "..." } ] }
//
// "topics" values match what api/subscribe.js computes: "today-brief" for
// the homepage's broad-market brief, "pod:<slug>" for a sector pod — see
// MARKET_BRIEF_SLUG and PODS in templates/partials.js. unsubscribeToken is a
// random per-subscriber secret (not derivable from their email) included in
// unsubscribe links so anyone with the link — but nobody else — can remove
// that address, without requiring a login.

const crypto = require('crypto');
const { commitFile, getFileContent } = require('./github-commit');

const SUBSCRIBERS_PATH = 'subscribers.json';

function overrides() {
  const token = process.env.SUBSCRIBERS_GITHUB_TOKEN;
  const repo = process.env.SUBSCRIBERS_GITHUB_REPO;
  const branch = process.env.SUBSCRIBERS_GITHUB_BRANCH || 'main';
  if (!token) throw new Error('SUBSCRIBERS_GITHUB_TOKEN is not set');
  if (!repo) throw new Error('SUBSCRIBERS_GITHUB_REPO is not set (expected "owner/repo-name")');
  return { token, repo, branch };
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// Returns { sha, subscribers } — sha is null and subscribers [] if the file
// doesn't exist yet (first-ever subscriber).
async function readSubscribers() {
  const file = await getFileContent(SUBSCRIBERS_PATH, overrides());
  if (!file) return { sha: null, subscribers: [] };
  const parsed = JSON.parse(file.content);
  return { sha: file.sha, subscribers: Array.isArray(parsed.subscribers) ? parsed.subscribers : [] };
}

async function writeSubscribers(subscribers, commitMessage) {
  const content = JSON.stringify({ subscribers }, null, 2) + '\n';
  await commitFile(SUBSCRIBERS_PATH, content, commitMessage, overrides());
}

// Adds a new subscriber, or merges topics into an existing one (a repeat
// signup adds to their existing topics rather than replacing them, so
// subscribing again for a different pod doesn't drop the ones already
// picked). Retries once on a 409 (two signups landing at the same moment —
// same underlying race as concurrent commits in api/update-market-pulse.js,
// but at this volume a single retry is enough rather than the sequential-
// commit-phase approach that fixed it there).
// Returns the resulting subscriber record ({ email, topics, unsubscribeToken })
// — with ALL of their topics, old and new merged — so the caller
// (api/subscribe.js) can send a welcome email reflecting their complete,
// current picks rather than just what was submitted in this request.
async function addOrUpdateSubscriber(email, topics, attempt = 0) {
  const normalized = normalizeEmail(email);
  const { subscribers } = await readSubscribers();

  let record = subscribers.find((s) => normalizeEmail(s.email) === normalized);
  if (record) {
    record.topics = [...new Set([...(record.topics || []), ...topics])];
  } else {
    record = {
      email: normalized,
      topics: [...new Set(topics)],
      unsubscribeToken: crypto.randomBytes(16).toString('hex'),
    };
    subscribers.push(record);
  }

  try {
    await writeSubscribers(subscribers, `Subscribe/update ${normalized}`);
  } catch (err) {
    if (attempt === 0 && /409/.test(err.message)) {
      return addOrUpdateSubscriber(email, topics, attempt + 1);
    }
    throw err;
  }

  return record;
}

// The full subscriber list, for the daily cron to send one combined email
// per subscriber — it needs everyone's topics at once to work out which of
// today's published sections belong in each person's single email, rather
// than looking up one topic at a time.
async function getAllSubscribers() {
  const { subscribers } = await readSubscribers();
  return subscribers;
}

// Removes a subscriber entirely (all topics) if their token matches — full
// unsubscribe, not per-topic, since a single one-click "stop all emails"
// link is what anti-spam law (CAN-SPAM) actually requires. Returns false
// (without erroring) if the email/token pair doesn't match anything, so the
// unsubscribe page can show a generic "done" state either way rather than
// leaking whether an address was ever subscribed.
async function removeSubscriber(email, token) {
  const normalized = normalizeEmail(email);
  const { subscribers } = await readSubscribers();

  const index = subscribers.findIndex(
    (s) => normalizeEmail(s.email) === normalized && s.unsubscribeToken === token
  );
  if (index === -1) return false;

  subscribers.splice(index, 1);
  await writeSubscribers(subscribers, `Unsubscribe ${normalized}`);
  return true;
}

module.exports = { addOrUpdateSubscriber, getAllSubscribers, removeSubscriber };
