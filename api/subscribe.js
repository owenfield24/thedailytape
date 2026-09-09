// Vercel Serverless Function backing the "Get sector briefs in your inbox"
// form (renderSubscribeForm() in templates/partials.js, wired up client-side
// by src/js/subscribe-form.js). Validates the submission, then hands off to
// api/lib/subscribers-store.js to store the subscriber (in a separate
// PRIVATE GitHub repo, not this site's public one) with whichever
// pods/Today's Brief they picked.
//
// Requires SUBSCRIBERS_GITHUB_TOKEN and SUBSCRIBERS_GITHUB_REPO as
// environment variables (see api/lib/subscribers-store.js).

const { addOrUpdateSubscriber } = require('./lib/subscribers-store');
const { PODS, MARKET_BRIEF_SLUG } = require('../templates/partials');

const VALID_SLUGS = new Set([...PODS.map((pod) => pod.slug), MARKET_BRIEF_SLUG]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Stored topic values, not the raw form values — Today's Brief gets its own
// distinct topic rather than being lumped in with `pod:<slug>` topics,
// since it isn't a pod (see MARKET_BRIEF_SLUG in templates/partials.js).
// These are also what api/update-market-pulse.js looks up subscribers by.
function topicForSlug(slug) {
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

    // Only accept known pod slugs (plus Today's Brief) — an arbitrary
    // client-supplied string shouldn't end up stored as a topic.
    const slugs = Array.isArray(pods) ? pods.filter((slug) => VALID_SLUGS.has(slug)) : [];
    if (!slugs.length) {
      res.status(400).json({ ok: false, error: 'Pick at least one option.' });
      return;
    }

    await addOrUpdateSubscriber(email, slugs.map(topicForSlug));
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('subscribe failed:', err);
    res.status(500).json({ ok: false, error: 'Something went wrong. Try again later.' });
  }
};
