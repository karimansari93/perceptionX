import { useEffect, useState } from 'react';
import { Briefcase, Building2, Check, ChevronDown, Globe } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { fetchScopeOptions, type ChatScope, type ScopeOptions } from '@/services/chatService';

// ─── Options ────────────────────────────────────────────────────────────────
// The organization's brands plus one brand's tracked markets and job
// functions (the same spellings the analyst's tools match against). Cached
// per org + brand for the session so the overview box and the chat share
// one fetch.
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

// ─── Pickers ────────────────────────────────────────────────────────────────

const pillClass = (active: boolean, size: 'sm' | 'md') => cn(
  'inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors max-w-[260px]',
  size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
  active
    ? 'border-[#13274F]/40 bg-[#13274F]/5 text-[#13274F] hover:bg-[#13274F]/10'
    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900',
  'disabled:opacity-60 disabled:cursor-default'
);

function SinglePicker({ icon: Icon, value, options, onSelect, disabled, size }: {
  icon: typeof Globe; value: string | null | undefined; options: string[];
  onSelect: (v: string) => void; disabled?: boolean; size: 'sm' | 'md';
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={disabled || options.length <= 1} className={pillClass(false, size)}>
          <Icon className={cn('flex-shrink-0 opacity-70', size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
          <span className="truncate">{value || 'Company'}</span>
          {options.length > 1 && <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
        {options.map(opt => (
          <DropdownMenuItem key={opt} onClick={() => onSelect(opt)} className="flex items-center justify-between">
            <span className="truncate">{opt}</span>
            {value === opt && <Check className="h-4 w-4 text-blue-600 flex-shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Multi-select: "All …" when nothing is ticked; the menu stays open while
// ticking so several markets or functions can be chosen in one go.
function MultiPicker({ icon: Icon, values, options, allLabel, noun, onChange, disabled, size }: {
  icon: typeof Globe; values: string[]; options: string[]; allLabel: string; noun: string;
  onChange: (v: string[]) => void; disabled?: boolean; size: 'sm' | 'md';
}) {
  const label = values.length === 0
    ? allLabel
    : values.length === 1 ? values[0] : `${values[0]} +${values.length - 1}`;
  const toggle = (opt: string) => onChange(values.includes(opt) ? values.filter(v => v !== opt) : [...values, opt]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={disabled || options.length === 0} className={pillClass(values.length > 0, size)} title={values.join(', ') || allLabel}>
          <Icon className={cn('flex-shrink-0 opacity-70', size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 max-h-80 overflow-y-auto">
        <DropdownMenuItem onSelect={() => onChange([])} className="flex items-center justify-between">
          <span>{allLabel}</span>
          {values.length === 0 && <Check className="h-4 w-4 text-blue-600" />}
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
  size?: 'sm' | 'md';
}

// Company (one) + markets (many) + job functions (many): what a question is
// asked about. Used before the first question (overview box, welcome
// screen) and above the input for the rest of the conversation.
export function ScopePickers({ scope, options, onChange, disabled, size = 'sm' }: ScopePickersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SinglePicker
        icon={Building2}
        value={scope.company ?? options?.brand ?? null}
        options={options?.brands ?? []}
        onSelect={v => onChange({ company: v, locations: [], jobFunctions: [] })}
        disabled={disabled}
        size={size}
      />
      <MultiPicker
        icon={Globe}
        values={scope.locations}
        options={options?.markets ?? []}
        allLabel="All markets"
        noun="market"
        onChange={v => onChange({ ...scope, locations: v })}
        disabled={disabled}
        size={size}
      />
      <MultiPicker
        icon={Briefcase}
        values={scope.jobFunctions}
        options={options?.job_functions ?? []}
        allLabel="All functions"
        noun="function"
        onChange={v => onChange({ ...scope, jobFunctions: v })}
        disabled={disabled}
        size={size}
      />
    </div>
  );
}

// ─── Bar above the chat input ───────────────────────────────────────────────
export function ChatScopeBar({ scope, options, onChange, disabled }: ScopePickersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 max-w-3xl mx-auto px-4 pt-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mr-1">Asking about</span>
      <ScopePickers scope={scope} options={options} onChange={onChange} disabled={disabled} size="sm" />
    </div>
  );
}

// ─── Read-only chips on a question ──────────────────────────────────────────
export function ScopeChips({ scope }: { scope: ChatScope }) {
  const chips = [
    scope.company ? { icon: Building2, text: scope.company } : null,
    ...scope.locations.map(l => ({ icon: Globe, text: l })),
    ...scope.jobFunctions.map(f => ({ icon: Briefcase, text: f })),
  ].filter(Boolean) as { icon: typeof Globe; text: string }[];
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-1.5">
      {chips.map(c => (
        <span key={c.text} className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] text-white/90">
          <c.icon className="h-3 w-3" />
          {c.text}
        </span>
      ))}
    </div>
  );
}

export function scopeSummary(scope: ChatScope): string {
  return [
    scope.company,
    scope.locations.length ? scope.locations.join(', ') : 'All markets',
    scope.jobFunctions.length ? scope.jobFunctions.join(', ') : 'All functions',
  ].filter(Boolean).join(' · ');
}
