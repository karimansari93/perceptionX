import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PeriodInfo } from '@/hooks/useDashboardData';

interface PeriodSelectorProps {
  availablePeriods: PeriodInfo[];
  selectedPeriod: string | null;
  onPeriodChange: (period: string | null) => void;
  className?: string;
}

export const PeriodSelector = ({
  availablePeriods,
  selectedPeriod,
  onPeriodChange,
  className,
}: PeriodSelectorProps) => {
  // Hide when only 1 period exists
  if (availablePeriods.length <= 1) return null;

  const effectivePeriod = selectedPeriod
    ? availablePeriods.find(p => p.key === selectedPeriod)
    : availablePeriods[0]; // latest

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-9 px-3 text-sm font-medium border-gray-200 hover:bg-gray-50',
            className
          )}
        >
          <Calendar className="w-4 h-4 mr-2 text-gray-500" />
          <span className="truncate">{effectivePeriod?.label ?? 'Period'}</span>
          <ChevronDown className="w-3.5 h-3.5 ml-1.5 text-gray-400" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {availablePeriods.map(period => {
          const isSelected = period.key === (selectedPeriod ?? availablePeriods[0].key);
          return (
            <DropdownMenuItem
              key={period.key}
              onClick={() => onPeriodChange(period.key === availablePeriods[0].key ? null : period.key)}
              className="flex items-center justify-between"
            >
              <span>{period.label}</span>
              {isSelected && <Check className="w-4 h-4 text-blue-600" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
