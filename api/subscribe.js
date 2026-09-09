// Vercel Serverless Function backing the "Get sector briefs in your inbox"
// form (renderSubscribeForm() in templates/partials.js, wired up client-side
// by src/js/subscribe-form.js). Validates the submission, then hands off to
// Buttondown (api/lib/buttondown-client.js) to store the subscriber and tag
// them with whichever pods they picked.
//
// Requires BUTTONDOWN_API_KEY as an environment variable.

const { subscribeEmail } = require('./lib/buttondown-client');
const { PODS, MARKET_BRIEF_SLUG } = require('../templates/partials');

const VALID_SLUGS = new Set([...PODS.map((pod) => pod.slug), MARKET_BRIEF_SLUG]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Buttondown tags, not the raw form values — Today's Brief gets its own
// distinct tag rather than being lumped in with `pod:<slug>` tags, since
// it isn't a pod (see MARKET_BRIEF_SLUG in templates/partials.js).
function tagForSlug(slug) {
  return slug === MARKET_BRIEF_SLUG ? MARKET_BRIEF_SLUG : `pod:${slug}`;
}

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

    // Only accept known pod slugs (plus Today's Brief) — this is what ends
    // up as a Buttondown tag, so an arbitrary client-supplied string
    // shouldn't pass through.
    const slugs = Array.isArray(pods) ? pods.filter((slug) => VALID_SLUGS.has(slug)) : [];
    if (!slugs.length) {
      res.status(400).json({ ok: false, error: 'Pick at least one option.' });
      return;
    }

    await subscribeEmail(email, slugs.map(tagForSlug));
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('subscribe failed:', err);
    res.status(500).json({ ok: false, error: 'Something went wrong. Try again later.' });
  }
};
