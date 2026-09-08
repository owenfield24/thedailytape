// Finnhub market data client.
//
// This is the ONLY file that knows about Finnhub's specific endpoints/response
// shapes. If Finnhub's free tier ever stops covering what we need, write a
// sibling module (e.g. market-data-alphavantage.js or market-data-fmp.js) that
// exports the same `fetchMarketData()` shape below, and swap the `require(...)`
// in api/update-market-pulse.js — nothing else in the codebase needs to change.
//
// Requires FINNHUB_API_KEY as an environment variable.
//
// Notes on index coverage (free tier):
// - Finnhub's /quote endpoint works for the caret-prefixed index symbols below
//   on most plans, but exact free-tier coverage can change. Verify against a
//   real API call after signing up; swap providers if a symbol stops resolving.
// - There's no dedicated free "10-year treasury yield" quote endpoint on
//   Finnhub. We use the CBOE 10-Year Treasury Yield Index (^TNX), whose quoted
//   price is the yield * 10 (e.g. a price of 41.2 means a 4.12% yield), which
//   is the standard convention brokers use for that symbol.

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

const INDEX_SYMBOLS = {
  sp500: { symbol: '^GSPC', label: 'S&P 500' },
  dow: { symbol: '^DJI', label: 'Dow Jones' },
  nasdaq: { symbol: '^IXIC', label: 'Nasdaq' },
};

const VIX_SYMBOL = { symbol: '^VIX', label: 'VIX' };
const TREASURY_10Y_SYMBOL = { symbol: '^TNX', label: '10-Year Treasury' };

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
  for (const [key, meta] of Object.entries(INDEX_SYMBOLS)) {
    const quote = await fetchQuote(meta.symbol);
    results[key] = { label: meta.label, value: quote.c, changePercent: quote.dp };
  }
  return results;
}

async function fetchVix() {
  const quote = await fetchQuote(VIX_SYMBOL.symbol);
  return { label: VIX_SYMBOL.label, value: quote.c, changePercent: quote.dp };
}

async function fetchTreasury10y() {
  const quote = await fetchQuote(TREASURY_10Y_SYMBOL.symbol);
  return {
    label: TREASURY_10Y_SYMBOL.label,
    value: Math.round((quote.c / 10) * 100) / 100,
    unit: '%',
    changePercent: quote.dp,
  };
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
  const [indices, treasury10y, vix, headlines] = await Promise.all([
    fetchIndices(),
    fetchTreasury10y(),
    fetchVix(),
    fetchGeneralNews(),
  ]);
  return { indices, treasury10y, vix, headlines };
}

// For the "Securities to Note" live prices: fetches a plain equity quote for
// each ticker pod leads have flagged in a Watchlist section. Tickers here are
// arbitrary and pod-lead-entered (occasional typos expected), so a bad symbol
// is skipped with a warning rather than failing the whole cron run.
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
