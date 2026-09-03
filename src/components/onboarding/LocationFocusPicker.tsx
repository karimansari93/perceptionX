import { Check, Globe, MapPin, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCountryFlag } from '@/utils/countryFlags';
import type { LocationEntry } from '@/utils/locationContext';
import type { FocusSelection } from '@/hooks/useProfileSetup';

// Checklist of the organization's locations. Ticking adds a location to the
// user's focus list; the starred one is the PRIORITY the dashboard opens on.
// The first tick becomes the priority automatically; un-ticking the priority
// hands it to the next ticked location; nothing ticked = "All locations".
// Shared by /welcome, the first-login setup gate, and the Account page.

export const toggleFocusKey = (selection: FocusSelection, key: string): FocusSelection => {
  if (selection.keys.includes(key)) {
    const keys = selection.keys.filter((k) => k !== key);
    return { keys, primary: selection.primary === key ? keys[0] ?? null : selection.primary };
  }
  const keys = [...selection.keys, key];
  return { keys, primary: selection.primary ?? key };
};

export const setPrimaryFocusKey = (selection: FocusSelection, key: string): FocusSelection => ({
  keys: selection.keys.includes(key) ? selection.keys : [...selection.keys, key],
  primary: key,
});

interface LocationFocusPickerProps {
  options: LocationEntry[];
  value: FocusSelection;
  onChange: (next: FocusSelection) => void;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

const EntryIcon = ({ entry }: { entry: LocationEntry }) => {
  if (entry.icon === 'flag' && entry.flagCode) {
    return <span className="text-base leading-none">{getCountryFlag(entry.flagCode)}</span>;
  }
  if (entry.icon === 'pin') return <MapPin className="h-4 w-4 text-gray-400" />;
  return <Globe className="h-4 w-4 text-gray-400" />;
};

export const LocationFocusPicker = ({
  options,
  value,
  onChange,
  loading = false,
  disabled = false,
  className,
}: LocationFocusPickerProps) => {
  if (loading) {
    return (
      <div className={cn('rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-400', className)}>
        Loading locations…
      </div>
    );
  }
  if (options.length === 0) return null;

  const primaryEntry = value.primary
    ? options.find((o) => o.canonicalKey === value.primary)
    : undefined;
  const pinnedCount = value.keys.filter(
    (k) => k !== value.primary && options.some((o) => o.canonicalKey === k),
  ).length;

  return (
    <div className={cn('space-y-2', className)}>
      <div
        role="group"
        className="max-h-56 overflow-y-auto rounded-xl border border-gray-200 bg-white divide-y divide-gray-100"
      >
        {options.map((entry) => {
          const selected = value.keys.includes(entry.canonicalKey);
          const isPrimary = value.primary === entry.canonicalKey;
          return (
            <div
              key={entry.canonicalKey}
              className={cn('flex items-center gap-2.5 px-3 py-2', selected && 'bg-pink/5')}
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onChange(toggleFocusKey(value, entry.canonicalKey))}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:opacity-50"
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition',
                    selected ? 'border-pink bg-pink text-white' : 'border-gray-300 bg-white',
                  )}
                >
                  {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <EntryIcon entry={entry} />
                <span
                  className={cn(
                    'truncate text-[13px]',
                    selected ? 'font-semibold text-nightsky' : 'text-nightsky/80',
                  )}
                >
                  {entry.label}
                </span>
              </button>
              {selected && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(setPrimaryFocusKey(value, entry.canonicalKey))}
                  aria-pressed={isPrimary}
                  aria-label={
                    isPrimary
                      ? `${entry.label} is your priority location`
                      : `Make ${entry.label} your priority location`
                  }
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition disabled:opacity-50',
                    isPrimary ? 'bg-pink text-white' : 'text-gray-400 hover:bg-pink/10 hover:text-pink',
                  )}
                >
                  <Star className={cn('h-3 w-3', isPrimary && 'fill-current')} />
                  {isPrimary ? 'Priority' : 'Set priority'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-400 leading-relaxed">
        {primaryEntry ? (
          <>
            Your dashboard opens on{' '}
            <span className="font-semibold text-nightsky/70">{primaryEntry.label}</span>
            {pinnedCount > 0 && (
              <>
                ; {pinnedCount} more {pinnedCount === 1 ? 'location is' : 'locations are'} pinned in the
                location menu
              </>
            )}
            .
          </>
        ) : (
          'Pick the locations you work on and star one as your priority. Leave empty to open on all locations.'
        )}
      </p>
    </div>
  );
};
