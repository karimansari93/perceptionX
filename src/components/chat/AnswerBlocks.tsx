import { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { Favicon } from '@/components/ui/favicon';
import { cn } from '@/lib/utils';
import type { SourceLink } from '@/services/chatService';

// ─── Visual blocks the analyst emits as fenced JSON ─────────────────────────
// ```px-context {period, scope, brand, answers}```   → pills
// ```px-stats  [{label, value, delta}]```             → tiles
// ```px-bars   {title, unit, rows:[{label, value}]}``` → horizontal bars
// Anything unparseable (still streaming, malformed) renders as a skeleton.

export const PX_BLOCK = /language-px-(context|stats|bars)/;

export function parseBlock(lang: string, raw: string): unknown | null {
  try { return JSON.parse(raw.trim()); } catch { return null; }
}

function Delta({ value, unit = '' }: { value: number | null | undefined; unit?: string }) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  const color = value > 0 ? 'text-emerald-600' : value < 0 ? 'text-rose-600' : 'text-gray-400';
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-sm font-semibold', color)}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(value)}{unit}
    </span>
  );
}

export function BlockSkeleton() {
  return (
    <div className="my-2 h-16 rounded-xl border border-gray-200 bg-white/60 animate-pulse" />
  );
}

export function ContextPills({ data }: { data: any }) {
  const pills: string[] = [];
  if (data?.period) pills.push(String(data.period));
  if (data?.scope) pills.push(String(data.scope));
  const brand = data?.brand ? String(data.brand) : null;
  const answers = typeof data?.answers === 'number' ? data.answers : null;
  if (brand || answers !== null) pills.push([brand, answers !== null ? `${answers.toLocaleString()} answers` : null].filter(Boolean).join(' · '));
  if (!pills.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {pills.map(p => (
        <span key={p} className="inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600">{p}</span>
      ))}
    </div>
  );
}

export function StatTiles({ data }: { data: any }) {
  const tiles = Array.isArray(data) ? data.filter(t => t && t.label != null && t.value != null).slice(0, 4) : [];
  if (!tiles.length) return null;
  return (
    <div className={cn('grid gap-3 my-3', tiles.length === 1 ? 'grid-cols-1' : tiles.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3', tiles.length === 4 && 'sm:grid-cols-4')}>
      {tiles.map((t: any, i: number) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 truncate">{String(t.label)}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900 leading-none">{String(t.value)}</span>
            <Delta value={typeof t.delta === 'number' ? t.delta : null} />
          </div>
          {t.note && <div className="mt-1 text-[11px] text-gray-500 truncate">{String(t.note)}</div>}
        </div>
      ))}
    </div>
  );
}

export function ContributionBars({ data }: { data: any }) {
  const rows = Array.isArray(data?.rows) ? data.rows.filter((r: any) => r && r.label != null && typeof r.value === 'number').slice(0, 12) : [];
  if (!rows.length) return null;
  const unit = data?.unit === 'pts' ? '' : typeof data?.unit === 'string' ? data.unit : '';
  const max = Math.max(...rows.map((r: any) => Math.abs(r.value)), 1);
  return (
    <div className="my-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      {data?.title && <div className="text-sm font-semibold text-gray-900 mb-2">{String(data.title)}</div>}
      <div className="space-y-1.5">
        {rows.map((r: any, i: number) => {
          const neg = r.value < 0;
          const width = Math.max(4, Math.round((Math.abs(r.value) / max) * 100));
          return (
            <div key={i} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-xs">
              <span className="truncate text-gray-600" title={String(r.label)}>{String(r.label)}</span>
              <div className={cn('h-2.5 rounded-full overflow-hidden', neg ? 'bg-rose-100' : 'bg-teal-100')}>
                <div className={cn('h-full rounded-full', neg ? 'bg-rose-500' : 'bg-teal-500')} style={{ width: `${width}%` }} />
              </div>
              <span className={cn('text-right font-semibold tabular-nums', neg ? 'text-rose-600' : r.value > 0 ? 'text-teal-600' : 'text-gray-500')}>
                {r.value > 0 ? '+' : r.value < 0 ? '−' : ''}{Math.abs(r.value)}{unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A delta cell in a comparison table: "+5", "−6", "-6 pts", "0".
const DELTA_CELL = /^[+\-−–]?\d+(\.\d+)?\s*(pts?|points|%)?$/;
export function isDeltaText(text: string): boolean {
  const t = text.trim();
  return /^[+\-−–]/.test(t) && DELTA_CELL.test(t);
}
export function deltaClass(text: string): string {
  const t = text.trim();
  if (t.startsWith('+')) return 'text-emerald-600 font-semibold';
  if (/^[\-−–]/.test(t)) return 'text-rose-600 font-semibold';
  return '';
}

// ─── Sources chips (from the {sources} event) ───────────────────────────────
// One chip per domain (favicon, domain, answers citing it); expanding a chip
// lists that domain's pages, each linked to the exact returned URL.
export function SourceChips({ sources, content }: { sources: SourceLink[]; content: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const byDomain = new Map<string, { answers: number | null; pages: SourceLink[]; linked: boolean }>();
  for (const s of sources) {
    const e = byDomain.get(s.domain) || { answers: null, pages: [], linked: false };
    e.pages.push(s);
    if (typeof s.answers === 'number' && s.answers > (e.answers ?? -1)) e.answers = s.answers;
    if (content.includes(s.url)) e.linked = true;
    byDomain.set(s.domain, e);
  }
  const domains = Array.from(byDomain.entries())
    .sort((a, b) => Number(b[1].linked) - Number(a[1].linked) || (b[1].answers ?? 0) - (a[1].answers ?? 0));
  if (!domains.length) return null;
  const openEntry = open ? byDomain.get(open) : null;
  return (
    <div className="mt-3 pt-3 border-t border-gray-200/80">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Sources</div>
      <div className="flex flex-wrap gap-1.5">
        {domains.map(([domain, e]) => (
          <button
            key={domain}
            type="button"
            onClick={() => setOpen(open === domain ? null : domain)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors',
              open === domain ? 'border-[#13274F]/40 bg-[#13274F]/5 text-[#13274F]' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
            )}
          >
            <Favicon domain={domain} size="sm" className="rounded-sm flex-shrink-0" />
            <span>{domain}</span>
            {e.answers !== null && <span className="text-gray-400">· {e.answers.toLocaleString()} answers</span>}
            {open === domain ? <ChevronUp className="h-3 w-3 text-gray-400" /> : <ChevronDown className="h-3 w-3 text-gray-400" />}
          </button>
        ))}
      </div>
      {open && openEntry && (
        <ul className="mt-2 space-y-1 rounded-lg border border-gray-200 bg-white px-3 py-2">
          {openEntry.pages.map(p => (
            <li key={p.url} className="min-w-0">
              <a href={p.url} target="_blank" rel="noopener noreferrer" title={p.url}
                 className="group inline-flex items-center gap-1.5 min-w-0 text-xs text-gray-700 hover:text-[#13274F]">
                <span className="truncate max-w-[28rem]">{p.title || p.url}</span>
                <ExternalLink className="h-3 w-3 text-gray-400 group-hover:text-[#13274F] flex-shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
