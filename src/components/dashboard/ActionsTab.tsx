// Actions tab: the organisation's action register (company_actions) as a
// three-column board. Columns follow the owner's own status: Suggested (open),
// In progress, Done. "Accept" claims an unowned action and moves it to In
// progress; the owner marks it done with a note and the URL of the change.
// Writes go through the SECURITY DEFINER RPCs only (assign_company_action,
// set_company_action_status), which also enforce who may change what.
//
// Visibility: everyone in the organisation sees every action in its register
// (RLS scopes rows to the viewer's organisation). The default "For you" view
// matches the quarterly email: the actions for the header's market only (it
// lands on the user's saved location), or everything when no market is
// selected, plus anything they own; "All" shows everything.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, XCircle, ArrowRight, ArrowRightLeft, ArrowUpRight, Award, BadgeCheck, Briefcase, Globe, Linkedin, Youtube, Check, ChevronDown, ChevronRight, Lightbulb, ListChecks, CircleDashed, CircleDot, CheckCircle2, Eye, FileText, Lock, Megaphone, MessagesSquare, RotateCcw, Send, Star, User, UserPlus, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCompanyActions } from '@/hooks/useCompanyActions';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSeedTabSearch } from '@/contexts/TabSearchSeedContext';
import { useAuth } from '@/contexts/AuthContext';
import { brandOf, useCompany } from '@/contexts/CompanyContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Favicon } from '@/components/ui/favicon';
import { activateLinkFor } from '@/lib/activate/api';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { ActionsEmptyState } from './ActionsEmptyState';
import { PriorityChip } from './PriorityChip';
import { GENERAL_KEY, canonicalizeLocationContext, countryCodeFor, type LocationEntry } from '@/utils/locationContext';
import {
  BOARD_COLUMNS, LANE_LABEL, STATUS_LABEL, typeLabel, buildBoard, cycleLabel, noteParts,
  sourcesTarget, displayTitle, selectionMarkets, actionScope, isPeopleAction, pickAmplifyLink, type AmplifyLink, readingView, trendText, type ReadingView, DISMISS_REASONS, dismissReasonLabel, timeAgo, COMMENT_MAX, type ActionActivity, type ActionCheck, type CompanyAction, type WorkStatus,
  PRIORITIES, PRIORITY_LABEL, priorityOf, type Priority,
} from '@/lib/actions';

const db = supabase as any;


interface Person { id: string; name: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateInWords(iso: string | null | undefined): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

const COLUMN_ICON: Record<'open' | 'in_progress' | 'done', JSX.Element> = {
  open: <CircleDashed className="h-4 w-4 text-gray-400" />,
  in_progress: <CircleDot className="h-4 w-4 text-amber-500" />,
  done: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
};

interface ActionsTabProps {
  selectedLocation: string | null;
  locationOptions: LocationEntry[] | undefined;
  onLocationChange?: (location: string | null) => void;
  onPendingLocationChange?: (location: string | null) => void;
}

export function ActionsTab({ selectedLocation, locationOptions, onLocationChange, onPendingLocationChange }: ActionsTabProps) {
  const { user } = useAuth();
  const { isOwnerOrAdmin, viewAsMember, currentCompany, userCompanies, switchCompany } = useCompany();
  const { orgId, query: actionsQuery, actions } = useCompanyActions();
  // Previewing as a member: their id decides "For you", "You" and what they
  // could do; the controls are locked (lockedReason) so nothing is written.
  const meId = viewAsMember?.userId ?? user?.id ?? null;
  const queryClient = useQueryClient();

  const [scope, setScope] = useState<'for_you' | 'all'>('for_you');
  // Priority filter: 'all' or one label. Only offered once the register
  // carries labels, so an unlabelled register shows no empty control.
  const [priority, setPriority] = useState<Priority | 'all'>('all');
  const hasPriorities = actions.some((a) => priorityOf(a) !== null);
  // ?action=<id> (from the Overview card) opens that action's detail.
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const seedTabSearch = useSeedTabSearch();
  const openId = searchParams.get('action');
  const setOpenId = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('action', id); else next.delete('action');
    setSearchParams(next, { replace: true });
  };
  const [doneFor, setDoneFor] = useState<CompanyAction | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [dismissedOpen, setDismissedOpen] = useState(false);
  const [dismissFor, setDismissFor] = useState<CompanyAction | null>(null);

  const checksQuery = useQuery({
    queryKey: ['company-action-checks', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<ActionCheck[]> => {
      const { data, error } = await db.from('company_action_checks')
        .select('id, action_id, cycle, checked_on, status, metric_readings, note').eq('organization_id', orgId);
      if (error) throw error;
      return data || [];
    },
  });

  // The organisation's Amplify share links (list_amplify_links); none until
  // that function exists, which simply hides the share button.
  const amplifyQuery = useQuery({
    queryKey: ['amplify-links', orgId],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AmplifyLink[]> => {
      const { data, error } = await db.rpc('list_amplify_links', { p_organization_id: orgId });
      return error ? [] : (data || []);
    },
  });
  const amplifyUrlFor = (a: CompanyAction): string | null => {
    if (!isPeopleAction(a)) return null;
    const scope = actionScope(a);
    const link = pickAmplifyLink(amplifyQuery.data || [], scope.kind === 'market' ? countryCodeFor(scope.market) : null);
    return link ? activateLinkFor(link.token, link.link_subdomain) : null;
  };

  const orgNameQuery = useQuery({
    queryKey: ['organization-name', orgId],
    enabled: !!orgId,
    staleTime: Infinity,
    queryFn: async (): Promise<string | null> => {
      const { data } = await db.from('organizations').select('name').eq('id', orgId).maybeSingle();
      return data?.name ?? null;
    },
  });

  // Org owners and admins pick an owner from the organisation's members.
  // Teammates for the owner picker, through list_action_assignees
  // (organization_members is admin-only under RLS). Org admins fall back to
  // the table itself if the function is unavailable.
  const teammatesQuery = useQuery({
    queryKey: ['action-teammates', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Person[]> => {
      const rpc = await db.rpc('list_action_assignees', { p_organization_id: orgId });
      if (!rpc.error) {
        return (rpc.data || []).map((r: { user_id: string; full_name: string | null; email: string | null }) => ({
          id: r.user_id, name: r.full_name?.trim() || r.email || 'Team member',
        }));
      }
      if (!isOwnerOrAdmin) return [];
      const { data: rows, error } = await db.from('organization_members').select('user_id').eq('organization_id', orgId);
      if (error) throw error;
      const ids = (rows || []).map((m: { user_id: string }) => m.user_id);
      if (!ids.length) return [];
      const { data: profiles } = await db.from('profiles').select('id, full_name, email').in('id', ids);
      return (profiles || []).map((p: { id: string; full_name: string | null; email: string | null }) => ({
        id: p.id, name: p.full_name?.trim() || p.email || 'Team member',
      })).sort((a: Person, b: Person) => a.name.localeCompare(b.name));
    },
  });
  const teammates = teammatesQuery.data ?? [];

  // The open action's feed: comments and change events (company_action_activity).
  // An error (the table not yet migrated, say) reads as an empty feed.
  const activityQuery = useQuery({
    queryKey: ['action-activity', openId],
    enabled: !!openId,
    queryFn: async (): Promise<ActionActivity[]> => {
      const { data, error } = await db.from('company_action_activity')
        .select('id, action_id, actor_id, kind, body, data, created_at')
        .eq('action_id', openId)
        .order('created_at', { ascending: true });
      return error ? [] : (data || []);
    },
  });
  const activity = useMemo(() => activityQuery.data ?? [], [activityQuery.data]);

  // Everyone named on the board or in the open feed, for profile lookups.
  const peopleIds = useMemo(() => {
    const ids = new Set<string>();
    actions.forEach((a) => a.assignee_id && ids.add(a.assignee_id));
    activity.forEach((r) => {
      if (r.actor_id) ids.add(r.actor_id);
      const d = (r.data || {}) as Record<string, unknown>;
      for (const k of ['from', 'to']) if (typeof d[k] === 'string') ids.add(d[k] as string);
    });
    return Array.from(ids).sort();
  }, [actions, activity]);

  const peopleQuery = useQuery({
    queryKey: ['action-people', peopleIds],
    enabled: peopleIds.length > 0,
    queryFn: async (): Promise<Person[]> => {
      const { data, error } = await db.from('profiles').select('id, full_name, email').in('id', peopleIds);
      if (error) throw error;
      return (data || []).map((p: { id: string; full_name: string | null; email: string | null }) => ({
        id: p.id, name: p.full_name?.trim() || p.email || 'Team member',
      }));
    },
  });
  const nameOf = (id: string | null) => {
    if (!id) return null;
    if (id === meId) return viewAsMember ? viewAsMember.name : 'You';
    return peopleQuery.data?.find((p) => p.id === id)?.name ?? teammates.find((p) => p.id === id)?.name ?? 'Team member';
  };

  // The header's market (it opens on the user's saved location), as every
  // spelling the register might use.
  // The header's selection (one market, a region or a set), in every
  // spelling the register might use.
  const myMarket = useMemo(() => selectionMarkets(selectedLocation, locationOptions), [selectedLocation, locationOptions]);

  const board = useMemo(() => buildBoard(actions, {
    forYou: scope === 'for_you',
    markets: myMarket ? myMarket.spellings : [],
    includeUserId: meId,
    priority: priority === 'all' ? null : priority,
  }), [actions, scope, myMarket, meId, priority]);

  const checksFor = (id: string) => (checksQuery.data || [])
    .filter((c) => c.action_id === id)
    .sort((a, b) => String(b.cycle).localeCompare(String(a.cycle)));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['company-actions', orgId] });
    queryClient.invalidateQueries({ queryKey: ['action-activity'] });
  };
  const fail = (e: unknown) => toast.error((e as { message?: string })?.message || 'Something went wrong. Please try again.');

  // Permissions are worked out for the viewer: the member being previewed, or
  // the signed-in user. In preview the controls show but are locked, since a
  // click would be recorded under the admin's own account.
  const lockedReason = viewAsMember ? `Read only while viewing as ${viewAsMember.name}` : null;
  const canChange = (a: CompanyAction) => isOwnerOrAdmin || (!!meId && a.assignee_id === meId);
  const canAccept = (a: CompanyAction) => !a.assignee_id || canChange(a);
  // Who may pick an owner: anyone for an unowned action, the owner for their
  // own, org admins for any (assign_company_action enforces the same).
  const canReassign = (a: CompanyAction) => a.work_status !== 'dismissed'
    && (isOwnerOrAdmin || !a.assignee_id || (!!meId && a.assignee_id === meId));
  const canDismiss = (a: CompanyAction) => a.register !== 'watch' && (a.work_status === 'open' || a.work_status === 'in_progress') && canAccept(a);
  const canRestore = (a: CompanyAction) => a.work_status === 'dismissed' && (isOwnerOrAdmin || (!!meId && a.dismissed_by === meId));

  const setStatus = useMutation({
    mutationFn: async ({ action, status, note, url }: { action: CompanyAction; status: WorkStatus; note?: string; url?: string }) => {
      if (!action.assignee_id && user) {
        const { error } = await db.rpc('assign_company_action', { p_action_id: action.id, p_assignee_id: user.id });
        if (error) throw error;
      }
      const { error } = await db.rpc('set_company_action_status', {
        p_action_id: action.id, p_status: status, p_note: note ?? null, p_url: url ?? null,
      });
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      toast.success(status === 'in_progress' ? 'Action accepted. It is now in progress.' : status === 'done' ? 'Marked as done.' : 'Moved back to suggested.');
      refresh();
    },
    onError: (e) => { fail(e); refresh(); },
  });

  const assign = useMutation({
    mutationFn: async ({ action, assigneeId }: { action: CompanyAction; assigneeId: string | null }) => {
      const { error } = await db.rpc('assign_company_action', { p_action_id: action.id, p_assignee_id: assigneeId });
      if (error) throw error;
    },
    onSuccess: (_d, { assigneeId }) => {
      toast.success(assigneeId ? `Assigned to ${assigneeId === user?.id ? 'you' : teammates.find((t) => t.id === assigneeId)?.name ?? 'your teammate'}.` : 'Unassigned.');
      refresh();
    },
    onError: fail,
  });

  const dismiss = useMutation({
    mutationFn: async ({ action, reason, note }: { action: CompanyAction; reason: string; note: string }) => {
      const { error } = await db.rpc('dismiss_company_action', { p_action_id: action.id, p_reason: reason, p_note: note || null });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Dismissed. Thanks for telling us why.'); setOpenId(null); refresh(); },
    onError: fail,
  });

  const restore = useMutation({
    mutationFn: async (action: CompanyAction) => {
      const { error } = await db.rpc('restore_company_action', { p_action_id: action.id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Restored to suggested.'); refresh(); },
    onError: fail,
  });

  // A comment in the open action's feed, in the signed-in user's name (RLS
  // checks both). Preview mode never reaches here: the box is locked.
  const addComment = useMutation({
    mutationFn: async ({ action, body }: { action: CompanyAction; body: string }) => {
      if (!user) throw new Error('Not signed in');
      const { error } = await db.from('company_action_activity').insert({
        action_id: action.id, organization_id: action.organization_id, actor_id: user.id, kind: 'comment', body,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['action-activity'] }),
    onError: fail,
  });

  // "See in Sources": open the source on a company that covers the action's
  // market (see sourcesTarget); null hides the button.
  const seeInSources = (action: CompanyAction) => {
    const headerMarket = myMarket?.label ?? null;
    const companies = (userCompanies || [])
      .filter((c) => !orgId || !c.organization_id || c.organization_id === orgId)
      .map((c) => ({ id: c.id, name: c.name, country: c.country ?? null, brand: brandOf(c) }));
    const target = sourcesTarget(action, companies, orgNameQuery.data, headerMarket, currentCompany?.id, canonicalizeLocationContext);
    if (!target) return null;
    return async (domain: string) => {
      const key = target.market ? canonicalizeLocationContext(target.market) : selectedLocation;
      setOpenId(null);
      if (target.companyId !== currentCompany?.id) {
        // The company switch resets the location; the pending one wins.
        onPendingLocationChange?.(key);
        await switchCompany(target.companyId);
      } else if (key !== selectedLocation) {
        onLocationChange?.(key);
      }
      seedTabSearch('sources', domain);
      navigate('/dashboard/sources');
    };
  };

  const openAction = actions.find((a) => a.id === openId) ?? null;
  const total = board.columns.open.length + board.columns.in_progress.length + board.columns.done.length;

  if (actionsQuery.isLoading || !orgId) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div data-tour="actions-heading" className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-medium tracking-[-0.02em] text-gray-900">Actions</h2>
          <p className="text-sm text-gray-500 mt-1">
            What to do next to change how AI describes you to candidates.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
        {hasPriorities && (
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority | 'all')}>
            <SelectTrigger className="h-8 w-[150px] text-sm" aria-label="Priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]} priority</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {actions.length > 0 && (
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5 self-start lg:self-auto" role="group" aria-label="Which actions to show">
            {([['for_you', 'For you'], ['all', 'All']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setScope(key)}
                aria-pressed={scope === key}
                title={key === 'for_you' && myMarket ? `Your actions and ${myMarket.label}` : undefined}
                className={cn('whitespace-nowrap rounded-md px-3 py-1 text-sm transition-colors', scope === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900')}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {actionsQuery.isError ? (
        <p className="text-sm text-red-600">Actions could not be loaded. Please refresh the page.</p>
      ) : actions.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white">
          <ActionsEmptyState size="page" />
        </div>
      ) : (
        <>
          {total === 0 && priority !== 'all' && (
            <p className="text-sm text-gray-500">
              No {PRIORITY_LABEL[priority].toLowerCase()} priority actions{scope === 'for_you' && myMarket ? ` for ${myMarket.label}` : ''} right now.{' '}
              <button type="button" className="underline" onClick={() => setPriority('all')}>Show all priorities</button>
            </p>
          )}
          {total === 0 && priority === 'all' && scope === 'for_you' && (
            <p className="text-sm text-gray-500">
              {myMarket ? `No actions for ${myMarket.label} right now.` : 'No actions right now.'}{' '}
              <button type="button" className="underline" onClick={() => setScope('all')}>Show all</button>
            </p>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            {BOARD_COLUMNS.map((col) => (
              <section key={col.status} className="rounded-xl bg-gray-100/70 p-3" aria-label={col.label}>
                <header className="flex items-center gap-2 px-1 pb-3">
                  {COLUMN_ICON[col.status]}
                  <h3 className="text-sm font-medium text-gray-700">{col.label}</h3>
                  <span className="rounded border border-gray-200 bg-white px-1.5 text-xs text-gray-600">{board.columns[col.status].length}</span>
                </header>
                <div className="space-y-3">
                  {board.columns[col.status].length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-300 py-8 text-center text-xs text-gray-400">No actions</div>
                  ) : board.columns[col.status].map((a) => (
                    <ActionCard
                      key={a.id}
                      action={a}
                      ownerLabel={nameOf(a.assignee_id)}
                      onOpen={() => setOpenId(a.id)}
                      onAccept={canAccept(a) ? () => setStatus.mutate({ action: a, status: 'in_progress' }) : undefined}
                      onDone={canChange(a) ? () => setDoneFor(a) : undefined}
                      onDismiss={canDismiss(a) ? () => setDismissFor(a) : undefined}
                      busy={setStatus.isPending && setStatus.variables?.action.id === a.id}
                      locked={lockedReason}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {board.watch.length > 0 && (
            <div>
              <button type="button" onClick={() => setWatchOpen((v) => !v)} className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                {watchOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <Eye className="h-4 w-4 text-gray-400" /> Watching ({board.watch.length})
              </button>
              {watchOpen && (
                <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
                  {board.watch.map((a) => (
                    <ActionCard key={a.id} action={a} ownerLabel={null} onOpen={() => setOpenId(a.id)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {board.dismissed.length > 0 && (
            <div>
              <button type="button" onClick={() => setDismissedOpen((v) => !v)} className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                {dismissedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <XCircle className="h-4 w-4 text-gray-400" /> Dismissed ({board.dismissed.length})
              </button>
              {dismissedOpen && (
                <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
                  {board.dismissed.map((a) => (
                    <ActionCard key={a.id} action={a} ownerLabel={null} onOpen={() => setOpenId(a.id)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Dialog open={!!openAction} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="h-[min(90vh,760px)] w-[calc(100vw-2rem)] max-w-5xl gap-0 overflow-hidden p-0">
          {openAction && (
            <ActionDetail
              action={openAction}
              checks={checksFor(openAction.id)}
              activity={activity}
              assigneeName={nameOf(openAction.assignee_id)}
              canChange={canChange(openAction)}
              canAccept={canAccept(openAction)}
              canAssignSelf={!openAction.assignee_id && !!meId}
              members={canReassign(openAction) && teammates.length ? teammates : null}
              nameOf={nameOf}
              meId={meId}
              onStatus={(status) => (status === 'done' ? setDoneFor(openAction) : setStatus.mutate({ action: openAction, status }))}
              onAssign={(assigneeId) => assign.mutate({ action: openAction, assigneeId })}
              onAssignSelf={() => user && assign.mutate({ action: openAction, assigneeId: user.id })}
              onComment={(body) => addComment.mutateAsync({ action: openAction, body })}
              onSeeInSources={seeInSources(openAction)}
              amplifyUrl={amplifyUrlFor(openAction)}
              onAccept={canAccept(openAction) && openAction.work_status === 'open' ? () => setStatus.mutate({ action: openAction, status: 'in_progress' }) : null}
              onDone={canChange(openAction) && openAction.work_status === 'in_progress' ? () => setDoneFor(openAction) : null}
              onDismiss={canDismiss(openAction) ? () => setDismissFor(openAction) : null}
              onRestore={canRestore(openAction) ? () => restore.mutate(openAction) : null}
              busy={setStatus.isPending || assign.isPending || dismiss.isPending || restore.isPending}
              commentBusy={addComment.isPending}
              locked={lockedReason}
            />
          )}
        </DialogContent>
      </Dialog>

      <DismissDialog
        action={dismissFor}
        onClose={() => setDismissFor(null)}
        onConfirm={(reason, note) => {
          if (dismissFor) dismiss.mutate({ action: dismissFor, reason, note });
          setDismissFor(null);
        }}
      />

      <DoneDialog
        action={doneFor}
        onClose={() => setDoneFor(null)}
        onConfirm={(note, url) => {
          if (doneFor) setStatus.mutate({ action: doneFor, status: 'done', note, url });
          setDoneFor(null);
        }}
      />
    </div>
  );
}

// "Global" or the one market an action is for (see actionScope).
function ScopeChip({ action, className }: { action: CompanyAction; className?: string }) {
  const scope = actionScope(action);
  const Icon = scope.kind === 'global' ? Globe : MapPin;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-500', className)}>
      <Icon className="h-3.5 w-3.5 text-gray-400" />{scope.kind === 'global' ? 'Global' : scope.market}
    </span>
  );
}

const WORK_KIND_STYLE: Record<string, { icon: LucideIcon; className: string }> = {
  outreach: { icon: Send, className: 'text-sky-700' },
  owned_content: { icon: FileText, className: 'text-indigo-700' },
  reviews: { icon: Star, className: 'text-amber-700' },
  conversations: { icon: MessagesSquare, className: 'text-orange-700' },
  profile_claims: { icon: BadgeCheck, className: 'text-emerald-700' },
  certifications: { icon: Award, className: 'text-violet-700' },
  social_pr: { icon: Megaphone, className: 'text-rose-700' },
  careers_site: { icon: Briefcase, className: 'text-indigo-700' },
  company_website: { icon: Globe, className: 'text-indigo-700' },
  linkedin: { icon: Linkedin, className: 'text-sky-800' },
  youtube: { icon: Youtube, className: 'text-red-700' },
  platform: { icon: FileText, className: 'text-indigo-700' },
};

// One type label per action; owned content names its channel (typeLabel).
export function KindLabel({ action, className }: { action: CompanyAction; className?: string }) {
  const type = typeLabel(action);
  if (!type) return <span />;
  const style = WORK_KIND_STYLE[type.key] ?? { icon: FileText, className: 'text-gray-600' };
  const Icon = style.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs', style.className, className)}>
      <Icon className="h-3.5 w-3.5" />{type.label}
    </span>
  );
}

// The whole card opens the detail panel; Accept and Mark done stop the click
// so they act without opening it.
function ActionCard({ action, ownerLabel, onOpen, onAccept, onDone, onDismiss, busy, locked }: {
  action: CompanyAction;
  ownerLabel: string | null;
  onOpen: () => void;
  onAccept?: () => void;
  onDone?: () => void;
  onDismiss?: () => void;
  busy?: boolean;
  locked?: string | null;
}) {
  const off = !!busy || !!locked;
  const cycle = cycleLabel(action.cycle_raised);
  const showAccept = action.register !== 'watch' && action.work_status === 'open' && onAccept;
  const showDone = action.register !== 'watch' && action.work_status === 'in_progress' && onDone;
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}
      className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-gray-300 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
    >
      <div className="flex items-center justify-between gap-2">
        <KindLabel action={action} />
        <PriorityChip action={action} />
      </div>
      <h4 className="mt-2.5 text-[15px] font-medium leading-snug text-gray-900">
        {displayTitle(action)}
      </h4>
      {action.recommendation && <p className="mt-1.5 line-clamp-2 text-sm text-gray-600">{action.recommendation}</p>}
      <div className="mt-2"><ScopeChip action={action} /></div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
          {cycle && <span className="shrink-0">{cycle}</span>}
          {ownerLabel && <><span aria-hidden>·</span><User className="h-3 w-3 shrink-0" /><span className="truncate">{ownerLabel}</span></>}
        </span>
        {action.work_status === 'dismissed' && (
          <span className="truncate text-xs text-gray-500">{dismissReasonLabel(action.dismiss_reason) ?? 'Dismissed'}</span>
        )}
        {showAccept && (
          <span className={cn('flex shrink-0 items-center gap-1.5', locked && 'cursor-not-allowed')} title={locked ?? undefined}>
            {onDismiss && (
              <Button size="sm" variant="ghost" className="h-7 rounded-md px-2 text-xs text-gray-500" onClick={stop(onDismiss)} disabled={off}>Dismiss</Button>
            )}
            <Button size="sm" className="h-7 rounded-md bg-blue-600 px-2.5 text-xs text-white hover:bg-blue-700" onClick={stop(onAccept!)} disabled={off}>
              <Check className="mr-1 h-3 w-3" />Accept
            </Button>
          </span>
        )}
        {showDone && (
          <span className={cn('shrink-0', locked && 'cursor-not-allowed')} title={locked ?? undefined}>
            <Button size="sm" variant="outline" className="h-7 rounded-md px-2.5 text-xs" onClick={stop(onDone!)} disabled={off}>
              <CheckCircle2 className="mr-1 h-3 w-3" />Mark done
            </Button>
          </span>
        )}
      </div>
    </article>
  );
}

const ORG_WIDE_MARKETS = new Set(['global', 'all markets', 'worldwide']);

interface ActionLink { url: string; label: string }

// Every page an action points at, once: the pages to act on first, then the
// sources AI reads. Labelled with the source name when the register has one.
function actionLinks(action: CompanyAction): ActionLink[] {
  const sourceFor = new Map((action.ai_reads || []).filter((r) => r.url).map((r) => [r.url as string, r.source || null]));
  const seen = new Set<string>();
  const out: ActionLink[] = [];
  for (const url of [...(action.urls || []), ...(action.ai_reads || []).map((r) => r.url).filter(Boolean) as string[]]) {
    if (seen.has(url)) continue;
    seen.add(url);
    let host = url;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
    out.push({ url, label: sourceFor.get(url) || host });
  }
  return out;
}

function domainOf(action: CompanyAction): string | null {
  if (action.source_domain) return action.source_domain;
  const first = actionLinks(action)[0];
  if (!first) return null;
  try { return new URL(first.url).hostname.replace(/^www\./, ''); } catch { return null; }
}

const initialsOf = (name: string | null | undefined) =>
  (name ?? '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

function Initials({ name, selected, size = 'sm' }: { name: string; selected?: boolean; size?: 'sm' | 'md' }) {
  return (
    <span className={cn(
      'flex shrink-0 items-center justify-center rounded-full bg-[#13274F]/10 font-medium text-[#13274F]',
      size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-[11px]',
      selected && 'ring-2 ring-blue-500 ring-offset-1',
    )}>
      {initialsOf(name)}
    </span>
  );
}

// Assignee field: the owner with their initials as plain text; when the
// viewer may change it the row is a quiet button that opens a searchable
// list of teammates (the chevron shows on hover only).
function AssigneePicker({ assigneeId, assigneeName, members, onAssign, disabled }: {
  assigneeId: string | null;
  assigneeName: string | null;
  members: Person[] | null;
  onAssign: (id: string | null) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = (
    <span className="flex min-w-0 items-center gap-2">
      {assigneeName
        ? <Initials name={assigneeName} />
        : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-gray-300"><User className="h-3 w-3 text-gray-400" /></span>}
      <span className={cn('truncate text-sm', assigneeName ? 'text-gray-900' : 'text-gray-500')}>{assigneeName ?? 'Unassigned'}</span>
    </span>
  );
  if (!members) return <div className="flex items-center py-0.5">{current}</div>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} className="group -mx-2 flex w-[calc(100%+1rem)] items-center rounded-md px-2 py-1 text-left hover:bg-gray-100 disabled:opacity-60 disabled:hover:bg-transparent">
          {current}
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-gray-300 group-hover:text-gray-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0">
        <Command>
          <CommandInput placeholder="Search members..." />
          <CommandList>
            <CommandEmpty>No one found.</CommandEmpty>
            <CommandGroup>
              {members.map((m) => (
                <CommandItem key={m.id} value={`${m.name} ${m.id}`} onSelect={() => { setOpen(false); if (m.id !== assigneeId) onAssign(m.id); }} className="gap-2">
                  <Initials name={m.name} selected={m.id === assigneeId} />
                  <span className="truncate">{m.name}</span>
                </CommandItem>
              ))}
              {assigneeId && (
                <CommandItem value="unassign" onSelect={() => { setOpen(false); onAssign(null); }} className="gap-2 text-gray-500">
                  <User className="h-4 w-4" />Unassign
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-sm text-gray-900">{children}</div>
    </div>
  );
}

const Chip = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn('inline-flex items-center whitespace-nowrap rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700', className)}>{children}</span>
);

const STATUS_CHIP: Record<string, string> = {
  open: 'bg-gray-50', in_progress: 'border-amber-200 bg-amber-50 text-amber-800', done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  dismissed: 'bg-gray-50 text-gray-500', stalled: 'border-rose-200 bg-rose-50 text-rose-800', escalated: 'border-rose-200 bg-rose-50 text-rose-800', retired: 'bg-gray-50 text-gray-500',
};
const WORK_STATUS_LABEL: Record<WorkStatus, string> = { open: 'Suggested', in_progress: 'In progress', done: 'Done', dismissed: 'Dismissed' };
const STATUS_PILL: Record<WorkStatus, string> = {
  open: 'border-gray-200 bg-gray-100 text-gray-700',
  in_progress: 'border-amber-200 bg-amber-50 text-amber-800',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  dismissed: 'border-gray-200 bg-gray-50 text-gray-500',
};

// The status as a coloured pill; a select in the same pill when the viewer
// may change it.
function StatusPill({ status, editable, onChange, disabled }: { status: WorkStatus; editable: boolean; onChange: (s: WorkStatus) => void; disabled: boolean }) {
  const pill = cn('inline-flex h-auto w-auto items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium', STATUS_PILL[status]);
  if (!editable) return <span className={pill}>{WORK_STATUS_LABEL[status]}</span>;
  return (
    <Select value={status} onValueChange={(v) => onChange(v as WorkStatus)} disabled={disabled}>
      <SelectTrigger className={cn(pill, 'focus:ring-0 focus:ring-offset-0 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-60')}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="open">Suggested</SelectItem>
        <SelectItem value="in_progress">In progress</SelectItem>
        <SelectItem value="done">Done</SelectItem>
      </SelectContent>
    </Select>
  );
}

// One line of the activity feed: a comment, a change event, a PerceptionX
// check-in or the day the action was added.
interface FeedItem { id: string; at: string; icon: JSX.Element; text: React.ReactNode; detail?: React.ReactNode; comment?: { name: string; body: string } }

function feedIcon(Icon: LucideIcon, className: string) {
  return <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', className)}><Icon className="h-3.5 w-3.5" /></span>;
}

const Who = ({ children }: { children: React.ReactNode }) => <span className="font-medium text-gray-900">{children}</span>;

function buildFeed(action: CompanyAction, activity: ActionActivity[], checks: ActionCheck[], nameOf: (id: string | null) => string | null, meId: string | null): FeedItem[] {
  const items: FeedItem[] = [];
  const who = (id: string | null | undefined) => nameOf(id ?? null) ?? 'Someone';
  const target = (actor: string | null, to: string | null) => (to && to === actor ? (actor === meId ? 'yourself' : 'themselves') : who(to));

  const added = action.published_at ?? action.created_at;
  if (added) {
    items.push({
      id: 'added', at: added, icon: feedIcon(Lightbulb, 'bg-[#13274F]/10 text-[#13274F]'),
      text: <><Who>PerceptionX</Who> added this{cycleLabel(action.cycle_raised) ? ` in ${cycleLabel(action.cycle_raised)}` : ''}</>,
    });
  }

  for (const r of activity) {
    const d = (r.data || {}) as Record<string, string | null | undefined>;
    const name = who(r.actor_id);
    if (r.kind === 'comment') {
      items.push({ id: r.id, at: r.created_at, icon: <Initials name={name} size="md" />, text: <><Who>{name}</Who> commented</>, comment: { name, body: r.body ?? '' } });
    } else if (r.kind === 'assigned') {
      items.push({
        id: r.id, at: r.created_at, icon: feedIcon(UserPlus, 'bg-violet-100 text-violet-700'),
        text: d.to ? <><Who>{name}</Who> assigned this to <Who>{target(r.actor_id, d.to)}</Who></> : <><Who>{name}</Who> unassigned <Who>{who(d.from)}</Who></>,
      });
    } else if (r.kind === 'status') {
      const done = d.to === 'done';
      items.push({
        id: r.id, at: r.created_at,
        icon: done ? feedIcon(CheckCircle2, 'bg-emerald-100 text-emerald-700') : feedIcon(ArrowRightLeft, 'bg-sky-100 text-sky-700'),
        text: done
          ? <><Who>{name}</Who> marked this done</>
          : <><Who>{name}</Who> moved this from <Who>{WORK_STATUS_LABEL[d.from as WorkStatus] ?? d.from}</Who> to <Who>{WORK_STATUS_LABEL[d.to as WorkStatus] ?? d.to}</Who></>,
        detail: (d.note || d.url) ? (
          <p className="text-sm text-gray-600">
            {d.note}{d.note && d.url ? ' ' : ''}
            {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">View the change</a>}
          </p>
        ) : undefined,
      });
    } else if (r.kind === 'dismissed') {
      items.push({
        id: r.id, at: r.created_at, icon: feedIcon(XCircle, 'bg-gray-100 text-gray-500'),
        text: <><Who>{name}</Who> dismissed this: {dismissReasonLabel(d.reason)?.toLowerCase() ?? 'no reason given'}</>,
        detail: d.note ? <p className="text-sm text-gray-600">{d.note}</p> : undefined,
      });
    } else if (r.kind === 'restored') {
      items.push({ id: r.id, at: r.created_at, icon: feedIcon(RotateCcw, 'bg-sky-100 text-sky-700'), text: <><Who>{name}</Who> restored this to <Who>Suggested</Who></> });
    }
  }

  // Changes made before the activity log existed are read off the action.
  const hasEvent = (kind: string, to?: string) => activity.some((r) => r.kind === kind && (!to || (r.data as Record<string, unknown>)?.to === to));
  if (action.asserted_done_at && !hasEvent('status', 'done')) {
    items.push({
      id: 'legacy-done', at: action.asserted_done_at, icon: feedIcon(CheckCircle2, 'bg-emerald-100 text-emerald-700'),
      text: <><Who>{who(action.assignee_id)}</Who> marked this done</>,
      detail: (action.assertion_note || action.assertion_url) ? (
        <p className="text-sm text-gray-600">
          {action.assertion_note}{action.assertion_note && action.assertion_url ? ' ' : ''}
          {action.assertion_url && <a href={action.assertion_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">View the change</a>}
        </p>
      ) : undefined,
    });
  }
  if (action.work_status === 'dismissed' && action.dismissed_at && !hasEvent('dismissed')) {
    items.push({
      id: 'legacy-dismissed', at: action.dismissed_at, icon: feedIcon(XCircle, 'bg-gray-100 text-gray-500'),
      text: <><Who>{who(action.dismissed_by)}</Who> dismissed this: {dismissReasonLabel(action.dismiss_reason)?.toLowerCase() ?? 'no reason given'}</>,
      detail: action.dismiss_note ? <p className="text-sm text-gray-600">{action.dismiss_note}</p> : undefined,
    });
  }

  for (const c of checks) {
    const views = (c.metric_readings || []).map(readingView).filter((r): r is ReadingView => !!r);
    items.push({
      id: c.id, at: c.checked_on, icon: <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#13274F]/10"><img src="/logos/perceptionx-small.png" alt="" className="h-3 w-auto" /></span>,
      text: <><Who>PerceptionX</Who> checked this in {cycleLabel(c.cycle)}: <Chip className={cn('ml-0.5 capitalize', STATUS_CHIP[c.status])}>{STATUS_LABEL[c.status] ?? c.status}</Chip></>,
      detail: (views.length > 0 || c.note) ? (
        <div className="space-y-1.5">
          {views.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {views.map((r, i) => (
                <Chip key={i}>
                  {r.label}{r.market ? ` · ${r.market}` : ''}: <span className="ml-1 font-medium">{r.value}%</span>
                  {r.provisional && <span className="ml-1 text-amber-600">provisional</span>}
                </Chip>
              ))}
            </div>
          )}
          {c.note && <p className="text-sm text-gray-600">{c.note}</p>}
        </div>
      ) : undefined,
    });
  }

  return items.sort((a, b) => a.at.localeCompare(b.at));
}

function CommentBox({ onSubmit, busy, locked }: { onSubmit: (body: string) => Promise<unknown>; busy: boolean; locked: string | null }) {
  const [body, setBody] = useState('');
  const trimmed = body.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= COMMENT_MAX && !busy && !locked;
  const send = async () => {
    if (!canSend) return;
    await onSubmit(trimmed);
    setBody('');
  };
  return (
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }}
        placeholder={locked ? locked : 'Leave a comment...'}
        disabled={!!locked || busy}
        rows={3}
        maxLength={COMMENT_MAX}
        className="resize-none rounded-xl border-gray-200 bg-white px-4 py-3 text-sm placeholder:text-gray-400 focus-visible:ring-1 focus-visible:ring-blue-500"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{body.length.toLocaleString()} / {COMMENT_MAX.toLocaleString()}</span>
        <Button size="sm" className="h-8 rounded-md bg-blue-600 px-4 text-white hover:bg-blue-700 disabled:bg-blue-300 disabled:opacity-100" onClick={() => void send()} disabled={!canSend}>Comment</Button>
      </div>
    </div>
  );
}

function ActionDetail({ action, checks, activity, assigneeName, canChange, canAccept, canAssignSelf, members, nameOf, meId, onStatus, onAssign, onAssignSelf, onComment, onSeeInSources, amplifyUrl, onAccept, onDone, onDismiss, onRestore, busy, commentBusy, locked }: {
  action: CompanyAction;
  checks: ActionCheck[];
  activity: ActionActivity[];
  assigneeName: string | null;
  canChange: boolean;
  canAccept: boolean;
  canAssignSelf: boolean;
  members: Person[] | null;
  nameOf: (id: string | null) => string | null;
  meId: string | null;
  onStatus: (s: WorkStatus) => void;
  onAssign: (id: string | null) => void;
  onAssignSelf: () => void;
  onComment: (body: string) => Promise<unknown>;
  onSeeInSources: ((domain: string) => void) | null;
  amplifyUrl: string | null;
  onAccept: (() => void) | null;
  onDone: (() => void) | null;
  onDismiss: (() => void) | null;
  onRestore: (() => void) | null;
  busy: boolean;
  commentBusy: boolean;
  locked: string | null;
}) {
  // In preview every control shows but none can act.
  const off = busy || !!locked;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isWatchItem = action.register === 'watch';
  const isDismissedItem = action.work_status === 'dismissed';
  const notes = noteParts(action.notes);
  const links = actionLinks(action);
  const domain = domainOf(action);
  const reads = action.ai_reads || [];
  const markets = action.markets || [];
  const linkVerb = action.work_kind === 'profile_claims' ? 'Go to profile' : 'View page';
  const pages = action.urls || [];
  const lifts = (action.lifts || []).filter((l) => l.metric || l.attribute);
  const latestReadings = (checks[0]?.metric_readings || []).map(readingView).filter((r): r is ReadingView => !!r);
  const hasDetails = reads.length > 0 || pages.length > 0 || lifts.length > 0 || latestReadings.length > 0 || notes.length > 0;
  const feed = buildFeed(action, activity, checks, nameOf, meId);
  const [primaryLink, ...moreLinks] = links;
  const canEditStatus = !isDismissedItem && (canChange || (canAccept && action.work_status === 'open'));

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-y-auto md:grid-cols-[1fr_300px] md:overflow-hidden">
      {/* Main column: the recommendation, details, then the conversation. */}
      <div className="space-y-6 p-6 md:min-h-0 md:overflow-y-auto md:p-8">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="pr-8 text-xl font-medium leading-snug">{displayTitle(action)}</DialogTitle>
          <DialogDescription className="sr-only">Action details</DialogDescription>
        </DialogHeader>

        {(action.recommendation || action.problem || action.ai_says) && (
          <section className="rounded-xl bg-gray-50 p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <img src="/logos/perceptionx-small.png" alt="" className="h-4 w-auto object-contain" />PerceptionX recommendation
            </h3>
            <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-gray-900">
              {action.recommendation && <p>{action.recommendation}</p>}
              {action.problem && <p>{action.problem}</p>}
              {action.ai_says && <p><span className="text-gray-500">What AI tells candidates:</span> {action.ai_says}</p>}
            </div>
          </section>
        )}

        {hasDetails && (
          <section className="rounded-xl border border-gray-200">
            <button type="button" onClick={() => setDetailsOpen((v) => !v)} className="flex w-full items-center gap-2.5 px-4 py-3.5 text-sm font-medium text-gray-900">
              <ListChecks className="h-4 w-4 text-gray-400" />Details
              <ChevronRight className={cn('ml-auto h-4 w-4 text-gray-400 transition-transform', detailsOpen && 'rotate-90')} />
            </button>
            {detailsOpen && (
              <div className="space-y-5 border-t border-gray-100 px-4 pb-5 pt-4">
                {reads.length > 0 && (
                  <DetailGroup title="Where AI reads it">
                    {reads.map((r, i) => {
                      const host = hostOf(r.url);
                      const Wrapper = r.url ? 'a' : 'div';
                      return (
                        <Wrapper
                          key={i}
                          {...(r.url ? { href: r.url, target: '_blank', rel: 'noreferrer' } : {})}
                          className={cn('flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5', r.url && 'hover:border-gray-300')}
                        >
                          {host ? <Favicon domain={host} size="sm" /> : <Globe className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-gray-900">{r.source}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                              {host && <span>{host}</span>}
                              {r.market && <Chip>{r.market}</Chip>}
                              {r.basis && <Chip className="border-violet-200 bg-violet-50 text-violet-800">{r.basis}</Chip>}
                              {r.coverage_pct != null && <Chip className="border-sky-200 bg-sky-50 text-sky-800">{r.coverage_pct}% of answers</Chip>}
                            </div>
                          </div>
                          {r.url && <ArrowUpRight className="h-4 w-4 shrink-0 text-gray-400" />}
                        </Wrapper>
                      );
                    })}
                  </DetailGroup>
                )}

                {pages.length > 0 && (
                  <DetailGroup title="Pages to change">
                    {pages.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2.5 hover:bg-gray-100">
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{u.replace(/^https?:\/\/(www\.)?/, '')}</span>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-gray-400" />
                      </a>
                    ))}
                  </DetailGroup>
                )}

                {lifts.length > 0 && (
                  <DetailGroup title="What it should move">
                    <div className="flex flex-wrap gap-1.5">
                      {lifts.map((l, i) => (
                        <Chip key={i}>{[l.metric, l.attribute, l.market].filter(Boolean).join(' · ')}</Chip>
                      ))}
                    </div>
                  </DetailGroup>
                )}

                {latestReadings.length > 0 && (
                  <DetailGroup title={`Latest readings${checks[0] ? `, ${cycleLabel(checks[0].cycle)}` : ''}`}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {latestReadings.map((r, i) => (
                        <div key={i} className="rounded-lg border border-gray-200 bg-white px-3 py-3 text-center">
                          <div className="text-xl font-medium text-gray-900">{r.value}%</div>
                          <div className="mt-1 text-[11px] uppercase tracking-wider text-gray-500">{r.label}</div>
                          <div className="text-xs text-gray-500">
                            {[r.market, r.ofAnswers ? 'of answers' : null].filter(Boolean).join(' · ')}
                            {r.provisional && <span className="ml-1 text-amber-600">provisional</span>}
                          </div>
                          {trendText(r) && <div className="mt-1 text-[11px] text-gray-400">{trendText(r)}</div>}
                        </div>
                      ))}
                    </div>
                  </DetailGroup>
                )}

                {notes.length > 0 && (
                  <DetailGroup title="Success and worth">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-gray-800">
                      {notes.map((p, i) => (p.kind === 'text' ? <span key={i}>{p.text}</span> : (
                        <a key={i} href={p.url} target="_blank" rel="noreferrer" className="underline">{p.label}</a>
                      )))}
                    </p>
                  </DetailGroup>
                )}
              </div>
            )}
          </section>
        )}

        <section className="space-y-1 border-t border-gray-200 pt-5">
          <h3 className="text-sm font-medium text-gray-900">Activity</h3>
          <ol className="divide-y divide-gray-100">
            {feed.map((item) => (
              <li key={item.id} className="flex gap-3 py-3.5">
                {item.icon}
                <div className="min-w-0 flex-1 space-y-1.5 pt-1">
                  <div className="text-sm text-gray-600">
                    {item.text}
                    <span className="ml-2 whitespace-nowrap text-xs text-gray-400">{timeAgo(item.at)}</span>
                  </div>
                  {item.comment && <p className="whitespace-pre-line text-sm leading-relaxed text-gray-800">{item.comment.body}</p>}
                  {item.detail}
                </div>
              </li>
            ))}
          </ol>
          <div className="pt-3">
            <CommentBox onSubmit={onComment} busy={commentBusy} locked={locked} />
          </div>
        </section>
      </div>

      {/* Side column: plain fields scroll, the buttons stay pinned at the bottom. */}
      <aside className="flex min-h-0 flex-col border-t border-gray-200 bg-white md:border-l md:border-t-0">
        <div className="space-y-6 p-6 md:min-h-0 md:flex-1 md:overflow-y-auto">
          {!isWatchItem && (
            <Field label="Assignee">
              <AssigneePicker
                assigneeId={action.assignee_id}
                assigneeName={assigneeName}
                members={members}
                onAssign={onAssign}
                disabled={off}
              />
              {canAssignSelf && !members && !isDismissedItem && (
                <button type="button" onClick={onAssignSelf} disabled={off} className="mt-1 text-xs text-blue-600 hover:underline">Assign to me</button>
              )}
            </Field>
          )}

          {priorityOf(action) && (
            <Field label="Priority">
              <PriorityChip action={action} />
              {action.priority_reason && (
                <p className="mt-1.5 text-xs leading-relaxed text-gray-500"><span className="text-gray-400">Why this priority:</span> {action.priority_reason}</p>
              )}
            </Field>
          )}

          {action.work_kind && <Field label="Type"><KindLabel action={action} className="text-sm" /></Field>}

          {!isWatchItem && (
            <Field label="Status">
              <StatusPill status={action.work_status} editable={canEditStatus} onChange={onStatus} disabled={off} />
              {isDismissedItem && action.dismiss_reason && (
                <div className="mt-1.5 text-xs text-gray-500">{dismissReasonLabel(action.dismiss_reason)}</div>
              )}
            </Field>
          )}

          <Field label="Scope">
            <ScopeChip action={action} className="text-sm text-gray-900" />
            {actionScope(action).kind === 'global' && markets.length > 1 && (
              <div className="mt-1 text-xs text-gray-500">{markets.join(', ')}</div>
            )}
          </Field>

          {(action.lanes || []).length > 0 && (
            <Field label="Lanes">{(action.lanes || []).map((l) => LANE_LABEL[l] ?? l).join(', ')}</Field>
          )}

          {cycleLabel(action.cycle_raised) && <Field label="Added">{cycleLabel(action.cycle_raised)}</Field>}
        </div>

        {(onAccept || onDone || onRestore || onDismiss || primaryLink || amplifyUrl || (domain && onSeeInSources)) && (
          <div className="shrink-0 space-y-2 border-t border-gray-100 p-6 pt-5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Actions</div>
            {locked && (
              <p className="flex items-center gap-1.5 pb-1 text-xs text-gray-500"><Lock className="h-3 w-3 shrink-0" />{locked}</p>
            )}
            {onAccept && (
              <Button className="h-9 w-full rounded-md bg-blue-600 text-white hover:bg-blue-700" onClick={onAccept} disabled={off}>
                <Check className="mr-1.5 h-4 w-4" />Accept
              </Button>
            )}
            {onDone && (
              <Button className="h-9 w-full rounded-md bg-emerald-600 text-white hover:bg-emerald-700" onClick={onDone} disabled={off}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />Mark done
              </Button>
            )}
            {onRestore && (
              <Button variant="outline" className="h-9 w-full rounded-md" onClick={onRestore} disabled={off}>
                <RotateCcw className="mr-1.5 h-4 w-4" />Restore to suggested
              </Button>
            )}
            {primaryLink && (
              <Button asChild className="h-9 w-full rounded-md bg-blue-600 text-white hover:bg-blue-700">
                <a href={primaryLink.url} target="_blank" rel="noreferrer">
                  <span className="truncate">{linkVerb}</span><ArrowRight className="ml-1.5 h-4 w-4 shrink-0" />
                </a>
              </Button>
            )}
            {amplifyUrl && (
              <Button asChild className="h-9 w-full rounded-md bg-[#DB5E89]/10 text-[#13274F] hover:bg-[#DB5E89]/20">
                <a href={amplifyUrl} target="_blank" rel="noreferrer">
                  <Megaphone className="mr-1.5 h-4 w-4 shrink-0 text-[#DB5E89]" /><span className="truncate">Share with employees</span>
                </a>
              </Button>
            )}
            {(moreLinks.length > 0 || (domain && onSeeInSources)) && (
              <ul className="pt-1">
                {moreLinks.slice(0, 2).map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noreferrer" className="flex items-center justify-between py-1.5 text-sm text-gray-600 hover:text-gray-900">
                      <span className="truncate">{l.label}</span><ArrowUpRight className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-400" />
                    </a>
                  </li>
                ))}
                {domain && onSeeInSources && (
                  <li>
                    <button type="button" onClick={() => onSeeInSources(domain)} className="flex w-full items-center justify-between py-1.5 text-left text-sm text-gray-600 hover:text-gray-900">
                      <span className="truncate">See {domain} in Sources</span><ArrowRight className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-400" />
                    </button>
                  </li>
                )}
              </ul>
            )}
            {onDismiss && (
              <button type="button" onClick={onDismiss} disabled={off} className="w-full pt-2 text-center text-sm text-gray-400 hover:text-gray-700 disabled:opacity-60">Dismiss this action</button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function DismissDialog({ action, onClose, onConfirm }: {
  action: CompanyAction | null;
  onClose: () => void;
  onConfirm: (reason: string, note: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const reset = () => { setReason(''); setNote(''); };
  return (
    <Dialog open={!!action} onOpenChange={(o) => { if (!o) { onClose(); reset(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dismiss this action</DialogTitle>
          <DialogDescription>Tell us why, so we can make the next recommendations more useful.</DialogDescription>
        </DialogHeader>
        <RadioGroup value={reason} onValueChange={setReason} className="space-y-1">
          {DISMISS_REASONS.map((r) => (
            <Label key={r.value} htmlFor={`dismiss-${r.value}`} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 font-normal hover:bg-gray-50">
              <RadioGroupItem id={`dismiss-${r.value}`} value={r.value} />{r.label}
            </Label>
          ))}
        </RadioGroup>
        <div className="space-y-1.5">
          <Label htmlFor="dismiss-note">Anything to add? (optional)</Label>
          <Textarea id="dismiss-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); reset(); }}>Cancel</Button>
          <Button disabled={!reason} onClick={() => { onConfirm(reason, note); reset(); }}>Dismiss</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DoneDialog({ action, onClose, onConfirm }: {
  action: CompanyAction | null;
  onClose: () => void;
  onConfirm: (note: string, url: string) => void;
}) {
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  return (
    <Dialog open={!!action} onOpenChange={(o) => { if (!o) { onClose(); setNote(''); setUrl(''); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as done</DialogTitle>
          <DialogDescription>Tell PerceptionX what changed. We check it in the next collection.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="done-note">What did you change?</Label>
            <Textarea id="done-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="done-url">Link to the published change (optional)</Label>
            <Input id="done-url" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setNote(''); setUrl(''); }}>Cancel</Button>
          <Button onClick={() => { onConfirm(note, url); setNote(''); setUrl(''); }}>Mark done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
