#!/usr/bin/env node
// Build script: reads content/pods/*.md, generates the static site into public/.
// Run via `npm run build`. No markdown/frontmatter libraries — the content format
// is simple and fixed on purpose, so a small hand-written parser is enough.

const fs = require('fs');
const path = require('path');
const { SITE_NAME, PODS, pageShell, escapeHtml, BUILD_ID } = require('../templates/partials');
const { splitFrontmatter, parseWatchlist, parseEntries } = require('../lib/parse-pods');

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content', 'pods');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SRC_DIR = path.join(ROOT, 'src');
const DATA_DIR = path.join(ROOT, 'data');

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function loadPods() {
  const files = fs.existsSync(CONTENT_DIR)
    ? fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'))
    : [];

  const pods = PODS.map((pod) => {
    const filePath = path.join(CONTENT_DIR, `${pod.slug}.md`);
    if (!files.includes(`${pod.slug}.md`)) {
      console.warn(`Warning: no content file found for pod "${pod.name}" (expected ${filePath})`);
      return { ...pod, entries: [] };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, body } = splitFrontmatter(raw);
    const name = frontmatter.pod || pod.name;
    const { watchlist, remainingBody } = parseWatchlist(body);
    const entries = parseEntries(remainingBody);
    const pinned = frontmatter.pinned === 'true';
    const sample = frontmatter.sample === 'true';
    return { slug: pod.slug, name, entries, watchlist, pinned, sample };
  });

  return pods;
}

// Nav (and homepage grid) order: alphabetical by pod name, except any pod(s)
// a pod lead has marked `pinned: true` in their own file's frontmatter move
// to the front (alphabetical among themselves if more than one is pinned).
// No admin panel needed — it's just a frontmatter flag pod leads set on their
// own file, same as everything else in the content model.
function computeNavOrder(pods) {
  const sorted = [...pods].sort((a, b) => a.name.localeCompare(b.name));
  const pinned = sorted.filter((p) => p.pinned);
  const rest = sorted.filter((p) => !p.pinned);
  return [...pinned, ...rest];
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// --- Page rendering -----------------------------------------------------

function renderTickerTags(tickers) {
  if (!tickers.length) return '';
  return `<div class="ticker-tags">${tickers
    .map((t) => `<span class="ticker-tag">${escapeHtml(t)}</span>`)
    .join('')}</div>`;
}

function renderEntry(entry) {
  const sourcesHtml = entry.sources
    ? `<p class="entry-sources">Sources: ${escapeHtml(entry.sources)}</p>`
    : '';

  return `<article class="entry" id="${entry.date}">
        <div class="entry-date">${formatDate(entry.date)}</div>
        <h3 class="entry-headline">${escapeHtml(entry.headline)}</h3>
        <p class="entry-body">${escapeHtml(entry.body)}</p>
        ${renderTickerTags(entry.tickers)}
        ${sourcesHtml}
      </article>`;
}

// The pod's newest entry gets the full mktbrief-style article treatment —
// big headline, mono byline, drop-capped body — since it's the thing a
// visitor to this pod's page is actually here to read.
function renderFeaturedEntry(entry) {
  const tickersHtml = entry.tickers.length
    ? `<span>${entry.tickers.map((t) => escapeHtml(t)).join(' &middot; ')}</span>`
    : '';
  const sourcesHtml = entry.sources ? `<span>Sources: ${escapeHtml(entry.sources)}</span>` : '';

  return `<article class="entry entry-featured" id="${entry.date}">
        <h1 class="article-hed">${escapeHtml(entry.headline)}</h1>
        <div class="byline">
          <span>${formatDate(entry.date)}</span>
          ${tickersHtml}
          ${sourcesHtml}
        </div>
        <p class="entry-body">${escapeHtml(entry.body)}</p>
      </article>`;
}

// The `data-ticker` attribute and empty `.watchlist-quote` span are for
// src/js/watchlist-quotes.js to fill in client-side from
// data/watchlist-quotes.json (written by the same daily cron that updates
// Today's Brief) — the build has no live price to bake in at deploy time.
function renderWatchlistSidebar(watchlist) {
  if (!watchlist.length) return '';

  const itemsHtml = watchlist
    .map(
      (item) => `<li data-ticker="${escapeHtml(item.ticker)}">
            <div class="watchlist-ticker-row">
              <span class="watchlist-ticker">$${escapeHtml(item.ticker)}</span>
              <span class="watchlist-quote"></span>
            </div>
            <span class="watchlist-note">${escapeHtml(item.note)}</span>
          </li>`
    )
    .join('\n          ');

  return `<aside class="sidebar">
        <hr class="sidebar-rule" />
        <div class="sidebar-label">Securities to Note</div>
        <ul class="watchlist">
          ${itemsHtml}
        </ul>
      </aside>`;
}

function renderPodPage(pod, navPods) {
  const [latest, ...previous] = pod.entries;

  const latestHtml = latest
    ? renderFeaturedEntry(latest)
    : `<p class="empty-state">No updates yet. Check back soon.</p>`;

  // Older entries are collapsed behind a native <details> disclosure rather
  // than always shown — a plain HTML/CSS toggle, no JS needed. This replaced
  // a separate cross-pod Archive page: "previous briefs" now just means this
  // pod's own older entries, one click away, right under today's.
  const previousHtml = previous.length
    ? `<details class="previous-briefs">
        <summary class="previous-briefs-toggle">View previous briefs (${previous.length})</summary>
        <div class="entry-feed previous-briefs-list">
          ${previous.map((entry) => renderEntry(entry)).join('\n          ')}
        </div>
      </details>`
    : '';

  const sampleBanner = pod.sample
    ? `<p class="sample-note">These entries are sample content included to demonstrate the format — not real research. Remove the "sample: true" line from this pod's frontmatter once real briefs are added.</p>`
    : '';

  const sidebarHtml = renderWatchlistSidebar(pod.watchlist);
  const pageWrapClass = sidebarHtml ? 'page-wrap' : 'page-wrap single';

  const bodyHtml = `<div class="${pageWrapClass}">
      <div class="main-col">
        <div class="kicker">
          <span>${escapeHtml(pod.name)}</span>
          <button class="star-toggle" id="star-toggle" data-slug="${pod.slug}" aria-pressed="false" title="Pin to the top of your homepage">
            <span class="star-icon" aria-hidden="true">&#9734;</span>
            <span class="star-label">Pin to your homepage</span>
          </button>
        </div>
        ${sampleBanner}
        ${latestHtml}
        ${previousHtml}
      </div>
      ${sidebarHtml}
    </div>`;

  return pageShell({
    title: `${pod.name} — ${SITE_NAME}`,
    description: `${pod.name} sector briefs, written by student analysts in the Neeley Equity Research Club.`,
    activeSlug: pod.slug,
    rootPrefix: '../',
    bodyHtml,
    navPods,
  });
}

function renderPodCard(pod) {
  const latest = pod.entries[0];
  const meta = latest
    ? `<div class="pod-card-date">${formatDate(latest.date)}</div>
       <div class="pod-card-headline">${escapeHtml(latest.headline)}</div>`
    : `<div class="pod-card-empty">No briefs yet</div>`;

  return `<a class="pod-card" href="pods/${pod.slug}.html" data-slug="${pod.slug}">
        <div class="pod-card-name">${escapeHtml(pod.name)}</div>
        ${meta}
        <div class="pod-card-cta">Read today's brief &rarr;</div>
      </a>`;
}

function renderHomepage(pods, navPods) {
  const cardsHtml = navPods.map(renderPodCard).join('\n      ');

  // Ticker markup is intentionally minimal — src/js/market-pulse.js fills in
  // #ticker-track (duplicated once for a seamless CSS scroll loop) once
  // data/market-pulse.json loads. Sits outside .site-main so it can bleed
  // full-bleed above the nav.
  const tickerHtml = `<div class="ticker-tape" id="ticker-tape">
      <div class="ticker-track" id="ticker-track">
        <span class="ticker-item ticker-loading">Loading market data&hellip;</span>
      </div>
    </div>`;

  const bodyHtml = `<section class="today-brief" id="today-brief">
      <div class="page-wrap">
        <div class="main-col">
          <div class="kicker">Daily Market Briefing</div>
          <div class="market-status" id="market-status" hidden></div>
          <h1 class="article-hed" id="article-hed">Loading today&rsquo;s brief&hellip;</h1>
          <div class="article-deck" id="article-deck"></div>
          <div class="byline">
            <span id="byline-date"></span>
            <span id="byline-sources">Data: Finnhub</span>
            <span class="auto-tag" title="Compiled automatically from live market data and news headlines — not written or reviewed by a club member.">AI-generated</span>
          </div>
          <div class="entry-featured">
            <p class="entry-body" id="article-body"></p>
          </div>
          <div class="section-label">Notable Movers</div>
          <div class="movers-grid" id="movers-grid">
            <p class="movers-loading">Loading market data&hellip;</p>
          </div>
        </div>
        <aside class="sidebar">
          <hr class="sidebar-rule" />
          <div class="ai-box">
            <div class="ai-box-head"><span class="pulse-dot"></span>About this briefing</div>
            <div class="ai-box-body">This summary, and every sector brief below, is generated automatically each trading morning from live market data and news headlines &mdash; no club member writes or reviews it before publishing.</div>
          </div>
        </aside>
      </div>
    </section>

    <div class="section-divider" aria-hidden="true"><span>&#10022;</span></div>

    <section class="pods-section">
      <header class="page-header">
        <h1>Pod Briefs</h1>
        <p class="page-subtitle">Select your pod for today's sector-specific brief</p>
      </header>
      <div class="pods-grid" id="pods-grid">
        ${cardsHtml}
      </div>
    </section>`;

  return pageShell({
    title: SITE_NAME,
    description: `${SITE_NAME} — daily markets brief from the Neeley Equity Research Club at TCU, organized by sector pod.`,
    activeSlug: 'home',
    rootPrefix: '',
    bodyHtml,
    tickerHtml,
    navPods,
    extraHead: `<script src="js/market-pulse.js?v=${BUILD_ID}" defer></script>`,
  });
}

// Cross-pod archive: every entry ever published, across every pod, newest
// first. Nothing new to persist — every entry already lives permanently in
// its pod's markdown file; this just aggregates and re-sorts at build time.
// A lighter-weight "index" listing (date + headline only) rather than full
// articles — the full read lives on each pod's own page, one click away.
function renderArchivePage(pods, navPods) {
  const allEntries = [];
  for (const pod of pods) {
    for (const entry of pod.entries) {
      allEntries.push({ entry, podName: pod.name, href: `pods/${pod.slug}.html` });
    }
  }

  allEntries.sort((a, b) =>
    a.entry.date < b.entry.date ? 1 : a.entry.date > b.entry.date ? -1 : a.podName.localeCompare(b.podName)
  );

  const itemsHtml = allEntries.length
    ? allEntries
        .map(
          ({ entry, podName, href }) => `<a class="archive-item" href="${href}#${entry.date}">
        <div class="archive-item-date">${formatDate(entry.date)} &middot; ${escapeHtml(podName)}</div>
        <div class="archive-item-hed">${escapeHtml(entry.headline)}</div>
      </a>`
        )
        .join('\n      ')
    : `<p class="empty-state">No briefs published yet.</p>`;

  const bodyHtml = `<div class="about-wrap">
      <div class="kicker">Past Editions</div>
      <h1>Archive</h1>
      <div class="archive-list">
        ${itemsHtml}
      </div>
    </div>`;

  return pageShell({
    title: `Archive — ${SITE_NAME}`,
    description: `Full archive of AI-generated sector briefs across all pods in the Neeley Equity Research Club.`,
    activeSlug: 'archive',
    rootPrefix: '',
    bodyHtml,
    navPods,
  });
}

function renderAboutPage(navPods) {
  const bodyHtml = `<div class="about-wrap">
      <div class="kicker">About This Publication</div>
      <h1>What is ${SITE_NAME}?</h1>
      <p>${SITE_NAME} is the website of the Neeley Equity Research Club, a student equity research club at TCU's Neeley School of Business organized into sector "pods." Every sector brief and the homepage's Today's Brief are generated automatically, without a club member writing or reviewing them before they're published.</p>
      <p>Pod content still lives in one plain Markdown file per pod, with no CMS, admin panel, or database &mdash; a club member can still curate a pod by editing its file directly (flagging a "Securities to Note" list, pinning a pod to the top of the homepage), the automated pipeline just handles the daily writing.</p>

      <h2>How it works</h2>
      <p>A scheduled job runs every trading morning, about an hour before the market opens. It checks the NYSE holiday calendar, pulls index levels, the 10-year Treasury yield, VIX, and news headlines to write Today's Brief, and separately pulls recent news for a representative ticker in each sector and asks an AI model to write that pod's brief from it. Everything is committed straight to this site's repository, which triggers an automatic rebuild.</p>
      <p>The same job scans every pod's "Securities to Note" list and fetches a live quote for each ticker flagged there.</p>

      <h2>Data sources</h2>
      <ul>
        <li><strong>Finnhub</strong> &mdash; index levels, 10-year Treasury yield proxy, VIX, watchlist quotes, and news headlines</li>
        <li><strong>Anthropic API</strong> &mdash; writes each sector brief from the news headlines above</li>
      </ul>

      <h2>Disclaimer</h2>
      <p>${SITE_NAME} is for informational and educational purposes only and does not constitute financial advice. Both the homepage market summary and every sector brief are generated automatically and may contain errors, omissions, or outdated information. Always consult a licensed financial advisor before making investment decisions. Market data may be delayed.</p>
    </div>`;

  return pageShell({
    title: `About — ${SITE_NAME}`,
    description: `What ${SITE_NAME} is, how its daily automation works, and where its data comes from.`,
    activeSlug: 'about',
    rootPrefix: '',
    bodyHtml,
    navPods,
  });
}

function renderNotFoundPage(navPods) {
  const bodyHtml = `<div class="about-wrap">
      <div class="kicker">404</div>
      <h1>Page Not Found</h1>
      <p>That page doesn't exist, or the link is out of date. Head back to the <a href="index.html">homepage</a> for today's brief, or pick a pod from the nav above.</p>
    </div>`;

  return pageShell({
    title: `Page Not Found — ${SITE_NAME}`,
    description: `Page not found.`,
    activeSlug: null,
    rootPrefix: '',
    bodyHtml,
    navPods,
  });
}

// --- Main -----------------------------------------------------------------

function main() {
  rmrf(PUBLIC_DIR);
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  copyDir(path.join(SRC_DIR, 'css'), path.join(PUBLIC_DIR, 'css'));
  copyDir(path.join(SRC_DIR, 'js'), path.join(PUBLIC_DIR, 'js'));

  fs.mkdirSync(path.join(PUBLIC_DIR, 'data'), { recursive: true });
  // nyse-holidays.json is copied too so the homepage can check client-side,
  // on every page load, whether *today* is actually a trading day — see
  // src/js/market-pulse.js. That's independent of whether the cron happened
  // to run (Hobby-plan cron timing drifts, and it doesn't write anything on
  // non-trading days), so it stays correct even if the stored market-pulse
  // data is a day or more stale.
  for (const dataFile of ['market-pulse.json', 'watchlist-quotes.json', 'nyse-holidays.json']) {
    const src = path.join(DATA_DIR, dataFile);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(PUBLIC_DIR, 'data', dataFile));
    }
  }

  const pods = loadPods();
  const navPods = computeNavOrder(pods);

  fs.mkdirSync(path.join(PUBLIC_DIR, 'pods'), { recursive: true });
  for (const pod of pods) {
    fs.writeFileSync(path.join(PUBLIC_DIR, 'pods', `${pod.slug}.html`), renderPodPage(pod, navPods));
  }

  fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), renderHomepage(pods, navPods));
  fs.writeFileSync(path.join(PUBLIC_DIR, 'archive.html'), renderArchivePage(pods, navPods));
  fs.writeFileSync(path.join(PUBLIC_DIR, 'about.html'), renderAboutPage(navPods));
  fs.writeFileSync(path.join(PUBLIC_DIR, '404.html'), renderNotFoundPage(navPods));
  fs.writeFileSync(path.join(PUBLIC_DIR, 'robots.txt'), 'User-agent: *\nAllow: /\n');

  const totalEntries = pods.reduce((sum, p) => sum + p.entries.length, 0);
  console.log(`Built ${pods.length} pod pages (${totalEntries} entries total) into public/.`);
}

main();
