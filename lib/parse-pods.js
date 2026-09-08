// Markdown-content parsing shared by scripts/build.js (build time, generates
// the static pages) and api/update-market-pulse.js (runtime, needs to know
// which tickers are on someone's Watchlist so it can fetch live quotes for
// them). Kept in one place so the two never drift out of sync on what counts
// as valid frontmatter/entries/watchlist syntax.

const fs = require('fs');
const path = require('path');

// Splits "---\nkey: value\n---\n<body>" into { frontmatter, body }.
function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    frontmatter[key] = value;
  }
  return { frontmatter, body: match[2] };
}

// Pulls an optional "## Watchlist" section out of a pod's body — a short,
// hand-maintained list of securities the pod lead flags as worth watching
// today, independent of the dated entries below it. Lives anywhere in the
// file (the heading regex for dated entries only matches YYYY-MM-DD headings,
// so a "## Watchlist" heading is otherwise ignored by parseEntries). Format:
//   ## Watchlist
//   - $JPM: Reports Q3 earnings before the open
//   - $KEY: Shareholder vote on the merger today
function parseWatchlist(body) {
  const headingMatch = body.match(/^##\s+Watchlist\s*$/im);
  if (!headingMatch) return { watchlist: [], remainingBody: body };

  const sectionStart = headingMatch.index;
  const afterHeading = sectionStart + headingMatch[0].length;
  const rest = body.slice(afterHeading);
  const nextHeadingMatch = rest.match(/^##\s+/m);
  const sectionEnd = nextHeadingMatch ? afterHeading + nextHeadingMatch.index : body.length;
  const section = body.slice(afterHeading, sectionEnd);

  const watchlist = [];
  const lineRe = /^-\s*\$([A-Za-z.]{1,6})\s*:\s*(.+)$/gm;
  let match;
  while ((match = lineRe.exec(section))) {
    watchlist.push({ ticker: match[1].toUpperCase(), note: match[2].trim() });
  }

  const remainingBody = body.slice(0, sectionStart) + body.slice(sectionEnd);
  return { watchlist, remainingBody };
}

// Parses "## YYYY-MM-DD\n**Headline**\nBody text. Tickers: $A, $B\nSources: X, Y"
// blocks into entries. The Sources line is optional but strongly encouraged —
// citing what informed the analysis (a filing, an earnings call, a named
// outlet) is what separates real research from an unsourced take.
function parseEntries(body) {
  const entries = [];
  const headingRe = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/gm;
  const matches = [...body.matchAll(headingRe)];

  for (let i = 0; i < matches.length; i++) {
    const date = matches[i][1];
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    const block = body.slice(start, end).trim();

    const lines = block.split(/\r?\n/);
    let headline = '';
    let bodyLines = [];

    if (lines.length > 0) {
      const headlineMatch = lines[0].match(/^\*\*(.+)\*\*$/);
      headline = headlineMatch ? headlineMatch[1].trim() : lines[0].trim();
      bodyLines = lines.slice(1);
    }

    let bodyText = bodyLines.join('\n').trim();

    let tickers = [];
    const tickerLineMatch = bodyText.match(/Tickers:\s*(.+)$/im);
    if (tickerLineMatch) {
      tickers = (tickerLineMatch[1].match(/\$[A-Za-z.]{1,6}/g) || []).map((t) => t.toUpperCase());
      bodyText = bodyText.replace(tickerLineMatch[0], '').trim();
    }

    let sources = '';
    const sourcesLineMatch = bodyText.match(/Sources?:\s*(.+)$/im);
    if (sourcesLineMatch) {
      sources = sourcesLineMatch[1].trim();
      bodyText = bodyText.replace(sourcesLineMatch[0], '').trim();
    }

    entries.push({ date, headline, body: bodyText, tickers, sources });
  }

  // Newest first, regardless of source order.
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return entries;
}

// Collects every unique ticker across every pod's Watchlist section. Used by
// the daily cron to know which symbols to fetch live quotes for — it doesn't
// need entries or frontmatter, just the tickers.
function collectAllWatchlistTickers(contentDir, podSlugs) {
  const tickers = new Set();
  for (const slug of podSlugs) {
    const filePath = path.join(contentDir, `${slug}.md`);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf8');
    const { body } = splitFrontmatter(raw);
    const { watchlist } = parseWatchlist(body);
    for (const item of watchlist) tickers.add(item.ticker);
  }
  return [...tickers];
}

// Where a new dated entry should land in a pod's body: right after any
// "## Watchlist" section (if present), before the first dated entry — new
// entries always land at the top of the feed.
function getEntryInsertionPoint(body) {
  const headingMatch = body.match(/^##\s+Watchlist\s*$/im);
  if (!headingMatch) return 0;
  const afterHeading = headingMatch.index + headingMatch[0].length;
  const rest = body.slice(afterHeading);
  const nextHeadingMatch = rest.match(/^##\s+/m);
  return nextHeadingMatch ? afterHeading + nextHeadingMatch.index : body.length;
}

// Builds the "## YYYY-MM-DD\n**Headline**\n...\nTickers: ...\nSources: ..."
// block for a new entry, in the exact format parseEntries() expects back.
function formatEntryBlock({ date, headline, body, tickers, sources }) {
  const lines = [`## ${date}`, `**${headline}**`, body];
  if (tickers && tickers.length) lines.push(`Tickers: ${tickers.map((t) => `$${t}`).join(', ')}`);
  if (sources) lines.push(`Sources: ${sources}`);
  return `\n${lines.join('\n')}\n\n`;
}

// Reads a pod's raw file content and returns a new raw file string with the
// given entry prepended (right after frontmatter and any Watchlist section,
// before the first dated entry). Used by the daily cron to publish each
// pod's AI-generated brief without disturbing anything else in the file —
// frontmatter, Watchlist, and every prior entry survive untouched.
function prependEntry(raw, entry) {
  const { frontmatter, body } = splitFrontmatter(raw);
  const insertionPoint = getEntryInsertionPoint(body);
  const newBody = body.slice(0, insertionPoint) + formatEntryBlock(entry) + body.slice(insertionPoint);

  const frontmatterLines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`);
  return `---\n${frontmatterLines.join('\n')}\n---\n${newBody}`;
}

module.exports = {
  splitFrontmatter,
  parseWatchlist,
  parseEntries,
  collectAllWatchlistTickers,
  getEntryInsertionPoint,
  prependEntry,
};
