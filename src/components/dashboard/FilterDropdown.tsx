import { ReactNode, useMemo, useState } from "react";
import { Check, ChevronDown, LucideIcon, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
  /** Optional leading mark (favicon, logo, colored dot). */
  adornment?: ReactNode;
  /** Rows the option would match — shown as a muted count. */
  count?: number;
}

interface FilterDropdownProps {
  label: string;
  icon?: LucideIcon;
  options: FilterOption[];
  /** Empty = no filter (all rows pass). */
  selected: string[];
  onChange: (values: string[]) => void;
  /** Show a search box inside the panel once the list gets long. */
  searchable?: boolean;
  className?: string;
}

/**
 * Multi-select filter chip: a button showing the active count, opening a
 * checklist. Selecting nothing means "no filter", so the default state never
 * hides data.
 */
export const FilterDropdown = ({
  label,
  icon: Icon,
  options,
  selected,
  onChange,
  searchable = false,
  className,
}: FilterDropdownProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visibleOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, query]);

  if (options.length === 0) return null;

  const toggle = (value: string) => {
    if (selectedSet.has(value)) onChange(selected.filter(v => v !== value));
    else onChange([...selected, value]);
  };

  const active = selected.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 gap-1.5 rounded-lg border-gray-200 bg-white text-xs font-medium shadow-sm",
            active ? "text-gray-900" : "text-gray-600",
            className,
          )}
        >
          {Icon && <Icon className="w-3.5 h-3.5 text-gray-400" />}
          {label}
          {active && (
            <span className="ml-0.5 rounded-full bg-[#0DBCBA]/10 px-1.5 py-px text-[10px] font-semibold text-[#0A8B89]">
              {selected.length}
            </span>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        {searchable && options.length > 8 && (
          <div className="relative border-b border-gray-100 px-2 py-1.5">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="h-7 w-full rounded-md pl-7 pr-2 text-xs outline-none placeholder:text-gray-400"
            />
          </div>
        )}
        <div className="max-h-64 overflow-y-auto py-1">
          {visibleOptions.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-gray-400">No matches.</p>
          ) : (
            visibleOptions.map(option => {
              const isSelected = selectedSet.has(option.value);
              return (
                <button
                  key={option.value}
                  onClick={() => toggle(option.value)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-gray-50"
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border",
                      isSelected ? "border-[#0DBCBA] bg-[#0DBCBA] text-white" : "border-gray-300",
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </span>
                  {option.adornment}
                  <span className="truncate text-xs text-gray-700 capitalize">{option.label}</span>
                  {option.count !== undefined && (
                    <span className="ml-auto pl-2 text-[11px] tabular-nums text-gray-400">
                      {option.count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
        {active && (
          <div className="border-t border-gray-100 p-1.5">
            <button
              onClick={() => onChange([])}
              className="w-full rounded-md py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            >
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
