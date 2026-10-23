// ─── chat-with-data: the streaming status line ──────────────────────────────
// One line per tool round, built from each tool's progressLabel. When the
// analyst calls the same tool several times in parallel (two markets, two
// attributes), the label appears once with what differed in brackets —
// "Analyzing themes by market (Germany, United Kingdom)" — instead of the
// same words repeated.

export interface ToolCall { name: string; input: unknown }

// The inputs worth naming, in the order they read best.
const DISTINGUISHING = ['market', 'location', 'job_function', 'attribute', 'query', 'period', 'competitor', 'company_name'];

function detail(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  for (const key of DISTINGUISHING) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length && v.every(x => typeof x === 'string')) return (v as string[]).join('/');
  }
  return null;
}

// How many distinguishing names to spell out before "+ N more": a question
// like "which markets drove the drop?" fans out to one call per market.
const MAX_NAMED = 3;

export function statusLine(calls: ToolCall[], labels: Record<string, string>): string {
  const groups = new Map<string, string[]>();
  for (const c of calls) {
    const label = labels[c.name] || c.name;
    const list = groups.get(label) ?? [];
    list.push(detail(c.input) ?? '');
    groups.set(label, list);
  }
  return Array.from(groups.entries())
    .map(([label, details]) => {
      const named = Array.from(new Set(details.filter(Boolean)));
      // A single call keeps the plain label; repeats say what differed.
      if (details.length <= 1 || !named.length) return label;
      const shown = named.slice(0, MAX_NAMED).join(', ');
      const more = named.length - MAX_NAMED;
      return `${label} (${shown}${more > 0 ? ` + ${more} more` : ''})`;
    })
    .join(' + ') + '...';
}
