// Shared HTML partials used by scripts/build.js to generate every page.
// This is the ONLY place nav/header/footer markup lives — edit here, not in generated HTML.

const SITE_NAME = 'The Daily Tape';

// `bellwethers` are the tickers api/update-market-pulse.js pulls company news
// for when it generates that pod's AI-written daily brief — see
// generateSectorBrief() in api/lib/anthropic-client.js. Using three per pod
// (not one) is deliberate: news for a single company reads as "here's what
// Apple did today," not "here's what's happening in tech" — pooling headlines
// across a few representative names is what lets the model write about the
// sector broadly instead of one company's story.
const PODS = [
  { slug: 'financials-real-estate', name: 'Financials & Real Estate', bellwethers: ['JPM', 'BAC', 'PLD'] },
  { slug: 'technology', name: 'Technology', bellwethers: ['AAPL', 'MSFT', 'NVDA'] },
  { slug: 'healthcare', name: 'Healthcare', bellwethers: ['UNH', 'JNJ', 'LLY'] },
  { slug: 'consumer-discretionary-staples', name: 'Consumer Discretionary/Staples', bellwethers: ['WMT', 'HD', 'PG'] },
  { slug: 'energy-power', name: 'Energy & Power', bellwethers: ['XOM', 'CVX', 'NEE'] },
  { slug: 'industrial-materials', name: 'Industrial & Materials', bellwethers: ['CAT', 'HON', 'LIN'] },
  { slug: 'communication-platforms', name: 'Communication & Platforms', bellwethers: ['META', 'GOOGL', 'VZ'] },
];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Masthead: left-aligned wordmark with primary tabs (Home/Archive/About) to
// its right, then a separate mono-uppercase sector-nav row below for the
// seven pods — a two-tier hierarchy: site-level tabs up top, sector
// sub-navigation below. Modeled on a classic newspaper-style digital
// masthead, not a centered logo or a single flat navbar.
//
// navPods is the pre-ordered pod list to render (alphabetical, with any
// pod(s) marked `pinned: true` in their own content file moved to the
// front) — see computeNavOrder() in scripts/build.js. Falls back to the
// roster's declared order if not provided.
function renderNav(activeSlug, rootPrefix, navPods = PODS) {
  const links = navPods.map((pod) => {
    const href = `${rootPrefix}pods/${pod.slug}.html`;
    const activeClass = pod.slug === activeSlug ? ' class="active"' : '';
    return `<li><a href="${href}"${activeClass}>${escapeHtml(pod.name)}</a></li>`;
  }).join('\n        ');

  const tabClass = (slug) => (activeSlug === slug ? ' class="active"' : '');

  return `<header class="masthead">
      <div class="masthead-inner">
        <div class="masthead-top">
          <a class="masthead-logo" href="${rootPrefix}index.html">The Daily <span class="logo-accent">Tape</span></a>
          <ul class="masthead-tabs">
            <li><a href="${rootPrefix}index.html"${tabClass('home')}>Home</a></li>
            <li><a href="${rootPrefix}archive.html"${tabClass('archive')}>Archive</a></li>
            <li><a href="${rootPrefix}about.html"${tabClass('about')}>About</a></li>
          </ul>
        </div>
        <nav class="site-nav">
          <ul class="nav-links">
            ${links}
          </ul>
        </nav>
      </div>
    </header>`;
}

function renderFooter() {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
      <strong>${SITE_NAME}</strong><br />
      AI-generated daily market briefs &middot; Published every trading morning before the opening bell<br />
      Market data: Finnhub &middot; Sector briefs written by artificial intelligence &middot; Not investment advice<br />
      &copy; ${year} Neeley Equity Research Club
    </footer>`;
}

// Email signup, rendered on every page just above the footer. Posts to
// /api/subscribe (api/subscribe.js), which forwards to Buttondown with the
// checked pods as tags — see BUTTONDOWN_API_KEY in .env.local.example and
// api/lib/buttondown-client.js. Site-root-absolute form action/fetch path
// for the same reason as watchlist-quotes.js: this partial renders at every
// page depth (site root and /pods/*.html alike).
function renderSubscribeForm(navPods = PODS) {
  const checkboxes = navPods
    .map(
      (pod) => `<label class="subscribe-pod">
            <input type="checkbox" name="pods" value="${pod.slug}" />
            ${escapeHtml(pod.name)}
          </label>`
    )
    .join('\n          ');

  return `<section class="subscribe-box" id="subscribe">
      <div class="subscribe-inner">
        <div class="subscribe-label">Get sector briefs in your inbox</div>
        <p class="subscribe-copy">Pick the pods you care about. You'll get that pod's AI-generated brief by email whenever it's published on a trading day.</p>
        <form id="subscribe-form" class="subscribe-form" novalidate>
          <input type="email" name="email" placeholder="you@email.com" required aria-label="Email address" />
          <div class="subscribe-pods">
            ${checkboxes}
          </div>
          <button type="submit">Subscribe</button>
          <p class="subscribe-status" id="subscribe-status" role="status" aria-live="polite"></p>
        </form>
      </div>
    </section>`;
}

// rootPrefix: '' for pages at site root, '../' for pages one level down (e.g. /pods/*.html)
// tickerHtml: optional markup rendered above the masthead (used for the homepage's
// scrolling stock ticker) — kept separate from bodyHtml because it needs to
// sit outside .site-main's max-width container to bleed edge-to-edge.
// Cache-busting query param for CSS/JS assets. Computed once when this
// module loads (i.e. once per `npm run build` run), so every page in a given
// build shares the same value, but a new build/deploy gets a new one. Without
// this, a browser that cached an old market-pulse.js or style.css from a
// prior visit can keep running stale code indefinitely against a live site
// whose JSON data or markup has since changed — filenames here never change,
// so nothing else invalidates that cache.
const BUILD_ID = Date.now();

const FAVICON_DATA_URI =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgZmlsbD0nIzFhMTgxNCcvPjx0ZXh0IHg9JzUwJyB5PSc3NCcgZm9udC1zaXplPSc2OCcgZm9udC1mYW1pbHk9J0dlb3JnaWEsIHNlcmlmJyBmb250LXdlaWdodD0nOTAwJyBmaWxsPScjOWE3MDAwJyB0ZXh0LWFuY2hvcj0nbWlkZGxlJz5UPC90ZXh0Pjwvc3ZnPg==';

function pageShell({ title, description, activeSlug, rootPrefix = '', bodyHtml, extraHead = '', tickerHtml = '', navPods }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description || '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}" />
  <meta name="theme-color" content="#1a1814" />
  <link rel="icon" href="${FAVICON_DATA_URI}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=IBM+Plex+Sans:wght@300;400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" />
  <link rel="stylesheet" href="${rootPrefix}css/style.css?v=${BUILD_ID}" />
  ${extraHead}
</head>
<body>
  ${tickerHtml}
  ${renderNav(activeSlug, rootPrefix, navPods)}
  <main class="site-main">
    ${bodyHtml}
  </main>
  ${renderSubscribeForm(navPods)}
  ${renderFooter()}
  <script src="${rootPrefix}js/pod-star.js?v=${BUILD_ID}" defer></script>
  <script src="${rootPrefix}js/watchlist-quotes.js?v=${BUILD_ID}" defer></script>
  <script src="${rootPrefix}js/subscribe-form.js?v=${BUILD_ID}" defer></script>
</body>
</html>
`;
}

module.exports = { SITE_NAME, PODS, pageShell, renderNav, renderFooter, renderSubscribeForm, escapeHtml, BUILD_ID };
