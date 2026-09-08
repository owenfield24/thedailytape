// Vercel Serverless Function, run daily via the cron entry in vercel.json.
//
// What it does:
//   1. Checks whether today is a US trading day (weekday + not an NYSE holiday).
//      If not, exits without doing anything.
//   2. If it is, fetches S&P 500 / Dow / Nasdaq (as SPY/DIA/QQQ ETF proxies —
//      see api/lib/market-data-finnhub.js for why) and general market
//      headlines from Finnhub, the real 10-year Treasury yield from FRED
//      (api/lib/market-data-fred.js), then asks Claude
//      (generateMarketBrief() in api/lib/anthropic-client.js) to write
//      Today's Brief — a headline, one-line deck, and a 2-3 paragraph
//      analysis — grounded in those actual moves and headlines. There is no
//      VIX figure on this site: no free source gives the real index value
//      (see market-data-finnhub.js's comment for what was tried).
//   3. Scans every pod's content file for a "## Watchlist" section (see
//      lib/parse-pods.js) and fetches a live quote for each ticker flagged
//      there — this is what powers the current-price shown next to each
//      ticker in a pod page's "Securities to Note" sidebar.
//   4. For each of the seven pods, fetches recent news for that pod's three
//      "bellwether" tickers (see PODS in templates/partials.js), pools and
//      dedupes the headlines, and asks Claude (api/lib/anthropic-client.js)
//      to write that pod's daily brief broadly about the sector from them —
//      several companies' worth of headlines, not one, is what keeps the
//      brief from reading like a single-stock news item. The result is
//      prepended as a new dated entry in that pod's own
//      content/pods/<slug>.md — this is the whole reason a pod's content file
//      is no longer something a human needs to edit by hand day to day.
//   5. Writes everything (data/market-pulse.json, data/watchlist-quotes.json,
//      and each updated content/pods/<slug>.md) by committing directly to the
//      GitHub repo via the GitHub REST API (a real `git commit` isn't
//      possible from inside a serverless function). Each push triggers
//      Vercel's normal git-integration auto-deploy, which rebuilds the static
//      site — pages pick up the fresh JSON via plain client-side fetches
//      (src/js/market-pulse.js, src/js/watchlist-quotes.js), and the new pod
//      entries show up as regular static HTML from the next build onward.
//
// Requires FINNHUB_API_KEY, FRED_API_KEY, GITHUB_TOKEN, GITHUB_REPO, and
// ANTHROPIC_API_KEY.
//
// content/pods/*.md is read directly off disk at runtime (see below), which
// needs the "includeFiles" entry for this function in vercel.json — Vercel's
// automatic file-tracing can miss files read via a dynamic path built from
// fs.readdirSync() rather than a static require()/readFileSync() call.
//
// Sector brief generation for all seven pods runs in parallel (each pod
// writes a different file, so there's no shared-state conflict) to keep this
// function's total wall-clock time down — with Finnhub + Claude round trips
// per pod, running them sequentially could approach Vercel's function
// duration limit. vercel.json sets this function's `maxDuration` higher than
// the default to give it headroom regardless.
//
// --- Cron scheduling notes (read this before touching vercel.json) ---
//
// The cron is set to "30 13 * * *" (13:30 UTC), which is ~1 hour before the
// 9:30 AM ET market open ONLY while US clocks are on Eastern Daylight Time
// (UTC-4, roughly mid-March to early November). During Eastern Standard Time
// (UTC-5, roughly early November to mid-March) 13:30 UTC is 8:30 AM ET, i.e.
// the run drifts an hour earlier relative to market open. Vercel's cron
// expression is fixed in UTC and does NOT shift itself for US daylight saving.
//
// ACTION NEEDED twice a year: after the US clock change each March and
// November, nudge the hour in vercel.json by ±1 (12:30 UTC in the winter,
// 13:30 UTC in the summer) if you want the run to stay ~1 hour before the
// open. This manual nudge is simpler than fighting timezone math in a single
// static cron expression, especially on the Hobby plan.
//
// Also note: Vercel's Hobby plan allows only one cron invocation per day, and
// its timing precision is approximate (documented as within ~59 minutes of
// the scheduled time, not exact-to-the-minute). Don't be surprised if this
// doesn't fire at the exact same second every day — that's expected on
// Hobby. If exact timing ever matters, Vercel Pro supports more frequent and
// more precise cron scheduling.

const fs = require('fs');
const path = require('path');
const { isTradingDay } = require('./lib/nyse-calendar');
const { fetchMarketData, fetchWatchlistQuotes, fetchCompanyNews } = require('./lib/market-data-finnhub');
const { fetchTreasury10y } = require('./lib/market-data-fred');
const { generateMarketBrief, generateSectorBrief } = require('./lib/anthropic-client');
const { commitFile } = require('./lib/github-commit');
const { collectAllWatchlistTickers, prependEntry } = require('../lib/parse-pods');
const { PODS } = require('../templates/partials');

const MARKET_PULSE_PATH = 'data/market-pulse.json';
const WATCHLIST_QUOTES_PATH = 'data/watchlist-quotes.json';
const CONTENT_DIR = path.join(__dirname, '..', 'content', 'pods');

module.exports = async function handler(req, res) {
  try {
    const { tradingDay, reason, isoDate } = isTradingDay();

    if (!tradingDay) {
      res.status(200).json({ skipped: true, reason, date: isoDate });
      return;
    }

    const [{ indices, headlines }, treasury10y] = await Promise.all([fetchMarketData(), fetchTreasury10y()]);
    const brief = await generateMarketBrief({ indices, treasury10y, headlines });
    const sources = [...new Set(headlines.map((h) => h.source))].join(', ');

    const marketPulsePayload = {
      asOf: new Date().toISOString(),
      tradingDay: true,
      indices,
      treasury10y,
      headline: brief.headline,
      deck: brief.deck,
      body: brief.body,
      sources,
    };

    await commitFile(
      MARKET_PULSE_PATH,
      JSON.stringify(marketPulsePayload, null, 2) + '\n',
      `Update market pulse data for ${isoDate}`
    );

    const tickers = collectAllWatchlistTickers(CONTENT_DIR, PODS.map((pod) => pod.slug));
    const quotes = await fetchWatchlistQuotes(tickers);

    const watchlistPayload = { asOf: new Date().toISOString(), quotes };

    await commitFile(
      WATCHLIST_QUOTES_PATH,
      JSON.stringify(watchlistPayload, null, 2) + '\n',
      `Update watchlist quotes for ${isoDate}`
    );

    // One pod's news/model/commit failure shouldn't take down the other six —
    // each is independent, so failures are caught and reported per-pod.
    const sectorBriefResults = await Promise.all(
      PODS.map(async (pod) => {
        try {
          // News for several representative tickers, not just one, pooled
          // together — this is what lets the model write about the sector
          // broadly ("banks are seeing X") rather than one company's story
          // ("JPMorgan said X"). Deduped by headline text since the same
          // story often gets picked up under more than one ticker.
          const headlineLists = await Promise.all(pod.bellwethers.map((ticker) => fetchCompanyNews(ticker)));
          const seen = new Set();
          const headlines = headlineLists
            .flat()
            .filter((h) => {
              if (seen.has(h.headline)) return false;
              seen.add(h.headline);
              return true;
            })
            .slice(0, 8); // keep the prompt focused rather than dumping every headline from three tickers

          if (!headlines.length) {
            return { pod: pod.slug, skipped: true, reason: 'no news available' };
          }

          const brief = await generateSectorBrief({ podName: pod.name, headlines });
          const sources = [...new Set(headlines.map((h) => h.source))].join(', ');

          const filePath = path.join(CONTENT_DIR, `${pod.slug}.md`);
          const raw = fs.readFileSync(filePath, 'utf8');
          const updated = prependEntry(raw, {
            date: isoDate,
            headline: brief.headline,
            body: brief.body,
            tickers: brief.tickers.length ? brief.tickers : pod.bellwethers,
            sources,
          });

          await commitFile(`content/pods/${pod.slug}.md`, updated, `AI-generated brief for ${pod.name} — ${isoDate}`);

          return { pod: pod.slug, skipped: false };
        } catch (err) {
          console.error(`Sector brief failed for ${pod.name}: ${err.message}`);
          return { pod: pod.slug, skipped: true, reason: err.message };
        }
      })
    );

    res.status(200).json({ skipped: false, date: isoDate, watchlistTickers: tickers, sectorBriefs: sectorBriefResults });
  } catch (err) {
    console.error('update-market-pulse failed:', err);
    res.status(500).json({ error: err.message });
  }
};
