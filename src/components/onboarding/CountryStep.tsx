import type { ReactNode } from 'react';
import ReactCountryFlag from 'react-country-flag';
import { Check, Globe, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LocationEntry } from '@/utils/locationContext';

interface CountryStepProps {
  options: LocationEntry[];
  loading?: boolean;
  // Canonical key of the chosen country; null = "All countries" chosen
  // deliberately; undefined = nothing chosen yet.
  value: string | null | undefined;
  onSelect: (key: string | null) => void;
  disabled?: boolean;
}

const Tile = ({
  selected,
  onClick,
  icon,
  label,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  disabled: boolean;
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] transition disabled:opacity-50',
      selected
        ? 'border-pink bg-pink/5 font-semibold text-nightsky'
        : 'border-gray-200 bg-white text-nightsky/85 hover:border-gray-300',
    )}
  >
    <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
    {selected && <Check className="h-3.5 w-3.5 shrink-0 text-pink" strokeWidth={3} />}
  </button>
);

const EntryIcon = ({ entry }: { entry: LocationEntry }) => {
  if (entry.icon === 'flag' && entry.flagCode) {
    // SVG flags: Windows has no flag emoji font.
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

// "Which country do you focus on first?" — flag tiles for the chosen
// company's countries plus an "All countries" tile. Nothing is preselected,
// so "All countries" is a deliberate choice rather than the resting state.
export const CountryStep = ({
  options,
  loading = false,
  value,
  onSelect,
  disabled = false,
}: CountryStepProps) => {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2" aria-busy>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-11 rounded-xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1" role="radiogroup">
        <Tile
          selected={value === null}
          onClick={() => onSelect(null)}
          icon={<Globe className="h-4 w-4 text-gray-400" />}
          label="All countries"
          disabled={disabled}
        />
        {options.map((entry) => (
          <Tile
            key={entry.canonicalKey}
            selected={value === entry.canonicalKey}
            onClick={() => onSelect(entry.canonicalKey)}
            icon={<EntryIcon entry={entry} />}
            label={entry.label}
            disabled={disabled}
          />
        ))}
      </div>
      {options.length === 0 && (
        <p className="text-[12px] text-gray-400">
          No country data yet for this company, so your dashboard will open on all countries.
        </p>
      )}
    </div>
  );
};
