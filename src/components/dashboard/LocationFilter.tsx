import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GENERAL_KEY, LocationEntry, labelForCanonicalKey } from '@/utils/locationContext';
import { resolveSelectionEntry } from '@/utils/locationSelection';
import { LocationChecklist, LocationEntryIcon } from '@/components/location/LocationChecklist';
import { Globe, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LocationFilterProps {
  // Selection key of the active location(s), or null for "All locations".
  // One market, a region, or an explicit set — see utils/locationSelection.
  selectedLocation: string | null;
  onLocationChange: (location: string | null) => void;
  // Filter entries across the merged brand scope (location_context values +
  // each sibling profile's country + regions), built in useDashboardData.
  options?: LocationEntry[];
  // Intent prefetch: fired on hover/focus of an entry so its rollups are
  // cached before the click lands (no-op for already-fresh locations).
  onIntentPrefetch?: (locationKey: string) => void;
  className?: string;
}

export const LocationFilter = ({ selectedLocation, onLocationChange, options = [], onIntentPrefetch, className }: LocationFilterProps) => {
  const [isOpen, setIsOpen] = useState(false);

  // Nothing to filter — hide the control entirely.
  if (options.length === 0) {
    return null;
  }

  // The active selection's entry: a market/region row, a synthesized entry
  // for a multi-market set, or null for an unresolved key.
  const selectedEntry = resolveSelectionEntry(selectedLocation, options);

  // The trigger reflects the active focus: a market, a region, "India,
  // United States", "3 markets", or "All locations" when nothing is
  // filtered. A non-null selection with no matching option (stale key
  // mid-switch, or restored for another company) renders its own name — NOT
  // "All locations" — so the label never claims the filter is cleared while
  // state says otherwise; the reconcile effect in useDashboardData clears it
  // if it stays unresolvable once data loads.
  const displayName = selectedEntry
    ? selectedEntry.label
    : selectedLocation
      ? (selectedLocation === GENERAL_KEY ? 'General' : labelForCanonicalKey(selectedLocation))
      : 'All locations';
  const displayIcon = selectedEntry ? (
    <LocationEntryIcon icon={selectedEntry.icon} flagCode={selectedEntry.flagCode} />
  ) : (
    <Globe className="h-4 w-4" />
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={`Location filter: ${displayName}`}
          className={cn(
            'flex items-center gap-2 justify-between min-w-[140px] sm:min-w-[160px]',
            className
          )}
        >
          <div className="flex items-center gap-2">
            {displayIcon}
            <span className="font-medium truncate max-w-[100px] sm:max-w-[140px] text-xs sm:text-sm">
              {displayName}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      {/* Stays open while ticking so several markets can be combined. */}
      <PopoverContent align="start" className="w-[260px] max-h-[70vh] overflow-y-auto p-1">
        <LocationChecklist
          options={options}
          value={selectedLocation}
          onChange={onLocationChange}
          onIntentPrefetch={onIntentPrefetch}
          dense
        />
      </PopoverContent>
    </Popover>
  );
};
