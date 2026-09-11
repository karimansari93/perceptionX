import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Compact, shared failure state for dashboard cards and tables.
//
// Reliability rule (docs/audits/DATA_RELIABILITY_AUDIT_2026-09-11.md): a
// request that failed or has not loaded must never be presented as a real
// business metric — no "0%", no "No … found yet", no permanent skeleton.
// Every card renders this instead, with a Retry that refetches only the
// families currently in error.
interface DataUnavailableProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  // 'inline' fits inside a card body next to other content; 'block' is the
  // centered empty-state layout the cards already use.
  variant?: 'block' | 'inline';
  className?: string;
}

export const DataUnavailable = ({
  title = "Couldn't load this data.",
  description,
  onRetry,
  variant = 'block',
  className = '',
}: DataUnavailableProps) => {
  const retry = onRetry ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 rounded-full px-2.5 text-[11px]"
      onClick={(e) => { e.stopPropagation(); onRetry(); }}
    >
      <RefreshCw className="mr-1 h-3 w-3" />
      Retry
    </Button>
  ) : null;

  if (variant === 'inline') {
    return (
      <div role="alert" className={`flex flex-wrap items-center gap-2 text-[12px] text-gray-600 ${className}`}>
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
        <span className="font-medium text-gray-700">{title}</span>
        {description && <span className="text-gray-500">{description}</span>}
        {retry}
      </div>
    );
  }

  return (
    <div role="alert" className={`flex flex-col items-center justify-center gap-2 py-8 text-center text-gray-500 ${className}`}>
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
      </div>
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {description && <p className="max-w-xs text-xs text-gray-500">{description}</p>}
      {retry}
    </div>
  );
};
