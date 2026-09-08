// Fetches data/market-pulse.json (written by /api/update-market-pulse) and
// drives the dynamic pieces of the homepage:
//   1. The scrolling ticker tape at the very top of the page.
//   2. The Today's Brief article (headline, deck, body, byline).
//   3. The Notable Movers grid.
//   4. A "markets are closed today" banner, shown when today itself isn't a
//      trading day — computed fresh on every page load against
//      data/nyse-holidays.json, independent of whether the cron happened to
//      run (Hobby-plan cron timing drifts, and the cron doesn't write
//      anything on non-trading days, so the stored data can be a day or more
//      stale on a weekend/holiday).
// This is the only dynamic part of the site — everything else is static HTML
// generated at build time.

(function () {
  // Short mono symbols for the movers grid — fixed metadata, not runtime data.
  var SHORT_SYMBOLS = {
    sp500: 'SPX',
    dow: 'DJI',
    nasdaq: 'IXIC',
    treasury10y: '10Y',
    vix: 'VIX',
  };

  var STATS_ORDER = [
    { key: 'sp500', group: 'indices' },
    { key: 'dow', group: 'indices' },
    { key: 'nasdaq', group: 'indices' },
    { key: 'treasury10y', group: 'root' },
    { key: 'vix', group: 'root' },
  ];

  function formatValue(stat) {
    var value = stat.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return stat.unit ? value + stat.unit : value;
  }

  function formatChange(changePercent) {
    if (typeof changePercent !== 'number') return '';
    var sign = changePercent > 0 ? '+' : '';
    var arrow = changePercent > 0 ? '▲' : changePercent < 0 ? '▼' : '';
    return arrow + ' ' + sign + changePercent.toFixed(2) + '%';
  }

  function changeClass(changePercent) {
    if (typeof changePercent !== 'number' || changePercent === 0) return '';
    return changePercent > 0 ? 'positive' : 'negative';
  }

  function collectStats(data) {
    return STATS_ORDER.map(function (entry) {
      var stat = entry.group === 'root' ? data[entry.key] : (data.indices || {})[entry.key];
      return stat ? Object.assign({ key: entry.key }, stat) : null;
    }).filter(Boolean);
  }

  // Eastern-time calendar date as YYYY-MM-DD, plus the day-of-week — mirrors
  // easternDateParts() in api/lib/nyse-calendar.js so client and server agree
  // on what "today" means regardless of the visitor's own timezone.
  function easternDateParts(date) {
    var formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    });
    var lookup = {};
    formatter.formatToParts(date).forEach(function (part) {
      lookup[part.type] = part.value;
    });
    return { isoDate: lookup.year + '-' + lookup.month + '-' + lookup.day, weekday: lookup.weekday };
  }

  function isTradingDay(date, holidaysData) {
    var parts = easternDateParts(date);
    if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
    if (!holidaysData) return true; // holiday list failed to load — don't block on it
    var allHolidays = [];
    Object.keys(holidaysData).forEach(function (key) {
      if (key.indexOf('_') === 0) return;
      if (Array.isArray(holidaysData[key])) allHolidays = allHolidays.concat(holidaysData[key]);
    });
    return allHolidays.indexOf(parts.isoDate) === -1;
  }

  // Renders the ticker track with the stat list duplicated once, so a CSS
  // animation can translateX(-50%) forever with no visible seam.
  function renderTicker(stats) {
    var track = document.getElementById('ticker-track');
    if (!track) return;

    if (!stats.length) {
      track.innerHTML = '<span class="ticker-item">Market data unavailable</span>';
      return;
    }

    var itemsHtml = stats.map(function (stat) {
      return (
        '<span class="ticker-item">' +
          '<span class="ticker-item-label">' + stat.label + '</span>' +
          '<span class="ticker-item-value">' + formatValue(stat) + '</span>' +
          '<span class="ticker-item-change ' + changeClass(stat.changePercent) + '">' + formatChange(stat.changePercent) + '</span>' +
        '</span>'
      );
    }).join('');

    track.innerHTML = itemsHtml + itemsHtml;
  }

  function renderMovers(stats) {
    var grid = document.getElementById('movers-grid');
    if (!grid) return;

    if (!stats.length) {
      grid.innerHTML = '<p class="movers-loading">Market data unavailable right now.</p>';
      return;
    }

    grid.innerHTML = stats.map(function (stat) {
      var cls = changeClass(stat.changePercent) === 'positive' ? 'up' : changeClass(stat.changePercent) === 'negative' ? 'down' : '';
      return (
        '<div class="mover-card ' + cls + '">' +
          '<div>' +
            '<div class="mc-sym">' + (SHORT_SYMBOLS[stat.key] || stat.key) + '</div>' +
            '<div class="mc-name">' + stat.label + '</div>' +
          '</div>' +
          '<div>' +
            '<div class="mc-value">' + formatValue(stat) + '</div>' +
            '<div class="mc-chg ' + cls + '">' + formatChange(stat.changePercent) + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderArticle(data) {
    var hed = document.getElementById('article-hed');
    if (hed) hed.textContent = data.headline || "Today's Brief";

    var deck = document.getElementById('article-deck');
    if (deck) deck.textContent = data.deck || '';

    var body = document.getElementById('article-body');
    if (body) body.textContent = data.body || '';
  }

  // isStale: the stored brief's Eastern calendar date doesn't match today's —
  // i.e. this is leftover content from the last trading day, not today's.
  function renderByline(data, isStale) {
    var dateEl = document.getElementById('byline-date');
    if (dateEl && data.asOf) {
      var date = new Date(data.asOf);
      var label = isStale ? 'Most recent brief: ' : 'Updated: ';
      dateEl.textContent = label + date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    }

    var sourcesEl = document.getElementById('byline-sources');
    if (sourcesEl && data.sources) sourcesEl.textContent = 'Sources: ' + data.sources;
  }

  function renderMarketStatus(marketOpenToday) {
    var el = document.getElementById('market-status');
    if (!el) return;
    if (marketOpenToday) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = "Markets are closed today (weekend or holiday) — no new brief publishes until the next trading day. The brief below is from the most recent trading day.";
  }

  function showError() {
    renderTicker([]);
    renderMovers([]);
    var hed = document.getElementById('article-hed');
    if (hed) hed.textContent = 'Market Data Unavailable';
    var deck = document.getElementById('article-deck');
    if (deck) deck.textContent = "Today's brief couldn't be loaded right now.";
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Failed to load ' + url);
      return res.json();
    });
  }

  Promise.all([
    fetchJson('data/market-pulse.json'),
    fetchJson('data/nyse-holidays.json').catch(function () {
      return null; // non-critical — the closed-market banner just won't show
    }),
  ])
    .then(function (results) {
      var data = results[0];
      var holidays = results[1];
      var now = new Date();

      var stats = collectStats(data);
      renderTicker(stats);
      renderMovers(stats);
      renderArticle(data);

      var todayIso = easternDateParts(now).isoDate;
      var asOfIso = data.asOf ? easternDateParts(new Date(data.asOf)).isoDate : null;
      renderByline(data, Boolean(asOfIso && asOfIso !== todayIso));

      renderMarketStatus(isTradingDay(now, holidays));
    })
    .catch(showError);
})();
