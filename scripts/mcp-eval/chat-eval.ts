// In-app chat eval — runs the golden questions through the deployed
// chat-with-data function as a real user and lints the answers.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=eyJ... \
//   CHAT_EVAL_EMAIL=someone@customer.com CHAT_EVAL_PASSWORD=... \
//   CHAT_EVAL_ORG=<organization uuid> \
//   deno run --allow-net --allow-env --allow-read scripts/mcp-eval/chat-eval.ts [--only "substring"] [--extra "question"]
//
// Signs in with email + password through Supabase auth, posts every question
// in questions.json (plus the manual QA script from docs/ask-ai-build-brief.md
// section 5) to chat-with-data, collects the SSE stream, and lints the final
// text against the rulebook the chat shares with the MCP server:
//   * no calendar-gap language ("missing", "gap", "no data for May", "still
//     filling in") — an unlisted month was never a measurement period;
//   * no decimal sentiment or visibility ("0.81");
//   * no "other customers" / cross-tenant talk;
//   * every markdown link's host appears in that turn's {sources} event, and
//     every link's exact URL is one the tools returned;
//   * every answer that names a source domain carries at least one link.
// Exit code 1 when any lint fails. Answers are printed so a reviewer can read
// them alongside the verdicts.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('VITE_SUPABASE_URL') || '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('VITE_SUPABASE_ANON_KEY') || '';
const EMAIL = Deno.env.get('CHAT_EVAL_EMAIL') || '';
const PASSWORD = Deno.env.get('CHAT_EVAL_PASSWORD') || '';
const ORG = Deno.env.get('CHAT_EVAL_ORG') || '';

if (!SUPABASE_URL || !ANON_KEY || !EMAIL || !PASSWORD || !ORG) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, CHAT_EVAL_EMAIL, CHAT_EVAL_PASSWORD and CHAT_EVAL_ORG.');
  Deno.exit(1);
}

const args = Deno.args;
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? (args[onlyIdx + 1] || '').toLowerCase() : '';
const extras = args.flatMap((a, i) => (a === '--extra' && args[i + 1] ? [args[i + 1]] : []));

// ─── Sign in ────────────────────────────────────────────────────────────────

const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!signIn.ok) {
  console.error(`Sign-in failed: HTTP ${signIn.status} ${await signIn.text()}`);
  Deno.exit(1);
}
const { access_token: TOKEN } = await signIn.json();

// ─── Questions ──────────────────────────────────────────────────────────────

const questionsPath = new URL('./questions.json', import.meta.url);
const { questions: golden } = JSON.parse(await Deno.readTextFile(questionsPath));

// The manual QA script (docs/ask-ai-build-brief.md §5) — the same questions a
// reviewer asks in the browser, so a run doubles as that transcript.
const QA_SCRIPT: string[] = [
  'How are we doing?',
  'What changed on wellbeing since last quarter and which sources are behind it?',
  'Which Glassdoor pages come up most, with links?',
  'Show visibility by job function.',
  'How do we compare to other PerceptionX customers?',
  'Why is May missing?',
  'Write a job description for engineers that leans into what AI says about us.',
];

const questions: string[] = Array.from(new Set([
  ...QA_SCRIPT,
  ...golden.map((g: { q: string }) => g.q),
  ...extras,
])).filter(q => !ONLY || q.toLowerCase().includes(ONLY));

// ─── Chat client ────────────────────────────────────────────────────────────

interface Turn { text: string; sources: { title: string; url: string; domain: string }[]; statuses: string[]; error: string | null; ms: number; ttft: number | null }

async function ask(message: string): Promise<Turn> {
  const t0 = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chat-with-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, apikey: ANON_KEY },
    body: JSON.stringify({ message, organizationId: ORG, conversationHistory: [] }),
  });
  if (!res.ok || !res.body) {
    return { text: '', sources: [], statuses: [], error: `HTTP ${res.status}: ${await res.text()}`, ms: Date.now() - t0, ttft: null };
  }
  const turn: Turn = { text: '', sources: [], statuses: [], error: null, ms: 0, ttft: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break outer;
      let ev: any;
      try { ev = JSON.parse(data); } catch { continue; }
      if (typeof ev.text === 'string') { if (turn.ttft === null) turn.ttft = Date.now() - t0; turn.text += ev.text; }
      if (typeof ev.status === 'string') turn.statuses.push(ev.status);
      if (Array.isArray(ev.sources)) turn.sources = ev.sources;
      if (ev.error) turn.error = String(ev.error);
    }
  }
  turn.ms = Date.now() - t0;
  return turn;
}

// ─── Lint ───────────────────────────────────────────────────────────────────

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
const GAP_PATTERNS: Array<[string, RegExp]> = [
  ['calendar-gap language: "missing"', /\bmissing\b/i],
  ['calendar-gap language: "gap"', /\bgaps?\b(?! analysis)(?!.*answer gap)/i],
  ['calendar-gap language: "no data for <month>"', new RegExp(`no data (for|in) (${MONTHS})\\b`, 'i')],
  ['calendar-gap language: "still filling in"', /still (filling|being collected|in progress|coming in)/i],
  ['calendar-gap language: "pause"', /\bpaused?\b|\bpause in\b/i],
  ['calendar-gap language: "skipped a month/quarter"', /\bskipped\b/i],
];
// "answer gap" is a real metric name (share of answers citing a source while
// the company is absent) — allowed. Everything else on "gap" is not.
const ANSWER_GAP = /answer[- ]gap/i;
const DECIMAL_SHARE = /\b(sentiment|visibility|positive|share|cited|mentioned)\b[^.\n]{0,40}\b0\.\d{1,3}\b/i;
const CROSS_TENANT = /\b(other|another) (perceptionx )?(customers?|clients?|organi[sz]ations?|tenants?)\b/i;
const CROSS_TENANT_ALLOWED = /(can only see|only (have|see)|scoped to|no cross[- ]customer|don'?t have (access|visibility)|isn'?t (something|data) I)/i;
const LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_DOMAIN = /\b(glassdoor|indeed|linkedin|reddit|comparably|ambitionbox|kununu|levels\.fyi|teamblind|quora)(\.[a-z.]+)?\b/i;

function host(url: string): string { try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; } }

function lint(q: string, turn: Turn): string[] {
  const problems: string[] = [];
  const text = turn.text;
  if (turn.error) problems.push(`stream error: ${turn.error}`);
  if (!text.trim()) problems.push('empty answer');

  for (const [label, re] of GAP_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    // "answer gap" (the metric) is fine; "gap" as calendar talk is not.
    if (label.includes('"gap"')) {
      const idx = text.search(re);
      const around = text.slice(Math.max(0, idx - 20), idx + 20);
      if (ANSWER_GAP.test(around)) continue;
    }
    // The QA question literally says "missing"; the answer may quote it once
    // while correcting it. Flag only when the answer asserts a gap itself.
    if (label.includes('"missing"') && /not (missing|a gap)|wasn'?t (missing|a gap)|isn'?t missing|nothing is missing/i.test(text)) continue;
    problems.push(`${label} — "…${m[0]}…"`);
  }

  const dec = text.match(DECIMAL_SHARE);
  if (dec) problems.push(`decimal share — "${dec[0]}"`);

  const ct = text.match(CROSS_TENANT);
  if (ct && !CROSS_TENANT_ALLOWED.test(text)) problems.push(`cross-tenant talk — "${ct[0]}"`);

  const sourceUrls = new Set(turn.sources.map(s => s.url));
  const sourceHosts = new Set(turn.sources.map(s => host(s.url)));
  const links = Array.from(text.matchAll(LINK));
  for (const [, , url] of links) {
    if (!sourceHosts.has(host(url))) problems.push(`link host not in sources event — ${url}`);
    else if (!sourceUrls.has(url)) problems.push(`link url not returned by a tool — ${url}`);
  }
  // A bare link to a domain root is never a returned top page.
  for (const [, , url] of links) {
    try { const u = new URL(url); if (u.pathname === '/' && !u.search) problems.push(`bare domain link — ${url}`); } catch { /* covered above */ }
  }

  const namesSource = BARE_DOMAIN.test(text.replace(LINK, ''));
  if (namesSource && links.length === 0 && !/no (pages|links|urls?)|not tracked|no data|haven'?t (collected|got)/i.test(text)) {
    problems.push('names a source but carries no link');
  }
  return problems;
}

// ─── Run ────────────────────────────────────────────────────────────────────

console.log(`\n━━ Chat eval: ${questions.length} questions as ${EMAIL} on org ${ORG} ━━`);
let failed = 0;
const ttfts: number[] = [];
for (const q of questions) {
  const turn = await ask(q);
  if (turn.ttft !== null) ttfts.push(turn.ttft);
  const problems = lint(q, turn);
  if (problems.length) failed++;
  console.log(`\n${problems.length ? '✗' : '✓'} "${q}"  (${(turn.ms / 1000).toFixed(1)}s, first token ${turn.ttft === null ? '—' : (turn.ttft / 1000).toFixed(1) + 's'}, tools: ${turn.statuses.join(' | ') || 'none'}, sources: ${turn.sources.length})`);
  console.log(turn.text.split('\n').map(l => '    ' + l).join('\n'));
  for (const p of problems) console.log(`    ✗ ${p}`);
}
ttfts.sort((a, b) => a - b);
const p50 = ttfts.length ? ttfts[Math.floor(ttfts.length / 2)] : null;
console.log(`\n━━ Result: ${questions.length - failed} passed, ${failed} failed; time-to-first-token p50 ${p50 === null ? '—' : (p50 / 1000).toFixed(1) + 's'} ━━`);
Deno.exit(failed > 0 ? 1 : 0);
