import ReactCountryFlag from 'react-country-flag';
import { Globe, MapPin } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LocationEntry } from '@/utils/locationContext';

// Radix Select forbids an empty-string item value, so "All countries" gets a
// sentinel that maps back to null for callers.
const ALL_LOCATIONS = '__all__';

interface LocationSelectProps {
  options: LocationEntry[];
  // Canonical location key, or null for "All countries".
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
  return <Globe className="h-4 w-4 text-gray-400" />;
};

// The "which country?" half of "what do you want to focus on first?".
// Shared by /welcome, the first-login setup gate, and the Account page.
export const LocationSelect = ({
  options,
  value,
  onChange,
  loading = false,
  disabled = false,
  id,
  className,
}: LocationSelectProps) => (
  <Select
    value={value ?? ALL_LOCATIONS}
    onValueChange={(v) => onChange(v === ALL_LOCATIONS ? null : v)}
    disabled={disabled || loading}
  >
    <SelectTrigger id={id} className={className}>
      <SelectValue placeholder={loading ? 'Loading countries…' : 'All countries'} />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value={ALL_LOCATIONS}>
        <span className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-gray-400" />
          All countries
        </span>
      </SelectItem>
      {options.map((entry) => (
        <SelectItem key={entry.canonicalKey} value={entry.canonicalKey}>
          <span className="flex items-center gap-2">
            <EntryIcon entry={entry} />
            {entry.label}
          </span>
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);
