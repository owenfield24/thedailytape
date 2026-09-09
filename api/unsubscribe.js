// Vercel Serverless Function backing the unsubscribe link included in every
// email (see api/lib/email-templates.js). Must be a GET endpoint since email
// clients only ever follow plain links, never issue a POST. The token (a
// random per-subscriber secret from api/lib/subscribers-store.js) is what
// authorizes the removal without requiring a login — anyone with the exact
// link in their own email can unsubscribe that address, nobody else can.
//
// Always shows the same generic confirmation regardless of whether the
// email/token pair actually matched anything, so this page can't be used to
// probe whether a given address is subscribed.

const { removeSubscriber } = require('./lib/subscribers-store');

function page(message) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Unsubscribed — The Daily Tape</title>
<style>body{font-family:Georgia,serif;background:#f7f5f0;color:#1a1814;max-width:480px;margin:15vh auto;padding:0 1.5rem;text-align:center;}</style>
</head>
<body><p>${message}</p></body>
</html>`;
}

module.exports = async function handler(req, res) {
  const { email, token } = req.query || {};

  if (typeof email !== 'string' || typeof token !== 'string') {
    res.status(400).send(page("That unsubscribe link doesn't look right."));
    return;
  }

  try {
    await removeSubscriber(email, token);
  } catch (err) {
    console.error('unsubscribe failed:', err);
  }

  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(page("You've been unsubscribed from The Daily Tape."));
};
