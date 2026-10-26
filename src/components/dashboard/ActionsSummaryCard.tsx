// Overview card: the actions waiting on this user. Their own open actions
// first (in progress, then to do), then unowned suggestions for the market
// selected in the header. Each row opens the action on the Actions tab.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CircleDashed, CircleDot, ListChecks } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useCompanyActions } from '@/hooks/useCompanyActions';
import { actionScope, pendingForUser, typeLabel, type CompanyAction } from '@/lib/actions';
import { Skeleton } from '@/components/ui/skeleton';

// Fixed at three so the card never grows the Overview's top row; the header
// count and "View all" cover the rest.
const MAX_ROWS = 3;

export function ActionsSummaryCard({ market }: { market: string | null }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { viewAsMember } = useCompany();
  const { query, actions } = useCompanyActions();
  const meId = viewAsMember?.userId ?? user?.id ?? null;

  const { mine, suggested } = useMemo(
    () => pendingForUser(actions, meId, market ? [market] : []),
    [actions, meId, market],
  );
  const rows: { action: CompanyAction; mine: boolean }[] = [
    ...mine.map((action) => ({ action, mine: true })),
    ...suggested.map((action) => ({ action, mine: false })),
  ].slice(0, MAX_ROWS);

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-gray-200 bg-white px-4 pt-4 pb-3">
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
          <div className="space-y-2 pt-1">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <p className="py-4 text-sm text-gray-500">
            {actions.length ? 'Nothing waiting on you right now.' : 'Your actions appear here after your report is delivered.'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map(({ action, mine: isMine }) => (
              <li key={action.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/dashboard/actions?action=${action.id}`)}
                  className="flex w-full items-start gap-2.5 py-2 text-left hover:bg-gray-50"
                >
                  {isMine && action.work_status === 'in_progress'
                    ? <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    : <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-[13px] text-gray-900">{action.title}</span>
                    <span className="text-xs text-gray-500">
                      {[
                        typeLabel(action)?.label ?? null,
                        (() => { const sc = actionScope(action); return sc.kind === 'global' ? 'Global' : sc.market; })(),
                        isMine ? (action.work_status === 'in_progress' ? 'In progress' : 'To do') : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
