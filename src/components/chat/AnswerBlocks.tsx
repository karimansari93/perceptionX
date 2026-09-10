import { useState } from 'react';
import { ExternalLink, TrendingDown, TrendingUp } from 'lucide-react';
import { Favicon } from '@/components/ui/favicon';
import { cn } from '@/lib/utils';
import type { SourceLink } from '@/services/chatService';

// ─── Visual blocks the analyst emits as fenced JSON ─────────────────────────
// ```px-context   {period, scope, brand, answers}```     → merged into the SCOPE row
// ```px-stats     [{label, value, delta}]```              → metric cards
// ```px-bars      {title, unit, rows:[{label, value}]}``` → contribution chart
// ```px-followups ["…", "…"]```                          → follow-up pills
// Anything unparseable (still streaming, malformed) renders as a skeleton.

export const PX_BLOCK = /language-px-(context|stats|bars|followups)/;
export const PX_CONTEXT_FENCE = /```px-context\s*\n([\s\S]*?)```/;

// The model occasionally drops the final "}" or "]" of a block; close any
// brackets still open (outside strings) before giving up.
function closeBrackets(s: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  return s + stack.reverse().join('');
}

export function parseBlock(_lang: string, raw: string): unknown | null {
  const s = raw.trim();
  try { return JSON.parse(s); } catch { /* try a repair */ }
  try { return JSON.parse(closeBrackets(s)); } catch { return null; }
}

export interface AnswerContext { period?: string | null; answers?: number | null; scope?: string | null; brand?: string | null }

// Pulls the px-context block out of the markdown (it renders as part of the
// SCOPE row, not inline) and returns what it said.
export function extractContext(markdown: string): { body: string; context: AnswerContext | null } {
  const m = markdown.match(PX_CONTEXT_FENCE);
  if (!m) return { body: markdown, context: null };
  const data = parseBlock('context', m[1]) as any;
  const context: AnswerContext | null = data && typeof data === 'object'
    ? {
        period: typeof data.period === 'string' ? data.period : null,
        answers: typeof data.answers === 'number' ? data.answers : null,
        scope: typeof data.scope === 'string' ? data.scope : null,
        brand: typeof data.brand === 'string' ? data.brand : null,
      }
    : null;
  return { body: markdown.replace(PX_CONTEXT_FENCE, '').replace(/^\s*\n/, ''), context };
}

const rise = 'animate-in fade-in slide-in-from-bottom-2 duration-300';

function Delta({ value, size = 'sm' }: { value: number | null | undefined; size?: 'sm' | 'xs' }) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value === 0) return <span className="text-[11.5px] font-semibold text-gray-400">–</span>;
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-semibold tabular-nums', size === 'sm' ? 'text-xs' : 'text-[11.5px]', value > 0 ? 'text-[#16a34a]' : 'text-[#dc2626]')}>
      <Icon className="h-3 w-3" />
      {Math.abs(value)}
    </span>
  );
}

export function BlockSkeleton() {
  return <div className="my-1 h-16 rounded-xl border border-gray-200 bg-gray-50 animate-pulse" />;
}

// c. Metric cards
export function StatTiles({ data }: { data: any }) {
  const tiles = Array.isArray(data) ? data.filter(t => t && t.label != null && t.value != null).slice(0, 4) : [];
  if (!tiles.length) return null;
  return (
    <div className={cn('grid gap-3', tiles.length === 1 ? 'grid-cols-1' : tiles.length === 2 ? 'grid-cols-2' : tiles.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3', rise)}>
      {tiles.map((t: any, i: number) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white p-[14px]">
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-400">{String(t.label)}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-headline text-[26px] font-bold leading-none tracking-[-0.02em] text-[#13274F] tabular-nums">{String(t.value)}</span>
            <Delta value={typeof t.delta === 'number' ? t.delta : null} />
          </div>
          {t.note && <div className="mt-1 truncate text-[11px] text-gray-400">{String(t.note)}</div>}
        </div>
      ))}
    </div>
  );
}

// d. Contribution chart — pink for what pulled down, teal for what lifted.
export function ContributionBars({ data }: { data: any }) {
  const rows = Array.isArray(data?.rows) ? data.rows.filter((r: any) => r && r.label != null && typeof r.value === 'number').slice(0, 12) : [];
  if (!rows.length) return null;
  const unit = data?.unit === 'pts' ? '' : typeof data?.unit === 'string' ? data.unit : '';
  // "+34" reads as a change; "86% positive" is a level, so no sign there.
  const signed = !unit || /\bpts?\b|point/i.test(unit);
  const max = Math.max(...rows.map((r: any) => Math.abs(r.value)), 1);
  return (
    <div className={cn('rounded-xl border border-gray-200 bg-white p-[18px]', rise)}>
      {data?.title && <div className="mb-[14px] text-xs font-semibold text-[#13274F]">{String(data.title)}</div>}
      <div className="space-y-2.5">
        {rows.map((r: any, i: number) => {
          const neg = r.value < 0;
          const width = Math.max(3, Math.round((Math.abs(r.value) / max) * 100));
          return (
            <div key={i} className="flex items-center gap-3 text-xs">
              <span className="w-[150px] flex-none truncate text-gray-600" title={String(r.label)}>{String(r.label)}</span>
              <div className={cn('h-[14px] flex-1 overflow-hidden rounded-[7px]', neg ? 'bg-[#DB5E89]/[0.12]' : 'bg-[#0DBCBA]/[0.12]')}>
                <div className={cn('h-full rounded-[7px]', neg ? 'bg-[#DB5E89]' : 'bg-[#0DBCBA]')} style={{ width: `${width}%` }} />
              </div>
              <span className={cn('min-w-[34px] flex-none whitespace-nowrap text-right font-semibold tabular-nums', neg ? 'text-[#13274F]' : 'text-[#0DBCBA]')}>
                {signed && r.value > 0 ? '+' : r.value < 0 ? '-' : ''}{Math.abs(r.value)}{unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// g. Follow-ups
export function FollowUps({ data, onAsk }: { data: any; onAsk?: (q: string) => void }) {
  const items = Array.isArray(data) ? data.filter(q => typeof q === 'string' && q.trim()).slice(0, 4) : [];
  if (!items.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-2 pt-1', rise)}>
      {items.map((q: string) => (
        <button
          key={q}
          type="button"
          onClick={() => onAsk?.(q)}
          className="h-8 rounded-full border border-gray-200 bg-white px-3 text-[12.5px] text-gray-600 transition-colors hover:border-[#DB5E89] hover:text-[#13274F]"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

// A delta cell in a comparison table: "+5", "−6", "-6 pts".
const DELTA_CELL = /^[+\-−–]?\d+(\.\d+)?\s*(pts?|points|%)?$/;
export function isDeltaText(text: string): boolean {
  const t = text.trim();
  return /^[+\-−–]/.test(t) && DELTA_CELL.test(t);
}
// Semantic colour: in a "vs <brand>" column a competitor ahead (+) is the
// bad news (red), behind (−) is good (teal); elsewhere + is green, − red.
export function deltaClass(text: string, versusBrand: boolean): string {
  const t = text.trim();
  const positive = t.startsWith('+');
  if (versusBrand) return positive ? 'text-[#dc2626] font-semibold' : 'text-[#0DBCBA] font-semibold';
  return positive ? 'text-[#16a34a] font-semibold' : 'text-[#dc2626] font-semibold';
}

// f. Sources — one quiet line under the answer. The answer links its sources
// inline, so this strip only lists the domains it actually cited (else the
// five biggest), as favicon chips; "+N more" expands to every domain the
// tools returned. A chip opens that domain's pages; its share of answers sits
// in the tooltip and the page list header rather than on every chip.
const PRIMARY_WHEN_NOTHING_LINKED = 5;

export function SourcePills({ sources, content }: { sources: SourceLink[]; content: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const byDomain = new Map<string, { answers: number | null; pct: number | null; pages: SourceLink[]; linked: boolean }>();
  for (const s of sources) {
    const e = byDomain.get(s.domain) || { answers: null, pct: null, pages: [], linked: false };
    e.pages.push(s);
    if (typeof s.answers === 'number' && s.answers > (e.answers ?? -1)) e.answers = s.answers;
    if (typeof s.pct === 'number' && s.pct > (e.pct ?? -1)) e.pct = s.pct;
    if (content.includes(s.url)) e.linked = true;
    byDomain.set(s.domain, e);
  }
  const domains = Array.from(byDomain.entries())
    .sort((a, b) => Number(b[1].linked) - Number(a[1].linked) || (b[1].pct ?? 0) - (a[1].pct ?? 0) || (b[1].answers ?? 0) - (a[1].answers ?? 0));
  if (!domains.length) return null;

  const linked = domains.filter(([, e]) => e.linked);
  const primary = linked.length ? linked : domains.slice(0, PRIMARY_WHEN_NOTHING_LINKED);
  const hidden = domains.length - primary.length;
  const shown = expanded ? domains : primary;
  const openEntry = open ? byDomain.get(open) : null;

  return (
    <div className={rise}>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <span className="mr-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">Sources</span>
        {shown.map(([domain, e]) => (
          <button
            key={domain}
            type="button"
            onClick={() => setOpen(open === domain ? null : domain)}
            title={e.pct !== null ? `${domain} · ${e.pct}% of answers` : domain}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] transition-colors',
              open === domain ? 'bg-[#DB5E89]/[0.08] text-[#13274F]' : 'text-gray-600 hover:bg-gray-100 hover:text-[#13274F]'
            )}
          >
            <Favicon domain={domain} size="sm" className="flex-shrink-0 rounded-sm" />
            <span>{domain}</span>
          </button>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => { setExpanded(x => !x); if (expanded) setOpen(null); }}
            className="inline-flex h-6 items-center rounded-md px-1.5 text-[11.5px] text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#13274F]"
          >
            {expanded ? 'Show fewer' : `+${hidden} more`}
          </button>
        )}
      </div>
      {open && openEntry && (
        <div className="mt-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-gray-400">
            <Favicon domain={open} size="sm" className="flex-shrink-0 rounded-sm" />
            <span className="font-medium text-gray-600">{open}</span>
            {openEntry.pct !== null && <span>· cited in {openEntry.pct}% of answers</span>}
          </div>
          <ul className="space-y-1">
            {openEntry.pages.map(p => (
              <li key={p.url} className="min-w-0">
                <a href={p.url} target="_blank" rel="noopener noreferrer" title={p.url}
                   className="group inline-flex min-w-0 items-center gap-1.5 text-xs text-gray-600 hover:text-[#13274F]">
                  <span className="truncate max-w-[28rem]">{p.title || p.url}</span>
                  <ExternalLink className="h-3 w-3 flex-shrink-0 text-gray-400 group-hover:text-[#13274F]" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
