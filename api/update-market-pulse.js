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
//   3. For each of the seven pods, fetches recent news for that pod's three
//      "bellwether" tickers (see PODS in templates/partials.js), pools and
//      dedupes the headlines, and asks Claude (api/lib/anthropic-client.js)
//      to write that pod's daily brief. The SAME market-wide macro figures
//      fetched in step 2 (indices, treasury10y) are passed into this call
//      too, and the prompt explicitly frames the macro backdrop — rates,
//      market tone, inflation — as the primary driver of the sector story,
//      with the pooled company headlines used only as supporting evidence of
//      how that backdrop is showing up in this sector. This is what keeps a
//      brief from reading like a recap of two or three companies' news
//      rather than genuine sector analysis. The same call also produces 2-3
//      "Securities to Note" (a ticker + short reason) grounded in the same
//      headlines, which REPLACES (not accumulates on top of) any
//      existing "## Watchlist" section in that pod's file — it reflects
//      what's worth watching right now, not a history. The dated entry is
//      then prepended after it. This is the whole reason a pod's content
//      file is no longer something a human needs to edit by hand day to day.
//   4. Scans every pod's content file for a "## Watchlist" section (see
//      lib/parse-pods.js) — merging in the ones just generated in step 3, so
//      a brand-new AI-suggested ticker gets a price the same day rather than
//      waiting for tomorrow's build to see today's commit — and fetches a
//      live quote for each ticker found. This powers the current-price shown
//      next to each ticker in a pod page's "Securities to Note" sidebar.
//   5. Writes everything (data/market-pulse.json, data/watchlist-quotes.json,
//      and each updated content/pods/<slug>.md) by committing directly to the
//      GitHub repo via the GitHub REST API (a real `git commit` isn't
//      possible from inside a serverless function). Each push triggers
//      Vercel's normal git-integration auto-deploy, which rebuilds the static
//      site — pages pick up the fresh JSON via plain client-side fetches
//      (src/js/market-pulse.js, src/js/watchlist-quotes.js), and the new pod
//      entries show up as regular static HTML from the next build onward.
//   6. Right after Today's Brief and each pod's brief commit, emails it to
//      whoever subscribed to that topic (see emailSubscribers() below,
//      api/lib/subscribers-store.js for who's subscribed — stored in a
//      separate PRIVATE repo, not this one — and api/lib/resend-client.js
//      for the actual send). A subscriber list load/send failure is logged
//      and swallowed, never thrown — email is additive on top of the site
//      publishing and should never block or fail the run that updates it.
//
// Requires FINNHUB_API_KEY, FRED_API_KEY, GITHUB_TOKEN, GITHUB_REPO,
// ANTHROPIC_API_KEY, RESEND_API_KEY, SUBSCRIBERS_GITHUB_TOKEN, and
// SUBSCRIBERS_GITHUB_REPO.
//
// content/pods/*.md is read directly off disk at runtime (see below), which
// needs the "includeFiles" entry for this function in vercel.json — Vercel's
// automatic file-tracing can miss files read via a dynamic path built from
// fs.readdirSync() rather than a static require()/readFileSync() call.
//
// Sector brief GENERATION (Finnhub news + Claude) for all seven pods runs in
// parallel to keep this function's total wall-clock time down. The actual
// GitHub COMMITS do not — confirmed live: seven concurrent PUTs to different
// files on the same `main` branch 409 against each other, because each
// commit needs to attach to the branch's current tip, which moves out from
// under slower requests when several land at once. So commits happen one at
// a time after generation finishes; vercel.json sets this function's
// `maxDuration` higher than the default to give the combined parallel
// generation + sequential commit phases enough headroom regardless.
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
const { collectAllWatchlistTickers, prependEntry, replaceWatchlist } = require('../lib/parse-pods');
const { PODS } = require('../templates/partials');
const { getSubscribersForTopic } = require('./lib/subscribers-store');
const { sendEmail } = require('./lib/resend-client');
const { podBriefEmail, marketBriefEmail } = require('./lib/email-templates');

const MARKET_PULSE_PATH = 'data/market-pulse.json';
const WATCHLIST_QUOTES_PATH = 'data/watchlist-quotes.json';
const CONTENT_DIR = path.join(__dirname, '..', 'content', 'pods');

// Emails every subscriber of `topic` (e.g. "today-brief" or "pod:technology")
// using buildEmailForSubscriber(subscriber) to get that recipient's
// personalized {subject, text, html} (personalized because each one needs
// its own unsubscribe link — see api/lib/email-templates.js). Deliberately
// swallows every failure (a missing RESEND_API_KEY/SUBSCRIBERS_GITHUB_TOKEN,
// one bad address, Resend being down) rather than throwing, the same way a
// single pod's brief-generation failure doesn't take down the other six —
// email delivery is additive on top of the site publishing, never a reason
// to fail the run that actually updates the site.
async function emailSubscribers(topic, buildEmailForSubscriber) {
  let subscribers;
  try {
    subscribers = await getSubscribersForTopic(topic);
  } catch (err) {
    console.error(`Could not load subscribers for ${topic}: ${err.message}`);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const subscriber of subscribers) {
    try {
      await sendEmail({ to: subscriber.email, ...buildEmailForSubscriber(subscriber) });
      sent++;
    } catch (err) {
      console.error(`Email send failed for ${subscriber.email} (${topic}): ${err.message}`);
      failed++;
    }
  }
  return { sent, failed };
}

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

    const marketEmailResult = await emailSubscribers('today-brief', (subscriber) =>
      marketBriefEmail({
        headline: brief.headline,
        deck: brief.deck,
        body: brief.body,
        sources,
        email: subscriber.email,
        token: subscriber.unsubscribeToken,
      })
    );

    // Phase 1: fetch news + generate each pod's brief IN PARALLEL — pure
    // Finnhub/Claude API calls, no git writes yet, so there's no race to
    // worry about here. One pod's news/model failure shouldn't take down the
    // other six, so failures are caught and carried through as a result
    // rather than thrown.
    const prepared = await Promise.all(
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
            return { pod, skipped: true, reason: 'no news available' };
          }

          const brief = await generateSectorBrief({ podName: pod.name, headlines, indices, treasury10y });
          const sources = [...new Set(headlines.map((h) => h.source))].join(', ');

          const filePath = path.join(CONTENT_DIR, `${pod.slug}.md`);
          const raw = fs.readFileSync(filePath, 'utf8');
          // Watchlist is fully replaced (not accumulated) each run — it's
          // "what's worth watching right now," not a history — then the new
          // entry is prepended after it.
          const withWatchlist = replaceWatchlist(raw, brief.watchlist);
          const updated = prependEntry(withWatchlist, {
            date: isoDate,
            headline: brief.headline,
            body: brief.body,
            tickers: brief.tickers.length ? brief.tickers : pod.bellwethers,
            sources,
          });

          return {
            pod,
            skipped: false,
            updated,
            watchlist: brief.watchlist,
            headline: brief.headline,
            body: brief.body,
            sources,
          };
        } catch (err) {
          console.error(`Sector brief generation failed for ${pod.name}: ${err.message}`);
          return { pod, skipped: true, reason: err.message };
        }
      })
    );

    // Phase 2: commit each generated brief ONE AT A TIME. All seven land on
    // the same `main` branch, and GitHub's contents API can only apply one
    // commit at a time per branch — running these in parallel causes a real
    // race (confirmed live: concurrent PUTs to different files on the same
    // branch 409 against each other).
    const sectorBriefResults = [];
    for (const result of prepared) {
      if (result.skipped) {
        sectorBriefResults.push({ pod: result.pod.slug, skipped: true, reason: result.reason });
        continue;
      }
      try {
        await commitFile(
          `content/pods/${result.pod.slug}.md`,
          result.updated,
          `AI-generated brief for ${result.pod.name} — ${isoDate}`
        );

        const podEmailResult = await emailSubscribers(`pod:${result.pod.slug}`, (subscriber) =>
          podBriefEmail({
            podName: result.pod.name,
            headline: result.headline,
            body: result.body,
            sources: result.sources,
            email: subscriber.email,
            token: subscriber.unsubscribeToken,
          })
        );

        sectorBriefResults.push({ pod: result.pod.slug, skipped: false, email: podEmailResult });
      } catch (err) {
        console.error(`Commit failed for ${result.pod.name}: ${err.message}`);
        sectorBriefResults.push({ pod: result.pod.slug, skipped: true, reason: err.message });
      }
    }

    // Watchlist quotes run AFTER sector briefs commit, not before — the
    // disk-based scan (collectAllWatchlistTickers) only sees whatever was
    // bundled at deploy time, i.e. yesterday's watchlists, so today's
    // freshly-generated tickers are merged in from memory (`prepared`) too.
    // Otherwise a brand-new AI-suggested ticker would show no price for a
    // full extra day until the next build picks up its own prior commit.
    const diskTickers = collectAllWatchlistTickers(CONTENT_DIR, PODS.map((pod) => pod.slug));
    const freshTickers = prepared.filter((r) => !r.skipped).flatMap((r) => r.watchlist.map((w) => w.ticker));
    const tickers = [...new Set([...diskTickers, ...freshTickers])];
    const quotes = await fetchWatchlistQuotes(tickers);

    const watchlistPayload = { asOf: new Date().toISOString(), quotes };

    await commitFile(
      WATCHLIST_QUOTES_PATH,
      JSON.stringify(watchlistPayload, null, 2) + '\n',
      `Update watchlist quotes for ${isoDate}`
    );

    res.status(200).json({
      skipped: false,
      date: isoDate,
      watchlistTickers: tickers,
      sectorBriefs: sectorBriefResults,
      marketBriefEmail: marketEmailResult,
    });
  } catch (err) {
    console.error('update-market-pulse failed:', err);
    res.status(500).json({ error: err.message });
  }
};
