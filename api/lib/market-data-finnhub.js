// Finnhub market data client — equities, ETFs, and news only.
//
// This is the ONLY file that knows about Finnhub's specific endpoints/response
// shapes. If Finnhub's free tier ever stops covering what we need, write a
// sibling module (e.g. market-data-alphavantage.js) that exports the same
// shape below, and swap the `require(...)` in api/update-market-pulse.js —
// nothing else in the codebase needs to change.
//
// Requires FINNHUB_API_KEY as an environment variable.
//
// IMPORTANT — index coverage on the free tier (verified against a real key):
// Finnhub's /quote endpoint rejects every caret-prefixed index symbol
// (^GSPC, ^DJI, ^IXIC, ^VIX, ^TNX) on the free tier with "Market data
// subscription required for CFD indices" — this isn't a fluke, it's because
// real index levels are licensed data (S&P Dow Jones Indices, Cboe) that
// providers charge for. Plain equity/ETF tickers work fine on free tier
// (confirmed: AAPL, SPY, DIA, QQQ, VIXY, TLT all return real quotes).
//
// So instead of the raw indices, we use the ETF that tracks each one:
//   S&P 500 -> SPY, Dow Jones -> DIA, Nasdaq -> QQQ
// These are real, free, reliable quotes — but they're ETF share prices, NOT
// the literal index level (SPY trades at roughly a tenth of the S&P 500
// figure you'd see quoted elsewhere). The UI labels them accordingly (e.g.
// "S&P 500 (SPY)") rather than presenting them as the real index number.
// The 10-year Treasury yield comes from a different free source entirely
// (FRED, the Federal Reserve's own data API) — see market-data-fred.js.
// There is no free equity-quotable proxy for the actual VIX print (VIXY
// tracks VIX *futures*, which decay differently from the index itself), so
// VIX is intentionally not part of this site's data at all.

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

const INDEX_PROXIES = {
  sp500: { symbol: 'SPY', label: 'S&P 500 (SPY)' },
  dow: { symbol: 'DIA', label: 'Dow Jones (DIA)' },
  nasdaq: { symbol: 'QQQ', label: 'Nasdaq (QQQ)' },
};

function apiKey() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error('FINNHUB_API_KEY is not set');
  return key;
}

async function fetchQuote(symbol) {
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub quote request failed for ${symbol}: ${res.status}`);
  const data = await res.json();
  if (typeof data.c !== 'number' || data.c === 0) {
    throw new Error(`Finnhub returned no usable quote for ${symbol}`);
  }
  return data; // { c: current, d: change, dp: percentChange, h, l, o, pc }
}

async function fetchIndices() {
  const results = {};
  for (const [key, meta] of Object.entries(INDEX_PROXIES)) {
    const quote = await fetchQuote(meta.symbol);
    results[key] = { label: meta.label, value: quote.c, changePercent: quote.dp };
  }
  return results;
}

// Raw general market news — this grounds Today's Brief (written by
// generateMarketBrief() in api/lib/anthropic-client.js) in real headlines
// instead of the model inventing what happened today. Returns [] on failure
// rather than throwing; generateMarketBrief() handles an empty list itself.
async function fetchGeneralNews() {
  try {
    const url = `${FINNHUB_BASE}/news?category=general&token=${apiKey()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub news request failed: ${res.status}`);
    const articles = await res.json();
    return (Array.isArray(articles) ? articles : [])
      .slice(0, 8)
      .map((a) => ({ headline: (a.headline || '').trim(), source: (a.source || '').trim() || 'Finnhub' }))
      .filter((a) => a.headline);
  } catch (err) {
    console.warn(`Skipping general news: ${err.message}`);
    return [];
  }
}

async function fetchMarketData() {
  const [indices, headlines] = await Promise.all([fetchIndices(), fetchGeneralNews()]);
  return { indices, headlines };
}

// For the "Securities to Note" live prices: fetches a plain equity quote for
// each ticker flagged in a Watchlist section. Tickers here are arbitrary and
// hand-entered (occasional typos expected), so a bad symbol is skipped with
// a warning rather than failing the whole cron run.
async function fetchWatchlistQuotes(tickers) {
  const quotes = {};
  for (const ticker of tickers) {
    try {
      const quote = await fetchQuote(ticker);
      quotes[ticker] = { price: quote.c, changePercent: quote.dp };
    } catch (err) {
      console.warn(`Skipping watchlist quote for ${ticker}: ${err.message}`);
    }
  }
  return quotes;
}

// Recent news for a single "bellwether" ticker — this is what grounds each
// pod's AI-generated sector brief (see generateSectorBrief() in
// api/lib/anthropic-client.js) in real, dated headlines instead of letting
// the model invent facts. Returns [] on any failure rather than throwing,
// since a missing news feed for one pod shouldn't block the other six.
async function fetchCompanyNews(symbol, daysBack = 4) {
  const to = new Date();
  const from = new Date(to.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  try {
    const url = `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${apiKey()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub company-news request failed for ${symbol}: ${res.status}`);
    const articles = await res.json();
    return (Array.isArray(articles) ? articles : [])
      .slice(0, 5)
      .map((a) => ({ headline: (a.headline || '').trim(), source: (a.source || '').trim() || 'Finnhub' }))
      .filter((a) => a.headline);
  } catch (err) {
    console.warn(`Skipping company news for ${symbol}: ${err.message}`);
    return [];
  }
}

module.exports = { fetchMarketData, fetchWatchlistQuotes, fetchCompanyNews };
