// Anthropic client — generates Today's Brief and each pod's daily sector
// brief from real, dated news headlines (see fetchGeneralNews() and
// fetchCompanyNews() in market-data-finnhub.js). This is the ONLY file that
// knows about Claude's specific API shape; if the model or provider ever
// changes, this is the only place that needs to.
//
// Requires ANTHROPIC_API_KEY as an environment variable.

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// Haiku is fast and cheap, which fits short daily writing tasks running
// across the homepage plus seven pods in one cron invocation. Swap to
// 'claude-sonnet-5' here for higher-quality writing if Haiku's output isn't
// sharp enough.
const MODEL = 'claude-haiku-4-5-20251001';

function apiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  return key;
}

// Belt-and-suspenders against the model slipping in markdown syntax despite
// being told not to (caught live: Claude wrapped a "deck" field in
// *asterisks* meaning italic, even though the page already applies italics
// via CSS and renders this as plain text — the literal "*" characters would
// otherwise show up on the page). Blunt but appropriate for these short
// single-purpose fields, where a stray asterisk/underscore/backtick is never
// something we'd want to preserve.
function stripMarkdown(text) {
  return text.replace(/[*_`]/g, '').trim();
}

// Sends one prompt, expects a single JSON object back, and returns it
// parsed. Shared by generateMarketBrief() and generateSectorBrief() so the
// request/response plumbing (and error messages) stay consistent between them.
async function askClaudeForJson(prompt, label) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API request failed for ${label}: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const text = (data.content || []).map((block) => block.text || '').join('').trim();

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Anthropic response for ${label} did not contain JSON: ${text}`);

  return JSON.parse(jsonMatch[0]);
}

// indices/treasury10y/vix: the same shapes fetchMarketData() in
// market-data-finnhub.js and market-data-fred.js return. headlines:
// [{ headline, source }] from Finnhub's general news feed. Grounding the
// brief in the day's actual index moves (not just headlines) is what keeps
// it from reading like generic news commentary disconnected from what the
// numbers show. Note "indices" here are ETF proxies (SPY/DIA/QQQ), not the
// literal index levels — see the comment at the top of
// market-data-finnhub.js for why — so the model sees the same honestly
// labeled names ("S&P 500 (SPY)") that end up on the page.
async function generateMarketBrief({ indices, treasury10y, headlines }) {
  const fmtChange = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
  const indexLines = Object.values(indices)
    .map((i) => `${i.label}: ${i.value.toLocaleString('en-US')} (${fmtChange(i.changePercent)})`)
    .join('\n');
  const dataLines = [
    indexLines,
    `${treasury10y.label}: ${treasury10y.value}${treasury10y.unit} (${fmtChange(treasury10y.changePercent)} pts)`,
  ].join('\n');

  const headlineList = headlines.length
    ? headlines.map((h, i) => `${i + 1}. ${h.headline} (${h.source})`).join('\n')
    : '(no headlines available today)';

  const prompt = `You are writing "Today's Brief," the daily market summary at the top of a student equity research club's automated newsletter, styled like a concise morning market note.

Today's index levels and changes:
${dataLines}

Recent market-moving headlines:
${headlineList}

Write:
- A headline under 12 words describing the market's overall tone today, no trailing period
- A one-sentence "deck" teaser summarizing the day in a single line — the page already renders this in italics via CSS, so write it as plain text
- A 2-3 paragraph analysis (separate paragraphs with a blank line) of what's driving markets today, connecting the index moves above to the headlines. Keep each paragraph to 2-4 sentences — informative, not padded.

None of the three fields should contain markdown formatting (no asterisks, underscores, backticks, or headers) — this is plain text rendered directly, not markdown.

Do not invent specific facts, figures, or data beyond what's given above. Respond with ONLY a JSON object and nothing else, no markdown code fences: {"headline": "...", "deck": "...", "body": "..."} — in "body", separate paragraphs with a literal "\\n\\n" (a valid JSON-escaped blank line), not an actual line break.`;

  const parsed = await askClaudeForJson(prompt, "Today's Brief");
  if (!parsed.headline || !parsed.body) {
    throw new Error("Anthropic response for Today's Brief missing headline/body");
  }

  return {
    headline: stripMarkdown(String(parsed.headline)),
    deck: stripMarkdown(String(parsed.deck || '')),
    body: stripMarkdown(String(parsed.body)),
  };
}

// headlines: [{ headline, source }] — real, dated news pooled across several
// representative tickers for the pod's sector (see PODS.bellwethers in
// templates/partials.js), not just one company. The model is instructed to
// write about the sector broadly and not to invent facts beyond what's in
// these headlines, precisely so a hallucinated figure or filing doesn't end
// up presented as real analysis.
async function generateSectorBrief({ podName, headlines }) {
  if (!headlines.length) {
    throw new Error(`No headlines available to generate a brief for ${podName}`);
  }

  const headlineList = headlines.map((h, i) => `${i + 1}. ${h.headline} (${h.source})`).join('\n');

  const prompt = `You are writing a short daily sector brief for the "${podName}" pod in a student equity research club's automated newsletter, styled like a concise sell-side morning note.

Recent headlines from several companies across this sector:
${headlineList}

Write about the SECTOR broadly — what's happening across it and why, not a recap of one company's news. Mention specific companies only as supporting examples of a broader trend (e.g. "banks broadly benefited from..." rather than opening on a single name).

Write:
- A headline under 12 words describing a sector-wide theme, no markdown formatting, no trailing period, and not centered on a single company
- A two-paragraph analysis (separate the paragraphs with a blank line): the first covering what happened across the sector and why, the second covering what investors in this sector should watch next. Keep each paragraph to 2-3 sentences — informative, not padded.
- 1-3 stock tickers (just the symbols) from the headlines above that best represent the sector-wide themes discussed

None of the fields should contain markdown formatting (no asterisks, underscores, backticks, or headers) — this is plain text rendered directly, not markdown.

Do not invent specific facts, figures, or filings that aren't present in the headlines above. Respond with ONLY a JSON object and nothing else, no markdown code fences: {"headline": "...", "body": "...", "tickers": ["TICK"]} — in "body", separate the two paragraphs with a literal "\\n\\n" (a valid JSON-escaped blank line), not an actual line break.`;

  const parsed = await askClaudeForJson(prompt, podName);
  if (!parsed.headline || !parsed.body) {
    throw new Error(`Anthropic response for ${podName} missing headline/body`);
  }

  return {
    headline: stripMarkdown(String(parsed.headline)),
    body: stripMarkdown(String(parsed.body)),
    tickers: Array.isArray(parsed.tickers) ? parsed.tickers.map((t) => String(t).toUpperCase()) : [],
  };
}

module.exports = { generateMarketBrief, generateSectorBrief };
