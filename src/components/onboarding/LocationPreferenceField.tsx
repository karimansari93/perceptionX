import { Globe, MapPin } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getCountryFlag } from '@/utils/countryFlags';
import type { LocationEntry } from '@/utils/locationContext';

// Radix Select forbids an empty-string item value, so "All locations" gets a
// sentinel that maps back to null for callers.
const ALL_LOCATIONS = '__all__';

interface LocationPreferenceFieldProps {
  options: LocationEntry[];
  // Canonical location key, or null for "All locations".
  value: string | null;
  onChange: (key: string | null) => void;
  loading?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const EntryIcon = ({ entry }: { entry: LocationEntry }) => {
  if (entry.icon === 'flag' && entry.flagCode) {
    return <span className="text-base leading-none">{getCountryFlag(entry.flagCode)}</span>;
  }
  if (entry.icon === 'pin') return <MapPin className="h-4 w-4 text-gray-400" />;
  return <Globe className="h-4 w-4 text-gray-400" />;
};

// The "which location do you focus on?" picker shared by the /welcome form,
// the first-login setup gate, and the Account page.
export const LocationPreferenceField = ({
  options,
  value,
  onChange,
  loading = false,
  disabled = false,
  id,
  className,
}: LocationPreferenceFieldProps) => (
  <Select
    value={value ?? ALL_LOCATIONS}
    onValueChange={(v) => onChange(v === ALL_LOCATIONS ? null : v)}
    disabled={disabled || loading}
  >
    <SelectTrigger id={id} className={className}>
      <SelectValue placeholder={loading ? 'Loading locations…' : 'All locations'} />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value={ALL_LOCATIONS}>
        <span className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-gray-400" />
          All locations
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
