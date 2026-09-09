// Builds the subject/text/html for the two kinds of emails this site sends:
// a pod's daily sector brief, and Today's Brief (the homepage's broad-market
// summary). Kept separate from api/lib/resend-client.js (which just knows
// how to send a message) and api/lib/subscribers-store.js (which just knows
// who to send it to) so each file has one job.

const { escapeHtml } = require('../../templates/partials');

function unsubscribeUrl(email, token) {
  const base = (process.env.SITE_URL || '').replace(/\/$/, '');
  return `${base}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
}

function paragraphsToHtml(body) {
  return body
    .split('\n\n')
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('\n');
}

function podBriefEmail({ podName, headline, body, sources, email, token }) {
  const unsubLink = unsubscribeUrl(email, token);
  const subject = `${podName}: ${headline}`;

  const text = [
    headline,
    '',
    body,
    sources ? `\nSources: ${sources}` : '',
    `\nUnsubscribe: ${unsubLink}`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = [
    `<h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(headline)}</h1>`,
    paragraphsToHtml(body),
    sources ? `<p style="color:#7a7870;font-size:13px;"><em>Sources: ${escapeHtml(sources)}</em></p>` : '',
    `<p style="font-size:12px;color:#7a7870;"><a href="${unsubLink}">Unsubscribe</a></p>`,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, text, html };
}

function marketBriefEmail({ headline, deck, body, sources, email, token }) {
  const unsubLink = unsubscribeUrl(email, token);
  const subject = `Today's Brief: ${headline}`;

  const text = [
    headline,
    deck,
    '',
    body,
    sources ? `\nSources: ${sources}` : '',
    `\nUnsubscribe: ${unsubLink}`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = [
    `<h1 style="font-size:20px;margin:0 0 4px;">${escapeHtml(headline)}</h1>`,
    deck ? `<p style="font-style:italic;color:#3a3830;">${escapeHtml(deck)}</p>` : '',
    paragraphsToHtml(body),
    sources ? `<p style="color:#7a7870;font-size:13px;"><em>Sources: ${escapeHtml(sources)}</em></p>` : '',
    `<p style="font-size:12px;color:#7a7870;"><a href="${unsubLink}">Unsubscribe</a></p>`,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, text, html };
}

module.exports = { podBriefEmail, marketBriefEmail };
