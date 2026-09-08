// FRED (Federal Reserve Economic Data) client — used for exactly one thing:
// the real 10-year Treasury yield. This is a separate module from
// market-data-finnhub.js because it's a genuinely different provider, not a
// stylistic choice — Finnhub's free tier doesn't expose real yield data at
// all (see the comment at the top of market-data-finnhub.js for what was
// actually tried), while FRED is the Federal Reserve's own free, permanent,
// no-paid-tier data API and publishes this series directly.
//
// Requires FRED_API_KEY as an environment variable. Get one (instant,
// self-service, free forever) at https://fred.stlouisfed.org/docs/api/api_key.html
//
// Series used: DGS10 ("10-Year Treasury Constant Maturity Rate"), published
// once per business day. Note this means the freshest value available when
// the daily cron runs (~1 hour before market open) may still be the prior
// business day's close — FRED doesn't publish same-day intraday yields on
// any plan, paid or free. That's expected, not a bug.

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const SERIES_ID = 'DGS10';

function apiKey() {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error('FRED_API_KEY is not set');
  return key;
}

async function fetchTreasury10y() {
  const url = `${FRED_BASE}?series_id=${SERIES_ID}&api_key=${apiKey()}&file_type=json&sort_order=desc&limit=6`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED request failed: ${res.status}`);
  const data = await res.json();

  // FRED marks non-trading days (weekends/holidays) with a "." value instead
  // of omitting the row, so filter those out before taking the two most
  // recent real observations.
  const observations = (data.observations || []).filter((o) => o.value !== '.');
  if (observations.length < 2) {
    throw new Error('Not enough FRED observations to compute a 10-year Treasury change');
  }

  const latest = parseFloat(observations[0].value);
  const previous = parseFloat(observations[1].value);

  return {
    label: '10-Year Treasury',
    value: latest,
    unit: '%',
    // A percentage-point change (e.g. yield moved from 4.04% to 4.09% ->
    // +0.05), not a relative percent change of the yield value itself —
    // that's the standard way treasury yield moves are quoted.
    changePercent: Math.round((latest - previous) * 100) / 100,
  };
}

module.exports = { fetchTreasury10y };
