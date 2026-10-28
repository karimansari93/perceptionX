// ─── Quarterly update email: prose ──────────────────────────────────────────
// The analyst model writes the four prose blocks (callouts, the note under
// each group table, the one "Where to focus" box, the preheader) against
// the payload's numbers and the theme evidence the analyst tools return for
// the weakest attributes. Strict JSON out, validated and length-capped here,
// so a bad reply degrades to an email without prose rather than a broken
// email. Copy rules travel in the prompt: no em dashes, no AI model names,
// percentages and points only, figures only from the payload.

import Anthropic from 'npm:@anthropic-ai/sdk';
import { withClaudeKey } from '../claude-keys.ts';
import { executeTool } from '../px-tools/mod.ts';
import type { ToolContext } from '../px-tools/mod.ts';
import type { DigestNarrative, DigestPayload } from './types.ts';

const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-opus-5';
const MAX_TOKENS = 4000;
const EVIDENCE_ATTRIBUTES = 2;

const LIMITS = { preheader: 140, title: 80, body: 560, note: 480, action: 680 };

const RULES = `You write the prose blocks of a quarterly update email that PerceptionX sends to one client user. The reader is an employer brand or talent lead. Write in British English, direct and specific, in short sentences.

Hard rules:
- Use only figures that appear in the payload. Never invent, estimate or round a figure differently. Quote percentages as "44%" and changes as "up 11 points" or "down 4 points".
- Lead with coverage percentages (share of answers), never relative lifts.
- The employers list is measured on the basis given in employersNote (usually the open "which employers" questions only). When you compare the client with those employers, say it is on those questions, and never compare the client's headline visibility with an employer's share.
- Two different measures must never sit in one sentence, one callout or one contrast: the headline visibility (metrics.visibility, named anywhere in any answer) and the client's share in the employers list (named as an employer to consider on the open employer questions). Never write "visible but not considered", "known but not shortlisted" or any framing that sets the two against each other. A callout about the employers list uses only that list's figures, opens by naming the basis ("On the open employer questions, where candidates ask which employers to consider, AI names the client in 9% of answers"), compares with the employers on that list, and says what would put the client on more of those answers. The headline visibility belongs in its own callout, or in none.
- Never name an AI assistant, model or vendor. Say "AI" or "AI assistants".
- Never use an em dash or en dash. Use commas, full stops or colons.
- Never mention raw counts of answers, responses, prompts or themes.
- Do not name any company other than the client, the employers in the payload's employers list, and the sources in the payload's sources list.
- Each callout is one finding a reader could disagree with (title), then the figure, a comparison, and why it matters (body).
- When payload.actions is not empty, those are the actions PerceptionX published in the client's report for this reader's markets. The action block then points at one of them: name it by title (and number when it has one), say what this quarter's figures say about it, and restate its what-to-do. Never propose a different action while the list is not empty, and the callouts may refer to a listed action by title when a figure bears on it.
- When payload.actions is empty, the action names the attribute, the page or source AI reads most for it (from the payload or evidence), what that page says or does not say (from the evidence), and one concrete thing to publish. One recommendation, not a list.
- Reply by calling the write_update tool once with these fields (no prose outside the tool call):
{"preheader": string, "callouts": [{"title": string, "body": string}], "functionsNote": string|null, "marketsNote": string|null, "action": string}
- 3 or 4 callouts. preheader under ${LIMITS.preheader} characters. title under ${LIMITS.title}. body under ${LIMITS.body}. notes under ${LIMITS.note}. action under ${LIMITS.action}.
- functionsNote is null when the payload has fewer than two job functions; marketsNote is null when it has fewer than two markets.`;

const stripDashes = (s: string) => s.replace(/\s*[—–]\s*/g, ', ').replace(/, ,/g, ',');
// Over-length text is cut at the end of a sentence, never mid-sentence; a
// single sentence that is still too long is cut at a word with a full stop.
export const cap = (s: unknown, max: number) => {
  const t = stripDashes(String(s ?? '').trim());
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'), head.endsWith('.') ? head.length - 1 : -1);
  if (lastStop > max * 0.4) return head.slice(0, lastStop + 1);
  return head.replace(/\s+\S*$/, '').replace(/[,:;]$/, '') + '.';
};

// The model answers through a forced tool call, so the reply is structured
// JSON from the API rather than text we have to parse. A text reply (older
// models, or a refusal to use the tool) still goes through the text parser.
const NARRATIVE_TOOL = {
  name: 'write_update',
  description: 'Write the prose blocks of the quarterly update email.',
  input_schema: {
    type: 'object',
    properties: {
      preheader: { type: 'string' },
      callouts: {
        type: 'array',
        items: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] },
      },
      functionsNote: { type: ['string', 'null'] },
      marketsNote: { type: ['string', 'null'] },
      action: { type: 'string' },
    },
    required: ['preheader', 'callouts', 'functionsNote', 'marketsNote', 'action'],
  },
};

/** The narrative object from a model reply: the tool call's input, else the first JSON object in its text. */
export function narrativeFromReply(content: Array<{ type: string; name?: string; input?: unknown; text?: string }>): any {
  const tool = content.find(b => b.type === 'tool_use' && b.name === NARRATIVE_TOOL.name);
  if (tool && tool.input && typeof tool.input === 'object') return tool.input;
  return parseJsonReply(content.filter(b => b.type === 'text').map(b => b.text || '').join(''));
}

function parseJsonReply(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Narrative reply was not JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function validateNarrative(raw: any, payload: DigestPayload): DigestNarrative {
  const callouts = Array.isArray(raw?.callouts) ? raw.callouts : [];
  const out: DigestNarrative = {
    preheader: cap(raw?.preheader, LIMITS.preheader),
    callouts: callouts.slice(0, 4).map((c: any) => ({ title: cap(c?.title, LIMITS.title), body: cap(c?.body, LIMITS.body) }))
      .filter((c: { title: string; body: string }) => c.title && c.body),
    functionsNote: payload.byFunction.length > 1 && raw?.functionsNote ? cap(raw.functionsNote, LIMITS.note) : null,
    marketsNote: payload.byMarket.length > 1 && raw?.marketsNote ? cap(raw.marketsNote, LIMITS.note) : null,
    action: cap(raw?.action, LIMITS.action),
  };
  if (!out.preheader || !out.action || out.callouts.length < 2) throw new Error('Narrative reply was incomplete.');
  return out;
}

// The weakest attributes' real themes and the sources behind them, from the
// analyst tools, so the action can name the page AI reads and what it says.
async function evidence(ctx: ToolContext, payload: DigestPayload, companyId: string, locationKey: string | null): Promise<string> {
  const weakest = payload.attributes
    .filter(a => a.positivePct !== null)
    .sort((a, b) => (a.positivePct ?? 0) - (b.positivePct ?? 0))
    .slice(0, EVIDENCE_ATTRIBUTES);
  const blocks = await Promise.all(weakest.map(async a => {
    const json = await executeTool(ctx, 'get_attribute_themes', {
      company_id: companyId, attribute_id: a.attributeId, quarters_back: 1,
      ...(locationKey ? { location: locationKey } : {}),
    });
    return `### ${a.name}\n${json.slice(0, 12000)}`;
  }));
  return blocks.join('\n\n');
}

function payloadForPrompt(payload: DigestPayload): string {
  const { recipient: _r, chatUrl: _u, chatNote: _n, narrative: _na, ...rest } = payload;
  return JSON.stringify(rest);
}

export async function writeNarrative(
  ctx: ToolContext,
  payload: DigestPayload,
  companyId: string,
  locationKey: string | null,
): Promise<DigestNarrative> {
  const ev = await evidence(ctx, payload, companyId, locationKey).catch(err => `Evidence unavailable: ${err?.message || err}`);
  const user = `PAYLOAD (all figures already verified):\n${payloadForPrompt(payload)}\n\nEVIDENCE (themes and sources for the weakest attributes, from the analyst tools):\n${ev}\n\nWrite the JSON now.`;
  const ask = (extra: string) => withClaudeKey(async (apiKey) => {
    const client = new Anthropic({ apiKey });
    const reply = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: RULES,
      tools: [NARRATIVE_TOOL as any],
      tool_choice: { type: 'tool', name: NARRATIVE_TOOL.name },
      messages: [{ role: 'user', content: user + extra }],
    });
    return reply.content as any[];
  });
  try {
    return validateNarrative(narrativeFromReply(await ask('')), payload);
  } catch (err) {
    // One retry: a malformed or incomplete reply is rare, and a second attempt
    // with the failure named almost always lands. A second failure surfaces.
    const why = err instanceof Error ? err.message : String(err);
    console.warn(`[digest] narrative retry: ${why}`);
    return validateNarrative(narrativeFromReply(await ask(`\n\nYour previous reply could not be used (${why}). Call write_update again with every field filled.`)), payload);
  }
}

// A Markdown copy of the update for the pre-created chat thread: the same
// figures and prose, so the reader can ask what sits behind any number.
export function digestMarkdown(payload: DigestPayload): string {
  const n = payload.narrative;
  const m = payload.metrics;
  const d = (v: number | null) => v === null ? '' : v > 0 ? ` (up ${v} points)` : v < 0 ? ` (down ${-v} points)` : ' (no change)';
  const prev = payload.period.previousLabel;
  const lines: string[] = [];
  lines.push(`## Your ${payload.period.short} Update: ${payload.brand.name}, ${payload.scope.locationLabel}`);
  lines.push('');
  lines.push(`Here is how AI assistants described ${payload.brand.name} to candidates ${payload.scope.preposition} ${payload.scope.locationLabel} this quarter${prev ? `, and what changed since ${prev}` : ''}.`);
  lines.push('');
  lines.push(`**Overall Score:** ${m.eps.value ?? 'n/a'} (${m.eps.grade})${payload.sentimentChangeHidden ? '' : d(m.eps.delta)}`);
  lines.push(`**Sentiment:** ${m.sentiment.value ?? 'n/a'}%${payload.sentimentChangeHidden ? ' (classifier updated, no change shown)' : d(m.sentiment.delta)}`);
  lines.push(`**Visibility:** ${m.visibility.value ?? 'n/a'}%${d(m.visibility.delta)}`);
  lines.push(`**Relevance:** ${m.relevance.value ?? 'n/a'}${d(m.relevance.delta)}`);
  if (n?.callouts.length) {
    lines.push('', '### What changed');
    for (const c of n.callouts) lines.push(`- **${c.title}** ${c.body}`);
  }
  if (payload.byMarket.length > 1) {
    lines.push('', '### By market');
    for (const r of payload.byMarket) lines.push(`- ${r.name}: ${r.positivePct ?? 'n/a'}% positive, named in ${r.namedPct ?? 'n/a'}% of answers${d(r.visibilityDelta)}`);
    if (n?.marketsNote) lines.push('', n.marketsNote);
  }
  if (payload.byFunction.length > 1) {
    lines.push('', '### By job function');
    for (const r of payload.byFunction) lines.push(`- ${r.name}: ${r.positivePct ?? 'n/a'}% positive${payload.sentimentChangeHidden ? '' : d(r.sentimentDelta)}, named in ${r.namedPct ?? 'n/a'}% of answers`);
    if (n?.functionsNote) lines.push('', n.functionsNote);
  }
  if (n?.action && !payload.actions.length) lines.push('', '### Where to focus', n.action);
  if (payload.actions.length) {
    lines.push('', '### Your actions this quarter');
    for (const a of payload.actions) lines.push(`- **${a.number ? `${a.number} ` : ''}${a.title}**${a.priority ? ` (${a.priority} priority)` : ''}${a.markets.length ? `, ${a.markets.join(', ')}` : ''}. ${a.whatToDo}`);
  }
  if (payload.employers.length) {
    lines.push('', '### Employers AI names alongside you');
    lines.push(`${payload.employersNote}.`);
    for (const e of payload.employers) lines.push(`- ${e.name}${e.you ? ' (you)' : ''}: ${e.pct}%${d(e.delta)}`);
  }
  if (payload.sources.length) {
    lines.push('', '### Sources AI reads');
    for (const s of payload.sources) lines.push(`- ${s.name}${s.owned ? ' (owned)' : ''}: ${s.pct}% of answers${d(s.delta)}`);
  }
  if (payload.attributes.length) {
    lines.push('', '### Themes');
    for (const a of payload.attributes) lines.push(`- ${a.name}: raised in ${a.raisedPct}% of answers, ${a.positivePct ?? 'n/a'}% positive${payload.sentimentChangeHidden ? '' : d(a.delta)}`);
  }
  lines.push('', 'Ask me what sits behind any of these numbers.');
  return lines.join('\n');
}
