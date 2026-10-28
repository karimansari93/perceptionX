// Overview card: the actions waiting on this user. Their own open actions
// first (in progress, then to do), then unowned suggestions for the market
// selected in the header. Each row opens the action on the Actions tab.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CircleDashed, CircleDot, ListChecks } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useCompanyActions } from '@/hooks/useCompanyActions';
import { actionScope, displayTitle, pendingForUser, typeLabel, type CompanyAction } from '@/lib/actions';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionsEmptyState } from './ActionsEmptyState';
import { PriorityChip } from './PriorityChip';

// Fixed at five so the card fits the Overview's top row height; the header
// count and "View all" cover the rest.
const MAX_ROWS = 5;

export function ActionsSummaryCard({ markets }: { markets: string[] }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { viewAsMember } = useCompany();
  const { query, actions } = useCompanyActions();
  const meId = viewAsMember?.userId ?? user?.id ?? null;

  const { mine, suggested } = useMemo(
    () => pendingForUser(actions, meId, markets),
    [actions, meId, markets],
  );
  const rows: { action: CompanyAction; mine: boolean }[] = [
    ...mine.map((action) => ({ action, mine: true })),
    ...suggested.map((action) => ({ action, mine: false })),
  ].slice(0, MAX_ROWS);

  return (
    <section data-tour="actions-card" className="flex min-h-0 flex-col rounded-2xl border border-gray-200 bg-white px-4 pt-4 pb-3">
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium text-gray-900">
          <ListChecks className="h-4 w-4 text-gray-500" />
          Actions
          {mine.length + suggested.length > 0 && (
            <span className="rounded border border-gray-200 px-1.5 text-xs font-normal text-gray-600">{mine.length + suggested.length}</span>
          )}
        </h3>
        <button type="button" onClick={() => navigate('/dashboard/actions')} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900">
          View all<ArrowRight className="h-3 w-3" />
        </button>
      </header>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
        {query.isLoading ? (
          <div className="space-y-2 pt-1">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <ActionsEmptyState caughtUp={actions.length > 0} />
        ) : (
          // On desktop each row is a fifth of the card, so five fill it and
          // fewer keep the same rhythm. Below lg the card has no set height,
          // so rows pad instead.
          <ul className="flex flex-col divide-y divide-gray-100 lg:h-full">
            {rows.map(({ action, mine: isMine }) => (
              <li key={action.id} className="flex min-h-0 shrink-0 lg:basis-1/5">
                <button
                  type="button"
                  onClick={() => navigate(`/dashboard/actions?action=${action.id}`)}
                  className="flex w-full items-center gap-2.5 py-2.5 text-left hover:bg-gray-50 lg:py-0"
                  title={[
                    typeLabel(action)?.label ?? null,
                    (() => { const sc = actionScope(action); return sc.kind === 'global' ? 'Global' : sc.market; })(),
                    isMine ? (action.work_status === 'in_progress' ? 'In progress' : 'To do') : null,
                  ].filter(Boolean).join(' · ')}
                >
                  {isMine && action.work_status === 'in_progress'
                    ? <CircleDot className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    : <CircleDashed className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
                  {/* Title and priority on one line; type, market and status
                      show on hover. */}
                  <span className="line-clamp-1 min-w-0 flex-1 text-[13px] leading-5 text-gray-900">{displayTitle(action)}</span>
                  <PriorityChip action={action} className="shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

