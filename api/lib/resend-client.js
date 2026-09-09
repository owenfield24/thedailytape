// Resend client — this is the ONLY file that knows about Resend's specific
// API shape. Used purely as a plain send-one-email API: unlike Buttondown,
// Resend does no subscriber storage or tag-based audience filtering on our
// behalf — "who gets this email" is entirely decided by this codebase (see
// api/lib/subscribers-store.js), which is what keeps this free (Resend's
// paid "Audiences" product, which this project deliberately avoids using,
// is what costs money; plain transactional sending has a generous free
// tier — see README.md).
//
// Requires RESEND_API_KEY as an environment variable. RESEND_FROM_ADDRESS
// is optional and defaults to Resend's shared onboarding@resend.dev sender,
// which works immediately but can only deliver to the account's own
// verified address until a real sending domain is verified in the Resend
// dashboard — see README.md's "Getting a Resend API key" section.

const RESEND_API = 'https://api.resend.com';

function apiKey() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  return key;
}

function fromAddress() {
  return process.env.RESEND_FROM_ADDRESS || 'The Daily Tape <onboarding@resend.dev>';
}

// Sends to exactly one recipient. Called in a loop (not batched) from
// api/update-market-pulse.js — each subscriber's email needs its own
// unsubscribe link anyway, so there's no shared payload to batch, and a
// simple loop means one subscriber's bad address can't fail anyone else's
// send (same reasoning as the per-ticker try/catch in
// api/lib/market-data-finnhub.js's fetchWatchlistQuotes()).
async function sendEmail({ to, subject, html, text }) {
  const res = await fetch(`${RESEND_API}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: fromAddress(), to, subject, html, text }),
  });

  if (!res.ok) {
    throw new Error(`Resend send failed for ${to}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

module.exports = { sendEmail };
