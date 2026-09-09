// Vercel Serverless Function backing the "Get sector briefs in your inbox"
// form (renderSubscribeForm() in templates/partials.js, wired up client-side
// by src/js/subscribe-form.js). Validates the submission, then hands off to
// Buttondown (api/lib/buttondown-client.js) to store the subscriber and tag
// them with whichever pods they picked.
//
// Requires BUTTONDOWN_API_KEY as an environment variable.

const { subscribeEmail } = require('./lib/buttondown-client');
const { PODS } = require('../templates/partials');

const VALID_SLUGS = new Set(PODS.map((pod) => pod.slug));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const { email, pods } = req.body || {};

    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      res.status(400).json({ ok: false, error: 'Enter a valid email address.' });
      return;
    }

    // Only accept known pod slugs — this is what ends up as a Buttondown
    // tag, so an arbitrary client-supplied string shouldn't pass through.
    const podSlugs = Array.isArray(pods) ? pods.filter((slug) => VALID_SLUGS.has(slug)) : [];
    if (!podSlugs.length) {
      res.status(400).json({ ok: false, error: 'Pick at least one pod.' });
      return;
    }

    await subscribeEmail(email, podSlugs);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('subscribe failed:', err);
    res.status(500).json({ ok: false, error: 'Something went wrong. Try again later.' });
  }
};
