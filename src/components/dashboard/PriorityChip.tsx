// Priority chip for an action, shared by the Actions tab and the Overview's
// Actions card.
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { PRIORITY_LABEL, priorityOf, type CompanyAction, type Priority } from '@/lib/actions';

// Soft tinted pills, no border: blue for High, slate for Medium, grey for
// Low. One cool scale, so the chip reads as a label and not an alarm.
const PRIORITY_STYLE: Record<Priority, string> = {
  high: 'bg-blue-50 text-blue-700',
  medium: 'bg-slate-100 text-slate-700',
  low: 'bg-gray-100 text-gray-500',
};

// The priority label (High strong, Medium, Low) with the reason on hover.
// Nothing for an unlabelled action.
export function PriorityChip({ action, className }: { action: CompanyAction; className?: string }) {
  const priority = priorityOf(action);
  if (!priority) return null;
  const chip = (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', PRIORITY_STYLE[priority], className)} aria-label={`${PRIORITY_LABEL[priority]} priority`}>
      {PRIORITY_LABEL[priority]}
    </span>
  );
  if (!action.priority_reason) return chip;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">{action.priority_reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
