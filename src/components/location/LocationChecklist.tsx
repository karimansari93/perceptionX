import { Check, Globe, MapPin, Minus, Map as MapIcon } from 'lucide-react';
import { getCountryFlag } from '@/utils/countryFlags';
import { GENERAL_KEY, LocationEntry } from '@/utils/locationContext';
import {
  atomicEntries,
  expandSelectionKey,
  regionEntries,
  regionTickState,
  toggleMarket,
  toggleRegion,
} from '@/utils/locationSelection';
import { cn } from '@/lib/utils';

// The body of the Location picker, shared by the dashboard filter and the
// onboarding / Account focus picker. Multi-select over the tracked markets:
//  - "All locations" clears the selection;
//  - a region row ticks (or unticks) every tracked country inside it, and
//    shows a dash while only some of them are ticked;
//  - each market row ticks on its own, so any combination works
//    ("India" + "United States");
//  - "General" (untagged prompts) is single-pick, as before.
// Selection state is ONE key (see utils/locationSelection.ts), so the picker
// takes and returns the same `string | null` the rest of the app stores.

export interface LocationChecklistProps {
  options: LocationEntry[];
  value: string | null;
  onChange: (key: string | null) => void;
  // Fired on hover/focus of a market row so its rollups prefetch.
  onIntentPrefetch?: (locationKey: string) => void;
  // Label for the clear-all row ("All locations" on the dashboard, "All
  // countries" in onboarding).
  allLabel?: string;
  // Compact styling for the dashboard dropdown; roomier in forms.
  dense?: boolean;
}

type TickState = 'all' | 'some' | 'none';

const TickBox = ({ state, round = false }: { state: TickState; round?: boolean }) => (
  <span
    aria-hidden
    className={cn(
      'flex h-4 w-4 shrink-0 items-center justify-center border border-[#13274F]/50',
      round ? 'rounded-full' : 'rounded-sm',
      state !== 'none' && 'bg-[#13274F] border-[#13274F] text-white'
    )}
  >
    {state === 'all' && <Check className="h-3 w-3" strokeWidth={3} />}
    {state === 'some' && <Minus className="h-3 w-3" strokeWidth={3} />}
  </span>
);

export const LocationEntryIcon = ({ icon, flagCode, className }: { icon: LocationEntry['icon']; flagCode: string | null; className?: string }) => {
  if (icon === 'flag' && flagCode) {
    return <span className={cn('text-base leading-none', className)}>{getCountryFlag(flagCode)}</span>;
  }
  if (icon === 'pin') return <MapPin className={cn('h-4 w-4', className)} />;
  if (icon === 'region') return <MapIcon className={cn('h-4 w-4', className)} />;
  return <Globe className={cn('h-4 w-4', className)} />;
};

export const LocationChecklist = ({
  options,
  value,
  onChange,
  onIntentPrefetch,
  allLabel = 'All locations',
  dense = false,
}: LocationChecklistProps) => {
  const regions = regionEntries(options);
  const markets = atomicEntries(options);
  const general = options.find((o) => o.canonicalKey === GENERAL_KEY) ?? null;
  const ticked = new Set(expandSelectionKey(value, options));
  const isAll = value === null;
  const isGeneral = value === GENERAL_KEY;

  const rowClass = cn(
    'flex w-full items-center gap-2 rounded-sm text-left outline-none transition-colors',
    'hover:bg-accent focus-visible:bg-accent',
    dense ? 'px-2 py-1.5 text-sm' : 'px-2 py-2 text-sm'
  );
  const headingClass = 'px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground';

  return (
    <div role="listbox" aria-multiselectable className="flex flex-col">
      <button
        type="button"
        role="option"
        aria-selected={isAll}
        className={cn(rowClass, isAll && 'font-semibold text-[#13274F]')}
        onClick={() => onChange(null)}
      >
        <TickBox state={isAll ? 'all' : 'none'} round />
        <Globe className="h-4 w-4" />
        <span>{allLabel}</span>
      </button>

      {regions.length > 0 && (
        <>
          <div className={headingClass}>Regions</div>
          {regions.map((region) => {
            const state = regionTickState(value, region, options);
            return (
              <button
                key={region.canonicalKey}
                type="button"
                role="option"
                aria-selected={state === 'all'}
                className={cn(rowClass, state === 'all' && 'font-semibold text-[#13274F]')}
                onClick={() => onChange(toggleRegion(value, region, options))}
                onMouseEnter={() => onIntentPrefetch?.(region.canonicalKey)}
                onFocus={() => onIntentPrefetch?.(region.canonicalKey)}
              >
                <TickBox state={state} />
                <LocationEntryIcon icon={region.icon} flagCode={region.flagCode} />
                <span className="truncate">{region.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">{region.memberKeys?.length ?? 0}</span>
              </button>
            );
          })}
        </>
      )}

      {markets.length > 0 && (
        <>
          <div className={headingClass}>{regions.length > 0 ? 'Markets' : 'Filter by location'}</div>
          {markets.map((entry) => {
            const on = ticked.has(entry.canonicalKey);
            return (
              <button
                key={entry.canonicalKey}
                type="button"
                role="option"
                aria-selected={on}
                className={cn(rowClass, on && 'font-semibold text-[#13274F]')}
                onClick={() => onChange(toggleMarket(value, entry.canonicalKey, options))}
                onMouseEnter={() => onIntentPrefetch?.(entry.canonicalKey)}
                onFocus={() => onIntentPrefetch?.(entry.canonicalKey)}
              >
                <TickBox state={on ? 'all' : 'none'} />
                <LocationEntryIcon icon={entry.icon} flagCode={entry.flagCode} />
                <span className="truncate">{entry.label}</span>
              </button>
            );
          })}
        </>
      )}

      {general && (
        <>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="option"
            aria-selected={isGeneral}
            className={cn(rowClass, isGeneral && 'font-semibold text-[#13274F]')}
            onClick={() => onChange(isGeneral ? null : GENERAL_KEY)}
            onMouseEnter={() => onIntentPrefetch?.(GENERAL_KEY)}
            onFocus={() => onIntentPrefetch?.(GENERAL_KEY)}
          >
            <TickBox state={isGeneral ? 'all' : 'none'} round />
            <Globe className="h-4 w-4" />
            <span>{general.label}</span>
          </button>
        </>
      )}
    </div>
  );
};
