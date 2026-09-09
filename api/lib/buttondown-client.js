// Buttondown client — this is the ONLY file that knows about Buttondown's
// specific API shape. Buttondown handles both storing subscriber emails and
// actually sending the emails; without a service like this, subscriber
// emails would have nowhere private to live (this repo's data/*.json files
// are public, committed via GitHub — see CLAUDE.md) and there'd be no
// mechanism to send mail at all.
//
// Tags are how per-pod (and per-brief) targeting works: subscribing to a pod
// adds a `pod:<slug>` tag to that subscriber, subscribing to Today's Brief
// adds a `today-brief` tag, and sending a brief means sending to subscribers
// with the matching tag. Which raw form value maps to which tag is decided
// by the caller (api/subscribe.js) — this file just takes tags as given.
// Tag-based sends require Buttondown's paid tags add-on — confirmed live
// before wiring this in, since the free plan doesn't include tags at all.
//
// Requires BUTTONDOWN_API_KEY as an environment variable.

const BUTTONDOWN_API = 'https://api.buttondown.com/v1';

function apiKey() {
  const key = process.env.BUTTONDOWN_API_KEY;
  if (!key) throw new Error('BUTTONDOWN_API_KEY is not set');
  return key;
}

function podTag(slug) {
  return `pod:${slug}`;
}

// Subscribes (or updates) an email address with the given Buttondown tags
// (already formatted by the caller — see tagForSlug() in api/subscribe.js).
// If the address already exists, Buttondown's API returns a 400 on POST —
// in that case we PATCH the existing subscriber's tags instead, adding to
// whatever tags they already have (X-Buttondown-Collision-Behavior: add)
// rather than overwriting their other pod/brief choices.
async function subscribeEmail(email, tags) {
  const createRes = await fetch(`${BUTTONDOWN_API}/subscribers`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email_address: email, tags }),
  });

  if (createRes.ok) return createRes.json();

  const body = await createRes.text();
  const alreadyExists = createRes.status === 400 && /already exists|duplicate/i.test(body);
  if (!alreadyExists) {
    throw new Error(`Buttondown subscribe failed: ${createRes.status} ${body}`);
  }

  const patchRes = await fetch(`${BUTTONDOWN_API}/subscribers/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Token ${apiKey()}`,
      'Content-Type': 'application/json',
      'X-Buttondown-Collision-Behavior': 'add',
    },
    body: JSON.stringify({ tags }),
  });

  if (!patchRes.ok) {
    throw new Error(`Buttondown subscriber update failed: ${patchRes.status} ${await patchRes.text()}`);
  }
  return patchRes.json();
}

// Sends one pod's daily brief to every subscriber tagged for that pod.
//
// NOT YET WIRED INTO api/update-market-pulse.js. The `included_tags` field
// below is Buttondown's documented tag-filter concept for restricting an
// email's audience, but the exact field name on POST /v1/emails wasn't
// confirmable from public docs alone — every other external API in this
// project (Finnhub, FRED, Anthropic, GitHub) was verified with a real key
// and a real request before being trusted, and this one needs the same
// treatment before it's called from the daily cron. Test with a real
// BUTTONDOWN_API_KEY first; if the field name is wrong Buttondown will
// either reject the request or (worse) silently send to everyone.
async function sendPodBriefEmail(podSlug, { subject, body }) {
  const res = await fetch(`${BUTTONDOWN_API}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject,
      body,
      included_tags: [podTag(podSlug)],
    }),
  });

  if (!res.ok) {
    throw new Error(`Buttondown send failed for ${podSlug}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Sends Today's Brief (the homepage's broad-market brief) to every
// subscriber tagged `today-brief` — see MARKET_BRIEF_SLUG in
// templates/partials.js. Same NOT-YET-VERIFIED caveat as sendPodBriefEmail
// above: don't call this from the cron until the `included_tags` field is
// confirmed against a real BUTTONDOWN_API_KEY.
async function sendMarketBriefEmail({ subject, body }) {
  const res = await fetch(`${BUTTONDOWN_API}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject,
      body,
      included_tags: ['today-brief'],
    }),
  });

  if (!res.ok) {
    throw new Error(`Buttondown send failed for Today's Brief: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

module.exports = { subscribeEmail, sendPodBriefEmail, sendMarketBriefEmail };
