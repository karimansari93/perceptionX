// §3.4 demo moment: an example data card built from the client's own functions
// and markets. It leads with the market × function matrix — the way the report
// is actually sliced — with the three pillars (Visibility, Sentiment,
// Relevance) as the columns. Numbers are illustrative and deterministic
// (seeded from the function/market strings) so the card is stable across
// re-renders and resumes, but clearly labelled as sample data.

const PILLARS = [
  { key: 'visibility', label: 'Visibility', color: '#13274F', blurb: 'How often you appear' },
  { key: 'sentiment', label: 'Sentiment', color: '#DB5E89', blurb: 'How positively you read' },
  { key: 'relevance', label: 'Relevance', color: '#0CBCB9', blurb: 'How on-target it is' },
] as const;

const MAX_ROWS = 6;

function seeded(str: string, min: number, max: number): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return min + (h % (max - min + 1));
}

interface DemoDataCardProps {
  /** The client's own market × function combinations. */
  pairs: { market: string; fn: string }[];
}

export function DemoDataCard({ pairs }: DemoDataCardProps) {
  const rows = (pairs.length ? pairs : [{ fn: 'Product', market: 'United States' }]).slice(
    0,
    MAX_ROWS,
  );
  const extra = pairs.length - rows.length;
  const gridCols = 'grid-cols-[minmax(112px,1.5fr)_repeat(3,minmax(56px,1fr))]';

  return (
    <div className="rounded-2xl border border-silver bg-white p-4 sm:p-5 shadow-sm max-w-full overflow-x-auto">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="font-headline font-semibold text-nightsky text-sm sm:text-base">
          How you show up, market by market
        </p>
        <span className="text-[11px] uppercase tracking-wide text-slate-400 border border-slate-200 rounded-full px-2 py-0.5 whitespace-nowrap">
          Illustrative sample data
        </span>
      </div>

      <div className="mt-4 min-w-[420px]">
        {/* Column headers: the three pillars */}
        <div className={`grid ${gridCols} gap-x-3 items-end pb-2`}>
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Function · market
          </span>
          {PILLARS.map((p) => (
            <div key={p.key} className="text-right">
              <div className="flex items-center justify-end gap-1">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: p.color }}
                  aria-hidden
                />
                <span className="text-xs font-semibold text-nightsky">{p.label}</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{p.blurb}</p>
            </div>
          ))}
        </div>

        {/* One row per market × function combination */}
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {rows.map(({ fn, market }) => (
            <div key={`${fn}|${market}`} className={`grid ${gridCols} gap-x-3 items-center py-2.5`}>
              <div className="min-w-0">
                <p className="text-xs font-medium text-nightsky truncate">{fn}</p>
                <p className="text-[11px] text-slate-500 truncate">{market}</p>
              </div>
              {PILLARS.map((p) => {
                const pct = seeded(`${p.key}|${fn}|${market}`, 34, 88);
                return (
                  <div key={p.key} className="text-right">
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: p.color }}
                    >
                      {pct}%
                    </span>
                    <div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: p.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        {extra > 0 && (
          <span className="text-slate-500 font-medium">
            + {extra} more {extra === 1 ? 'combination' : 'combinations'}.{' '}
          </span>
        )}
        Each score is measured across ChatGPT, Claude, Gemini and Perplexity.
      </p>
    </div>
  );
}
