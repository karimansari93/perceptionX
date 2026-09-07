import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Briefcase, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const ALL_FUNCTIONS = 'all';

interface JobFunctionFilterProps {
  /** Job functions present in the current view (company + location + period). */
  options: string[];
  /** 'all' or one of `options`. */
  selected: string;
  onChange: (value: string) => void;
  className?: string;
}

// Top-bar job-function filter, next to Period and Location. Replaces the
// per-tab pill rows: one control, one shared selection across every tab
// (the selection itself is owned by the Dashboard).
export const JobFunctionFilter = ({ options, selected, onChange, className }: JobFunctionFilterProps) => {
  if (options.length === 0) return null;
  const label = selected === ALL_FUNCTIONS || !options.includes(selected) ? 'All functions' : selected;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-9 px-3 text-sm font-medium border-gray-200 hover:bg-gray-50 max-w-[220px]',
            selected !== ALL_FUNCTIONS && 'border-[#13274F]/40 text-[#13274F]',
            className
          )}
        >
          <Briefcase className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown className="w-3.5 h-3.5 ml-1.5 text-gray-400 flex-shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 max-h-80 overflow-y-auto">
        <DropdownMenuItem onClick={() => onChange(ALL_FUNCTIONS)} className="flex items-center justify-between">
          <span>All functions</span>
          {selected === ALL_FUNCTIONS && <Check className="w-4 h-4 text-blue-600" />}
        </DropdownMenuItem>
        {options.map(fn => (
          <DropdownMenuItem key={fn} onClick={() => onChange(fn)} className="flex items-center justify-between">
            <span className="truncate">{fn}</span>
            {selected === fn && <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
