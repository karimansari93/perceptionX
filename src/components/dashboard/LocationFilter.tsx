import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getCountryFlag } from '@/utils/countryFlags';
import { GENERAL_KEY, LocationEntry, labelForCanonicalKey } from '@/utils/locationContext';
import { Globe, MapPin, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LocationFilterProps {
  // Canonical key of the active location, or null for "All locations".
  selectedLocation: string | null;
  onLocationChange: (location: string | null) => void;
  // Filter entries across the merged brand scope (location_context values +
  // each sibling profile's country), built in useDashboardData.
  options?: LocationEntry[];
  className?: string;
}

// Render the leading icon for an entry: flag emoji for countries, a map pin for
// cities/states, a globe for global/unknown.
const EntryIcon = ({ icon, flagCode }: { icon: LocationEntry['icon']; flagCode: string | null }) => {
  if (icon === 'flag' && flagCode) {
    return <span className="text-base leading-none">{getCountryFlag(flagCode)}</span>;
  }
  if (icon === 'pin') return <MapPin className="h-4 w-4" />;
  return <Globe className="h-4 w-4" />;
};

export const LocationFilter = ({ selectedLocation, onLocationChange, options = [], className }: LocationFilterProps) => {
  const [isOpen, setIsOpen] = useState(false);

  // Nothing to filter — hide the control entirely.
  if (options.length === 0) {
    return null;
  }

  const selectedEntry = selectedLocation
    ? options.find(o => o.canonicalKey === selectedLocation)
    : undefined;

  // Every entry filters within the merged brand scope — selecting a country
  // never switches company anymore (sibling profiles are aggregated).
  const handleSelect = (entry: LocationEntry) => {
    setIsOpen(false);
    onLocationChange(entry.canonicalKey);
  };

  // The trigger reflects the active focus: a chosen city/country, or "All
  // locations" when nothing is filtered. A non-null selection with no matching
  // option (stale key mid-switch, or restored for another company) renders its
  // own name — NOT "All locations" — so the label never claims the filter is
  // cleared while state says otherwise; the reconcile effect in
  // useDashboardData clears it if it stays unresolvable once data loads.
  const displayName = selectedEntry
    ? selectedEntry.label
    : selectedLocation
      ? (selectedLocation === GENERAL_KEY ? 'General' : labelForCanonicalKey(selectedLocation))
      : 'All locations';
  const displayIcon = selectedEntry ? (
    <EntryIcon icon={selectedEntry.icon} flagCode={selectedEntry.flagCode} />
  ) : (
    <Globe className="h-4 w-4" />
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'flex items-center gap-2 justify-between min-w-[140px] sm:min-w-[160px]',
            className
          )}
        >
          <div className="flex items-center gap-2">
            {displayIcon}
            <span className="font-medium truncate max-w-[100px] sm:max-w-[120px] text-xs sm:text-sm">
              {displayName}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[220px]">
        <DropdownMenuLabel>Filter by Location</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* "All locations" clears the filter. */}
        <DropdownMenuItem
          onClick={() => { setIsOpen(false); onLocationChange(null); }}
          className="cursor-pointer flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            {!selectedLocation ? (
              <Check className="h-4 w-4 text-[#13274F]" />
            ) : (
              <div className="h-4 w-4" />
            )}
            <Globe className="h-4 w-4" />
            <span className={cn('text-sm', !selectedLocation && 'font-semibold text-[#13274F]')}>
              All locations
            </span>
          </div>
        </DropdownMenuItem>
        {options.map(entry => {
          const isSelected = selectedLocation === entry.canonicalKey;
          return (
            <DropdownMenuItem
              key={entry.canonicalKey}
              onClick={() => handleSelect(entry)}
              className="cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                {isSelected ? (
                  <Check className="h-4 w-4 text-[#13274F]" />
                ) : (
                  <div className="h-4 w-4" />
                )}
                <EntryIcon icon={entry.icon} flagCode={entry.flagCode} />
                <span className={cn('text-sm', isSelected && 'font-semibold text-[#13274F]')}>
                  {entry.label}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

