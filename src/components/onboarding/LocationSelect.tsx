import { useState } from 'react';
import ReactCountryFlag from 'react-country-flag';
import { ChevronDown, Globe, MapPin, Map as MapIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LocationChecklist } from '@/components/location/LocationChecklist';
import type { LocationEntry } from '@/utils/locationContext';
import { resolveSelectionEntry } from '@/utils/locationSelection';
import { cn } from '@/lib/utils';

interface LocationSelectProps {
  options: LocationEntry[];
  // Selection key (one market, a region, or a set of markets), or null for
  // "All countries". See utils/locationSelection.ts.
  value: string | null;
  onChange: (key: string | null) => void;
  loading?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

// SVG flags (same as the Activate page): Windows has no flag emoji font, so
// emoji flags render there as two-letter codes.
const EntryIcon = ({ entry }: { entry: LocationEntry }) => {
  if (entry.icon === 'flag' && entry.flagCode) {
    return (
      <ReactCountryFlag
        countryCode={entry.flagCode}
        svg
        aria-hidden
        style={{ width: 18, height: 18, borderRadius: 3 }}
      />
    );
  }
  if (entry.icon === 'pin') return <MapPin className="h-4 w-4 text-gray-400" />;
  if (entry.icon === 'region') return <MapIcon className="h-4 w-4 text-gray-400" />;
  return <Globe className="h-4 w-4 text-gray-400" />;
};

// The "which markets?" half of "what do you want to focus on first?".
// Shared by /welcome, the first-login setup gate, and the Account page.
// Multi-select: one country, a region, or any combination.
export const LocationSelect = ({
  options,
  value,
  onChange,
  loading = false,
  disabled = false,
  id,
  className,
}: LocationSelectProps) => {
  const [open, setOpen] = useState(false);
  const selected = resolveSelectionEntry(value, options);
  const label = loading ? 'Loading countries…' : selected ? selected.label : 'All countries';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled || loading}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
        >
          <span className="flex items-center gap-2 truncate">
            {selected ? <EntryIcon entry={selected} /> : <Globe className="h-4 w-4 text-gray-400" />}
            <span className={cn('truncate', !selected && !loading && 'text-muted-foreground')}>{label}</span>
          </span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[260px] max-h-[60vh] overflow-y-auto p-1">
        <LocationChecklist options={options} value={value} onChange={onChange} allLabel="All countries" />
      </PopoverContent>
    </Popover>
  );
};
