// Builds the subject/text/html for every email this site sends: the welcome
// email on signup, and the single combined daily email each subscriber gets
// (one message covering every topic they picked — Today's Brief and/or
// specific pods — not a separate email per topic). Kept separate from
// api/lib/resend-client.js (which just knows how to send a message) and
// api/lib/subscribers-store.js (which just knows who to send it to) so each
// file has one job.
//
// HTML uses inline styles throughout rather than a <style> block — most
// email clients (Gmail included) strip or unreliably apply <head> styles,
// so inline is the only style that reliably survives. Fonts fall back to
// widely-available email-safe stacks (Georgia for headlines, Helvetica/Arial
// for body, Courier New for the mono kickers) approximating the site's own
// Playfair Display / IBM Plex pairing, since custom web fonts don't load in
// most mail clients either.

const { escapeHtml, PODS, MARKET_BRIEF_SLUG } = require('../../templates/partials');

const INK = '#1a1814';
const INK2 = '#3a3830';
const INK3 = '#7a7870';
const GOLD = '#9a7000';
const PAPER = '#fffef9';
const BG = '#f2efe6';
const RULE = '#ddd9cc';

function unsubscribeUrl(email, token) {
  const base = (process.env.SITE_URL || '').replace(/\/$/, '');
  return `${base}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
}

function formatDisplayDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// "pod:technology" -> "Technology", "today-brief" -> "Today's Brief (broad market)"
function topicLabel(topic) {
  if (topic === MARKET_BRIEF_SLUG) return "Today's Brief (broad market)";
  const slug = topic.replace(/^pod:/, '');
  const pod = PODS.find((p) => p.slug === slug);
  return pod ? pod.name : slug;
}

function htmlParagraphs(body) {
  return body
    .split('\n\n')
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${INK2};">${escapeHtml(p)}</p>`)
    .join('\n');
}

// Shared header/footer chrome around any email body — kicker is the small
// line under the wordmark (a date for briefs, nothing for the welcome
// email). bodyRowsHtml is one or more already-built <tr> rows.
function wrapHtml({ kicker, bodyRowsHtml, unsubLink }) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:${BG};font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${PAPER};border:1px solid ${RULE};">
          <tr>
            <td style="background:${INK};padding:24px 32px;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:20px;color:${PAPER};">
                The Daily <span style="color:${GOLD};">Tape</span>
              </div>
              ${
                kicker
                  ? `<div style="font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.55);margin-top:6px;">${escapeHtml(kicker)}</div>`
                  : ''
              }
            </td>
          </tr>
          ${bodyRowsHtml}
          <tr>
            <td style="background:${INK};padding:20px 32px;text-align:center;">
              <p style="font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:0.03em;color:rgba(255,255,255,0.55);margin:0 0 8px;">
                Neeley Equity Research Club &middot; Not investment advice
              </p>
              <a href="${unsubLink}" style="font-family:'Courier New',Courier,monospace;font-size:11px;color:rgba(255,255,255,0.75);text-decoration:underline;">Unsubscribe from all Daily Tape emails</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// One brief's plain-text block: { title, headline, deck?, body, sources? }
function sectionToText({ title, headline, deck, body, sources }) {
  return [`${title.toUpperCase()}`, headline, deck || '', '', body, sources ? `\nSources: ${sources}` : '']
    .filter((line) => line !== '')
    .join('\n');
}

// One brief's HTML block, same section shape as sectionToText().
function sectionToHtml({ title, headline, deck, body, sources }) {
  return `<tr><td style="padding:28px 32px 0;">
    <div style="font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${GOLD};margin-bottom:8px;">${escapeHtml(title)}</div>
    <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:21px;line-height:1.3;margin:0 0 10px;color:${INK};">${escapeHtml(headline)}</h2>
    ${deck ? `<p style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:15px;color:${INK2};margin:0 0 14px;">${escapeHtml(deck)}</p>` : ''}
    ${htmlParagraphs(body)}
    ${sources ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${INK3};margin:0 0 4px;">Sources: ${escapeHtml(sources)}</p>` : ''}
  </td></tr>
  <tr><td style="padding:24px 32px 0;"><div style="border-top:1px solid ${RULE};"></div></td></tr>`;
}

// sections: array of the same shape sectionToText/sectionToHtml expect, in
// the order they should appear (Today's Brief first, then pods). date:
// "YYYY-MM-DD" for the subject line and header.
function combinedBriefEmail({ sections, email, token, date }) {
  const unsubLink = unsubscribeUrl(email, token);
  const displayDate = formatDisplayDate(date);

  const subject =
    sections.length === 1
      ? `${sections[0].title}: ${sections[0].headline}`
      : `Your Daily Tape briefs — ${displayDate}`;

  const text = [
    `THE DAILY TAPE — ${displayDate}`,
    '',
    sections.map(sectionToText).join('\n\n----------------------------------------\n\n'),
    '',
    'This briefing is generated automatically from live market data and news headlines — not written or reviewed by a club member.',
    `\nUnsubscribe from all Daily Tape emails: ${unsubLink}`,
  ].join('\n');

  const bodyRowsHtml = `${sections.map(sectionToHtml).join('\n')}
    <tr>
      <td style="padding:20px 32px 28px;">
        <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${INK3};margin:0;">
          This briefing is generated automatically from live market data and news headlines — not written or reviewed by a club member.
        </p>
      </td>
    </tr>`;

  const html = wrapHtml({ kicker: displayDate, bodyRowsHtml, unsubLink });

  return { subject, text, html };
}

// Sent once, right when someone subscribes — confirms what they signed up
// for and sets expectations (when emails arrive, that it's automated, how
// to leave) rather than letting their first-ever email from this site just
// be an unexplained brief. topics: the subscriber's full current topic
// list (not just what was in this signup request — see addOrUpdateSubscriber()
// in api/lib/subscribers-store.js), so a repeat signup's welcome email
// reflects everything they're subscribed to, not only the newest addition.
function welcomeEmail({ topics, email, token }) {
  const unsubLink = unsubscribeUrl(email, token);
  const labels = topics.map(topicLabel);
  const subject = "You're subscribed to The Daily Tape";

  const text = [
    "Thanks for subscribing to The Daily Tape.",
    '',
    "Here's what you'll get, one email each trading morning before the market opens:",
    ...labels.map((label) => `  - ${label}`),
    '',
    "Each brief is generated automatically from live market data and news headlines — nobody at the club writes or reviews it before it goes out. Nothing arrives on weekends or market holidays, since there's nothing new to report.",
    '',
    `Change your mind any time: ${unsubLink}`,
  ].join('\n');

  const bodyRowsHtml = `<tr><td style="padding:28px 32px 0;">
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;margin:0 0 14px;color:${INK};">You're on the list</h1>
      <p style="font-size:15px;line-height:1.65;color:${INK2};margin:0 0 18px;">
        Thanks for subscribing to The Daily Tape. Here's what that means: one email each trading morning, before the market opens, covering:
      </p>
      <ul style="margin:0 0 20px;padding:0 0 0 20px;">
        ${labels
          .map(
            (label) =>
              `<li style="font-size:15px;line-height:1.8;color:${INK};font-family:Georgia,'Times New Roman',serif;">${escapeHtml(label)}</li>`
          )
          .join('\n        ')}
      </ul>
      <p style="font-size:14px;line-height:1.65;color:${INK3};margin:0 0 6px;">
        Every brief is generated automatically from live market data and news headlines &mdash; nobody at the club writes or reviews it before it's sent. Nothing arrives on weekends or market holidays, since there's nothing new to report those days.
      </p>
    </td></tr>
    <tr><td style="padding:20px 32px 28px;">
      <div style="border-top:1px solid ${RULE};padding-top:16px;">
        <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${INK3};margin:0;">
          Changed your mind, or picked the wrong pods? Use the unsubscribe link below any time.
        </p>
      </div>
    </td></tr>`;

  const html = wrapHtml({ kicker: '', bodyRowsHtml, unsubLink });

  return { subject, text, html };
}

module.exports = { combinedBriefEmail, welcomeEmail };
