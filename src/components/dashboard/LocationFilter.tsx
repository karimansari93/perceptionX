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
import { useCompany } from '@/contexts/CompanyContext';
import { getCountryFlag } from '@/utils/countryFlags';
import { LocationEntry } from '@/utils/locationContext';
import { Globe, MapPin, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LocationFilterProps {
  // Canonical key of the active location, or null for "All locations".
  selectedLocation: string | null;
  onLocationChange: (location: string | null) => void;
  // Stash a location to apply right after a company switch (sibling-row brands),
  // so the trigger reflects the picked country once the switch lands.
  onPendingLocationChange?: (location: string | null) => void;
  // Merged dropdown options (in-company location_context filters + legacy
  // sibling-company switches), built in useDashboardData.
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

export const LocationFilter = ({ selectedLocation, onLocationChange, onPendingLocationChange, options = [], className }: LocationFilterProps) => {
  const { switchCompany } = useCompany();
  const [isOpen, setIsOpen] = useState(false);

  // Nothing to filter or switch to — hide the control entirely.
  if (options.length === 0) {
    return null;
  }

  const selectedEntry = selectedLocation
    ? options.find(o => o.canonicalKey === selectedLocation)
    : undefined;

  const handleSelect = async (entry: LocationEntry) => {
    setIsOpen(false);
    if (entry.action.type === 'switchCompany') {
      // Legacy cross-country variant: switch to the sibling company, and select
      // this location once the switch lands so the trigger shows it (the target
      // company's data carries the same canonical location).
      onPendingLocationChange?.(entry.canonicalKey);
      try {
        await switchCompany(entry.action.companyId);
      } catch (error) {
        onPendingLocationChange?.(null);
        console.error('Failed to switch company:', error);
      }
      return;
    }
    // In-company location_context filter.
    onLocationChange(entry.canonicalKey);
  };

  // The trigger reflects the active focus: a chosen city/country, or "All
  // locations" when nothing is filtered.
  const displayName = selectedEntry ? selectedEntry.label : 'All locations';
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

