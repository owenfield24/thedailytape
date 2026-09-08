// Fills in a live-ish current price next to each ticker in a pod page's
// "Securities to Note" sidebar, from data/watchlist-quotes.json — written by
// the same daily cron function that refreshes the homepage's Today's Brief
// (see api/update-market-pulse.js). No-op on any page without a watchlist
// (i.e., every page except a pod page with a "## Watchlist" section).
//
// Uses a site-root-absolute path ('/data/...') rather than a relative one
// since this script runs on pages at different depths (site root vs.
// /pods/*.html).

(function () {
  var items = document.querySelectorAll('.watchlist li[data-ticker]');
  if (!items.length) return;

  function formatQuote(quote) {
    if (!quote || typeof quote.price !== 'number') return '';
    var html = '$' + quote.price.toFixed(2);
    if (typeof quote.changePercent === 'number') {
      var sign = quote.changePercent > 0 ? '+' : '';
      var arrow = quote.changePercent > 0 ? '&#9650;' : quote.changePercent < 0 ? '&#9660;' : '';
      var cls = quote.changePercent > 0 ? 'positive' : quote.changePercent < 0 ? 'negative' : '';
      html += ' <span class="' + cls + '">' + arrow + ' ' + sign + quote.changePercent.toFixed(2) + '%</span>';
    }
    return html;
  }

  fetch('/data/watchlist-quotes.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('Failed to load watchlist quotes');
      return res.json();
    })
    .then(function (data) {
      var quotes = data.quotes || {};
      items.forEach(function (li) {
        var quoteEl = li.querySelector('.watchlist-quote');
        var html = quoteEl ? formatQuote(quotes[li.getAttribute('data-ticker')]) : '';
        if (quoteEl && html) quoteEl.innerHTML = html;
      });
    })
    .catch(function () {
      // Quietly leave prices blank if the file is missing or unreachable —
      // this is a nice-to-have enhancement, not required for the page to work.
    });
})();
