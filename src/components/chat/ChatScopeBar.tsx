import { useEffect, useState } from 'react';
import { Briefcase, Check, ChevronDown, Globe } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { getCompetitorFavicon } from '@/utils/citationUtils';
import { fetchScopeOptions, type ChatScope, type ScopeOptions } from '@/services/chatService';

// ─── Options ────────────────────────────────────────────────────────────────
// The organization's brands plus one brand's tracked markets, job functions
// and latest measured period (the same spellings the analyst's tools match
// against). Cached per org + brand for the session so the overview box and
// the chat share one fetch.
const optionsCache = new Map<string, ScopeOptions>();

export function useScopeOptions(organizationId: string | undefined, company: string | null | undefined) {
  const key = organizationId ? `${organizationId}:${(company ?? '').toLowerCase()}` : null;
  const [options, setOptions] = useState<ScopeOptions | null>(() => (key && optionsCache.get(key)) || null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!organizationId || !key) return;
    const cached = optionsCache.get(key);
    if (cached) { setOptions(cached); return; }
    let cancelled = false;
    setIsLoading(true);
    fetchScopeOptions(organizationId, company)
      .then(o => { if (cancelled) return; optionsCache.set(key, o); setOptions(o); })
      .catch(err => { if (!cancelled) console.warn('Scope options unavailable:', err); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [organizationId, company, key]);

  return { options, isLoading };
}

// ─── Chips ──────────────────────────────────────────────────────────────────
// Two looks from the design system: `pill` (28px, fully round — the overview
// hero) and `chip` (26px, 8px radius — the chat composer and scope rows).
// Both: white ground, navy ink, hairline border, pink border on hover.
export type ChipVariant = 'pill' | 'chip';

const chipClass = (variant: ChipVariant, active = false) => cn(
  'inline-flex items-center gap-1.5 bg-white text-[#13274F] border transition-colors max-w-[260px] whitespace-nowrap',
  variant === 'pill' ? 'h-7 px-2.5 rounded-full text-[12.5px] font-medium' : 'h-[26px] px-[9px] rounded-lg text-xs',
  active ? 'border-[#DB5E89]/60' : 'border-[#13274F]/[0.12]',
  'hover:border-[#DB5E89] disabled:opacity-60 disabled:cursor-default'
);

export function BrandLogo({ name, className }: { name: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  const src = getCompetitorFavicon(name);
  if (!src || broken) {
    return <span className={cn('inline-flex items-center justify-center rounded-sm bg-[#13274F]/10 text-[9px] font-semibold text-[#13274F]', className)}>{name.charAt(0)}</span>;
  }
  return <img src={src} alt="" className={cn('rounded-sm object-contain', className)} onError={() => setBroken(true)} />;
}

function CompanyPicker({ value, options, onSelect, disabled, variant }: {
  value: string | null | undefined; options: string[]; onSelect: (v: string) => void; disabled?: boolean; variant: ChipVariant;
}) {
  const single = options.length <= 1;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={disabled || single} className={chipClass(variant)}>
          {value && <BrandLogo name={value} className={variant === 'pill' ? 'h-3.5 w-3.5' : 'h-3 w-3'} />}
          <span className="truncate">{value || 'Company'}</span>
          {!single && <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
        {options.map(opt => (
          <DropdownMenuItem key={opt} onClick={() => onSelect(opt)} className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 truncate"><BrandLogo name={opt} className="h-3.5 w-3.5" />{opt}</span>
            {value === opt && <Check className="h-4 w-4 text-[#13274F] flex-shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Multi-select: "All …" when nothing is ticked; the menu stays open while
// ticking so several markets or functions can be chosen in one go.
function MultiPicker({ icon: Icon, emoji, values, options, allLabel, noun, onChange, disabled, variant }: {
  icon?: typeof Globe; emoji?: string; values: string[]; options: string[]; allLabel: string; noun: string;
  onChange: (v: string[]) => void; disabled?: boolean; variant: ChipVariant;
}) {
  const label = values.length === 0 ? allLabel : values.length === 1 ? values[0] : `${values[0]} +${values.length - 1}`;
  const toggle = (opt: string) => onChange(values.includes(opt) ? values.filter(v => v !== opt) : [...values, opt]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={disabled || options.length === 0} className={chipClass(variant, values.length > 0)} title={values.join(', ') || allLabel}>
          {emoji ? <span className="text-[11px] leading-none">{emoji}</span> : Icon ? <Icon className="h-3 w-3 flex-shrink-0 opacity-70" /> : null}
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 max-h-80 overflow-y-auto">
        <DropdownMenuItem onSelect={() => onChange([])} className="flex items-center justify-between">
          <span>{allLabel}</span>
          {values.length === 0 && <Check className="h-4 w-4 text-[#13274F]" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map(opt => (
          <DropdownMenuCheckboxItem
            key={opt}
            checked={values.includes(opt)}
            onCheckedChange={() => toggle(opt)}
            onSelect={e => e.preventDefault()}
          >
            <span className="truncate">{opt}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {values.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-[11px] text-gray-500">{values.length} {noun}{values.length > 1 ? 's' : ''} selected</div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ScopePickersProps {
  scope: ChatScope;
  options: ScopeOptions | null;
  onChange: (scope: ChatScope) => void;
  disabled?: boolean;
  variant?: ChipVariant;
}

// Company (one) + markets (many) + job functions (many): what a
// question is asked about. Scope is chosen, never dismissed — no ✕ chips.
export function ScopePickers({ scope, options, onChange, disabled, variant = 'chip' }: ScopePickersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CompanyPicker
        value={scope.company ?? options?.brand ?? null}
        options={options?.brands ?? []}
        onSelect={v => onChange({ company: v, locations: [], jobFunctions: [] })}
        disabled={disabled}
        variant={variant}
      />
      <MultiPicker
        icon={Globe}
        values={scope.locations}
        options={options?.markets ?? []}
        allLabel={variant === 'chip' ? 'All locations' : 'All markets'}
        noun="market"
        onChange={v => onChange({ ...scope, locations: v })}
        disabled={disabled}
        variant={variant}
      />
      <MultiPicker
        icon={Briefcase}
        values={scope.jobFunctions}
        options={options?.job_functions ?? []}
        allLabel="All functions"
        noun="function"
        onChange={v => onChange({ ...scope, jobFunctions: v })}
        disabled={disabled}
        variant={variant}
      />
    </div>
  );
}

// ─── Read-only scope chips (SCOPE row on an answer, chips on a question) ────
export function ScopeChips({ scope, period, answers, tone = 'light' }: { scope: ChatScope; period?: string | null; answers?: number | null; tone?: 'light' | 'dark' }) {
  const base = tone === 'dark'
    ? 'inline-flex items-center gap-1 rounded-lg bg-white/15 px-2 py-0.5 text-[11px] text-white/90'
    : 'inline-flex items-center gap-1 rounded-lg border border-[#13274F]/[0.12] bg-white px-2 py-[3px] text-[11px] text-[#13274F]';
  const chips: React.ReactNode[] = [];
  if (scope.company) chips.push(<span key="c" className={base}><BrandLogo name={scope.company} className="h-3 w-3" />{scope.company}</span>);
  if (scope.locations.length) scope.locations.forEach(l => chips.push(<span key={`l-${l}`} className={base}>🌐 {l}</span>));
  else chips.push(<span key="l-all" className={base}>🌐 All locations</span>);
  if (scope.jobFunctions.length) scope.jobFunctions.forEach(f => chips.push(<span key={`f-${f}`} className={base}>{f}</span>));
  else chips.push(<span key="f-all" className={base}>All functions</span>);
  if (period) chips.push(<span key="p" className={cn(base, 'tabular-nums')}>{period}{typeof answers === 'number' ? ` · ${answers.toLocaleString()} responses` : ''}</span>);
  return <div className="flex flex-wrap items-center gap-1.5">{chips}</div>;
}

export function scopeSummary(scope: ChatScope): string {
  return [
    scope.company,
    scope.locations.length ? scope.locations.join(', ') : 'All locations',
    scope.jobFunctions.length ? scope.jobFunctions.join(', ') : 'All functions',
  ].filter(Boolean).join(' · ');
}
