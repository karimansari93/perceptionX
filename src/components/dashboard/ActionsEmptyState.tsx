// The empty state for actions, on the Overview card and the Actions tab: a
// faded checklist with a badge on top, then a title and one line. Actions
// published but none waiting on this user reads "caught up"; none published
// yet says when they arrive.
import { Check, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';

const ROWS = [72, 56, 64];

export function ActionsEmptyState({ caughtUp = false, size = 'card' }: { caughtUp?: boolean; size?: 'card' | 'page' }) {
  const page = size === 'page';
  return (
    <div className={cn('flex h-full flex-col items-center justify-center text-center', page ? 'gap-5 py-14' : 'gap-3 py-3')}>
      <div className="relative" aria-hidden="true">
        <div className={cn('rounded-xl border border-gray-100 bg-gray-50/80', page ? 'w-[220px] space-y-2.5 p-4' : 'w-[150px] space-y-1.5 p-2.5')}>
          {ROWS.map((w, i) => (
            <div key={i} className={cn('flex items-center', page ? 'gap-3' : 'gap-2')}>
              <span className={cn('shrink-0 rounded-full border-[1.5px]', page ? 'h-4 w-4' : 'h-3 w-3', caughtUp ? 'border-[#0DBCBA] bg-[#0DBCBA]/15' : 'border-gray-300')} />
              <span className={cn('rounded-full bg-gray-200', page ? 'h-2' : 'h-1.5')} style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
        <span className={cn(
          'absolute flex items-center justify-center rounded-full text-white shadow-sm ring-2 ring-white',
          page ? '-right-3.5 -top-3.5 h-9 w-9' : '-right-2.5 -top-2.5 h-7 w-7',
          caughtUp ? 'bg-[#0DBCBA]' : 'bg-[#DB5E89]',
        )}>
          {caughtUp ? <Check className={page ? 'h-4 w-4' : 'h-3.5 w-3.5'} /> : <ListChecks className={page ? 'h-4 w-4' : 'h-3.5 w-3.5'} />}
        </span>
      </div>
      <div>
        <p className={cn('font-medium text-[#13274F]', page ? 'text-base' : 'text-[13px]')}>{caughtUp ? 'You are all caught up' : 'No actions yet'}</p>
        <p className={cn('mx-auto text-gray-500', page ? 'mt-1 max-w-[420px] text-sm' : 'mt-0.5 text-xs')}>
          {caughtUp
            ? 'Nothing is waiting on you right now.'
            : page
              ? 'Recommended actions for your markets arrive with your quarterly report, ready to assign to your team.'
              : 'Recommended actions arrive with your quarterly report.'}
        </p>
      </div>
    </div>
  );
}
