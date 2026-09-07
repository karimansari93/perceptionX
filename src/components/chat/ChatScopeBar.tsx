import { useEffect, useState } from 'react';
import { Briefcase, Building2, Check, ChevronDown, Globe } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { fetchScopeOptions, type ChatScope, type ScopeOptions } from '@/services/chatService';

interface ChatScopeBarProps {
  organizationId: string;
  scope: ChatScope;
  onChange: (scope: ChatScope) => void;
  disabled?: boolean;
}

const ALL_MARKETS = 'All markets';
const ALL_FUNCTIONS = 'All functions';

function ScopePicker({
  icon: Icon, value, options, allLabel, onSelect, active, disabled,
}: {
  icon: typeof Globe;
  value: string | null | undefined;
  options: string[];
  allLabel: string | null;
  onSelect: (value: string | null) => void;
  active: boolean;
  disabled?: boolean;
}) {
  const label = value || allLabel || '—';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || (options.length === 0 && !value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors max-w-[240px]',
            active
              ? 'border-[#13274F]/40 bg-[#13274F]/5 text-[#13274F] hover:bg-[#13274F]/10'
              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900',
            'disabled:opacity-60 disabled:cursor-default'
          )}
        >
          <Icon className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
        {allLabel && (
          <DropdownMenuItem onClick={() => onSelect(null)} className="flex items-center justify-between">
            <span>{allLabel}</span>
            {!value && <Check className="h-4 w-4 text-blue-600" />}
          </DropdownMenuItem>
        )}
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

// The scope a question is asked under — company, market, job function — as
// three pills above the input. Pre-set from the dashboard filters when a
// question is handed over from the overview; changeable here; sent with
// every question so the analyst applies the same filters and says so.
export function ChatScopeBar({ organizationId, scope, onChange, disabled }: ChatScopeBarProps) {
  const [options, setOptions] = useState<ScopeOptions | null>(null);

  // Markets and functions depend on the chosen brand.
  useEffect(() => {
    let cancelled = false;
    fetchScopeOptions(organizationId, scope.company)
      .then(o => {
        if (cancelled) return;
        setOptions(o);
        // Adopt the resolved brand name (or the busiest brand when none was set).
        if (o.brand && o.brand !== scope.company) onChange({ ...scope, company: o.brand });
      })
      .catch(err => { if (!cancelled) console.warn('Scope options unavailable:', err); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, scope.company]);

  return (
    <div className="flex flex-wrap items-center gap-2 max-w-3xl mx-auto px-4 pt-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mr-1">Asking about</span>
      <ScopePicker
        icon={Building2}
        value={scope.company}
        options={options?.brands ?? []}
        allLabel={null}
        onSelect={v => onChange({ company: v, location: null, jobFunction: null })}
        active={false}
        disabled={disabled}
      />
      <ScopePicker
        icon={Globe}
        value={scope.location}
        options={options?.markets ?? []}
        allLabel={ALL_MARKETS}
        onSelect={v => onChange({ ...scope, location: v })}
        active={!!scope.location}
        disabled={disabled}
      />
      <ScopePicker
        icon={Briefcase}
        value={scope.jobFunction}
        options={options?.job_functions ?? []}
        allLabel={ALL_FUNCTIONS}
        onSelect={v => onChange({ ...scope, jobFunction: v })}
        active={!!scope.jobFunction}
        disabled={disabled}
      />
    </div>
  );
}

// Compact read-only chips for a question's scope (shown on the message).
export function ScopeChips({ scope }: { scope: ChatScope }) {
  const chips = [
    scope.company ? { icon: Building2, text: scope.company } : null,
    scope.location ? { icon: Globe, text: scope.location } : null,
    scope.jobFunction ? { icon: Briefcase, text: scope.jobFunction } : null,
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
