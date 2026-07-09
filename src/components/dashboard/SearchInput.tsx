import { memo } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Override the wrapper sizing (defaults to flex-1 so it fills a toolbar row). */
  className?: string;
  "aria-label"?: string;
}

/**
 * Shared dashboard search box: a Search icon + Input styled identically across
 * the Prompts, Sources, Competitors and Themes tabs. Keep this the single source
 * of truth for the look so all tabs stay visually consistent.
 */
export const SearchInput = memo(({
  value,
  onChange,
  placeholder = "Search...",
  className,
  "aria-label": ariaLabel,
}: SearchInputProps) => {
  return (
    <div className={cn("relative flex-1 min-w-[200px]", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="h-8 w-full pl-8 rounded-lg border-gray-200 bg-white text-xs shadow-sm"
      />
    </div>
  );
});
SearchInput.displayName = "SearchInput";
