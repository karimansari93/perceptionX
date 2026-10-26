// Actions tab: the organisation's action register (company_actions) as a
// three-column board. Columns follow the owner's own status: Suggested (open),
// In progress, Done. "Accept" claims an unowned action and moves it to In
// progress; the owner marks it done with a note and the URL of the change.
// Writes go through the SECURITY DEFINER RPCs only (assign_company_action,
// set_company_action_status), which also enforce who may change what.
//
// Visibility: everyone in the organisation sees every published action (RLS
// returns published rows of the viewer's organisation only). The default
// "For you" view narrows to the header's market, which lands on the user's
// saved location, plus anything they own; "All markets" widens it.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Award, BadgeCheck, Check, ChevronDown, ChevronRight, Lightbulb, ListChecks, CircleDashed, CircleDot, CheckCircle2, ExternalLink, Eye, FileText, Megaphone, MessagesSquare, Send, Star, User, type LucideIcon } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { GENERAL_KEY, canonicalizeLocationContext, type LocationEntry } from '@/utils/locationContext';
import {
  BOARD_COLUMNS, LANE_LABEL, STATUS_LABEL, TIMING_LABEL, WORK_KIND_LABEL, buildBoard, cycleLabel, noteParts,
  sourcesTarget, type ActionCheck, type CompanyAction, type WorkStatus,
} from '@/lib/actions';

const db = supabase as any;


interface Person { id: string; name: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateInWords(iso: string | null | undefined): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

const COLUMN_ICON: Record<WorkStatus, JSX.Element> = {
  open: <CircleDashed className="h-4 w-4 text-gray-400" />,
  in_progress: <CircleDot className="h-4 w-4 text-amber-500" />,
  done: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
};

const TIMING_CLASS: Record<string, string> = {
  act_now: 'bg-rose-50 text-rose-700 border-rose-200',
  act_next: 'bg-amber-50 text-amber-700 border-amber-200',
  act_later: 'bg-slate-50 text-slate-600 border-slate-200',
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
  const { orgId, query: actionsQuery, actions, includeDrafts, setIncludeDrafts, canIncludeDrafts } = useCompanyActions();
  // Previewing as a member: their id decides "For you" and "You", and the
  // board is read only so nothing is written under their name.
  const meId = viewAsMember?.userId ?? user?.id ?? null;
  const readOnly = !!viewAsMember;
  const queryClient = useQueryClient();

  const [scope, setScope] = useState<'for_you' | 'all'>('for_you');
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

  const orgNameQuery = useQuery({
    queryKey: ['organization-name', orgId],
    enabled: !!orgId,
    staleTime: Infinity,
    queryFn: async (): Promise<string | null> => {
      const { data } = await db.from('organizations').select('name').eq('id', orgId).maybeSingle();
      return data?.name ?? null;
    },
  });

  const snapshotQuery = useQuery({
    queryKey: ['client-report-snapshot-latest', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<{ period_label: string; as_of: string | null } | null> => {
      const { data, error } = await db.from('client_report_snapshots')
        .select('period_label, as_of, cycle').eq('organization_id', orgId).not('published_at', 'is', null)
        .order('cycle', { ascending: false }).limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  // Org owners and admins pick an owner from the organisation's members.
  const membersQuery = useQuery({
    queryKey: ['org-members-for-actions', orgId],
    enabled: !!orgId && isOwnerOrAdmin,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await db.from('organization_members').select('user_id').eq('organization_id', orgId);
      if (error) throw error;
      return (data || []).map((m: { user_id: string }) => m.user_id);
    },
  });

  const peopleIds = useMemo(() => {
    const ids = new Set<string>();
    actions.forEach((a) => a.assignee_id && ids.add(a.assignee_id));
    (membersQuery.data || []).forEach((id) => ids.add(id));
    return Array.from(ids).sort();
  }, [actions, membersQuery.data]);

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
    return peopleQuery.data?.find((p) => p.id === id)?.name ?? 'Team member';
  };

  // The header's market (it opens on the user's saved location), as every
  // spelling the register might use.
  const myMarket = useMemo(() => {
    if (!selectedLocation || selectedLocation === GENERAL_KEY) return null;
    const opt = locationOptions?.find((o) => o.canonicalKey === selectedLocation);
    return opt ? { label: opt.label, spellings: [opt.label, ...opt.rawValues] } : null;
  }, [selectedLocation, locationOptions]);

  const board = useMemo(() => buildBoard(actions, {
    markets: scope === 'for_you' && myMarket ? myMarket.spellings : [],
    includeUserId: scope === 'for_you' ? meId : null,
  }), [actions, scope, myMarket, meId]);

  const checksFor = (id: string) => (checksQuery.data || [])
    .filter((c) => c.action_id === id)
    .sort((a, b) => String(b.cycle).localeCompare(String(a.cycle)));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['company-actions', orgId] });
  const fail = (e: unknown) => toast.error((e as { message?: string })?.message || 'Something went wrong. Please try again.');

  const canChange = (a: CompanyAction) => !readOnly && (isOwnerOrAdmin || (!!user && a.assignee_id === user.id));
  const canAccept = (a: CompanyAction) => !readOnly && (!a.assignee_id || canChange(a));

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
    onSuccess: () => { toast.success('Owner updated.'); refresh(); },
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
  const snapshot = snapshotQuery.data;
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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Actions</h2>
          <p className="text-sm text-gray-500 mt-1">
            What to do next to change how AI describes you to candidates.
            {snapshot && <> From your {snapshot.period_label} report{snapshot.as_of ? `, as of ${dateInWords(snapshot.as_of)}` : ''}.</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
        {canIncludeDrafts && (
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <Switch checked={includeDrafts} onCheckedChange={setIncludeDrafts} />
            Include unpublished
          </label>
        )}
        {actions.length > 0 && (
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 self-start lg:self-auto" role="group" aria-label="Which actions to show">
            {([['for_you', myMarket ? `For you · ${myMarket.label}` : 'For you'], ['all', 'All markets']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setScope(key)}
                aria-pressed={scope === key}
                className={cn('whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors', scope === key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900')}
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
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          No actions have been published for your organisation yet. They appear here after your report is delivered.
        </div>
      ) : (
        <>
          {total === 0 && scope === 'for_you' && (
            <p className="text-sm text-gray-500">
              No actions for {myMarket?.label ?? 'you'} right now.{' '}
              <button type="button" className="underline" onClick={() => setScope('all')}>Show all markets</button>
            </p>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            {BOARD_COLUMNS.map((col) => (
              <section key={col.status} className="rounded-xl bg-gray-100/70 p-3" aria-label={col.label}>
                <header className="flex items-center gap-2 px-1 pb-3">
                  {COLUMN_ICON[col.status]}
                  <h3 className="text-sm font-semibold text-gray-900">{col.label}</h3>
                  <span className="rounded border border-gray-200 bg-white px-1.5 text-xs text-gray-600">{board.columns[col.status].length}</span>
                </header>
                <div className="space-y-3">
                  {board.columns[col.status].length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-300 py-8 text-center text-xs text-gray-400">No actions</div>
                  ) : board.columns[col.status].map((a) => (
                    <ActionCard
                      key={a.id}
                      action={a}
                      ownerLabel={nameOf(a.assignee_id) ?? a.owner_name}
                      onOpen={() => setOpenId(a.id)}
                      onAccept={canAccept(a) ? () => setStatus.mutate({ action: a, status: 'in_progress' }) : undefined}
                      onDone={canChange(a) ? () => setDoneFor(a) : undefined}
                      busy={setStatus.isPending && setStatus.variables?.action.id === a.id}
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
        </>
      )}

      <Dialog open={!!openAction} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-5xl gap-0 overflow-hidden p-0">
          {openAction && (
            <ActionDetail
              action={openAction}
              checks={checksFor(openAction.id)}
              assigneeName={nameOf(openAction.assignee_id)}
              canChange={canChange(openAction)}
              canAccept={canAccept(openAction)}
              canAssignSelf={!readOnly && !openAction.assignee_id && !!user}
              members={isOwnerOrAdmin && !readOnly ? (peopleQuery.data || []).filter((p) => (membersQuery.data || []).includes(p.id)) : null}
              onStatus={(status) => (status === 'done' ? setDoneFor(openAction) : setStatus.mutate({ action: openAction, status }))}
              onAssign={(assigneeId) => assign.mutate({ action: openAction, assigneeId })}
              onAssignSelf={() => user && assign.mutate({ action: openAction, assigneeId: user.id })}
              onSeeInSources={seeInSources(openAction)}
              busy={setStatus.isPending || assign.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

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

function TimingPill({ timing }: { timing: string | null }) {
  if (!timing || !TIMING_LABEL[timing]) return null;
  return <span className={cn('whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium', TIMING_CLASS[timing])}>{TIMING_LABEL[timing]}</span>;
}

function marketsText(markets: string[] | null, max = 3) {
  const m = markets || [];
  if (!m.length) return 'All markets';
  return m.length > max ? `${m.slice(0, max).join(', ')} +${m.length - max}` : m.join(', ');
}

const WORK_KIND_STYLE: Record<string, { icon: LucideIcon; className: string }> = {
  outreach: { icon: Send, className: 'text-sky-700' },
  owned_content: { icon: FileText, className: 'text-indigo-700' },
  reviews: { icon: Star, className: 'text-amber-700' },
  conversations: { icon: MessagesSquare, className: 'text-orange-700' },
  profile_claims: { icon: BadgeCheck, className: 'text-emerald-700' },
  certifications: { icon: Award, className: 'text-violet-700' },
  social_pr: { icon: Megaphone, className: 'text-rose-700' },
};

function KindLabel({ kind }: { kind: string | null }) {
  if (!kind) return <span />;
  const style = WORK_KIND_STYLE[kind] ?? { icon: FileText, className: 'text-gray-600' };
  const Icon = style.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium', style.className)}>
      <Icon className="h-3.5 w-3.5" />{WORK_KIND_LABEL[kind] ?? kind}
    </span>
  );
}

// The whole card opens the detail panel; Accept and Mark done stop the click
// so they act without opening it.
function ActionCard({ action, ownerLabel, onOpen, onAccept, onDone, busy }: {
  action: CompanyAction;
  ownerLabel: string | null;
  onOpen: () => void;
  onAccept?: () => void;
  onDone?: () => void;
  busy?: boolean;
}) {
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
        <KindLabel kind={action.work_kind} />
        <span className="flex items-center gap-1.5">
          {action.published_at == null && (
            <span className="whitespace-nowrap rounded-md border border-dashed border-gray-300 px-1.5 py-0.5 text-xs text-gray-500">Unpublished</span>
          )}
          <TimingPill timing={action.timing} />
        </span>
      </div>
      <h4 className="mt-2.5 text-[15px] font-semibold leading-snug text-gray-900">
        {action.title}
      </h4>
      {action.recommendation && <p className="mt-1.5 line-clamp-2 text-sm text-gray-600">{action.recommendation}</p>}
      <p className="mt-2 text-xs text-gray-500">{marketsText(action.markets)}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
          {cycle && <span className="shrink-0">{cycle}</span>}
          {ownerLabel && <><span aria-hidden>·</span><User className="h-3 w-3 shrink-0" /><span className="truncate">{ownerLabel}</span></>}
        </span>
        {showAccept && (
          <Button size="sm" variant="outline" className="h-7 shrink-0 px-2.5 text-xs" onClick={stop(onAccept!)} disabled={busy}>
            <Check className="mr-1 h-3 w-3" />Accept
          </Button>
        )}
        {showDone && (
          <Button size="sm" variant="outline" className="h-7 shrink-0 px-2.5 text-xs" onClick={stop(onDone!)} disabled={busy}>
            <CheckCircle2 className="mr-1 h-3 w-3" />Mark done
          </Button>
        )}
      </div>
    </article>
  );
}

const UNASSIGNED = '__none__';
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-sm text-gray-900">{children}</div>
    </div>
  );
}

const Chip = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn('inline-flex items-center whitespace-nowrap rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700', className)}>{children}</span>
);

const STATUS_CHIP: Record<string, string> = {
  open: 'bg-gray-50', in_progress: 'border-amber-200 bg-amber-50 text-amber-800', done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  stalled: 'border-rose-200 bg-rose-50 text-rose-800', escalated: 'border-rose-200 bg-rose-50 text-rose-800', retired: 'bg-gray-50 text-gray-500',
};
const WORK_STATUS_LABEL: Record<WorkStatus, string> = { open: 'Suggested', in_progress: 'In progress', done: 'Done' };

function ActionDetail({ action, checks, assigneeName, canChange, canAccept, canAssignSelf, members, onStatus, onAssign, onAssignSelf, onSeeInSources, busy }: {
  action: CompanyAction;
  checks: ActionCheck[];
  assigneeName: string | null;
  canChange: boolean;
  canAccept: boolean;
  canAssignSelf: boolean;
  members: Person[] | null;
  onStatus: (s: WorkStatus) => void;
  onAssign: (id: string | null) => void;
  onAssignSelf: () => void;
  onSeeInSources: ((domain: string) => void) | null;
  busy: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isWatchItem = action.register === 'watch';
  const notes = noteParts(action.notes);
  const links = actionLinks(action);
  const domain = domainOf(action);
  const reads = action.ai_reads || [];
  const markets = action.markets || [];
  const hasDetails = !!(action.problem || action.ai_says || notes.length);
  const linkVerb = action.work_kind === 'profile_claims' ? 'Go to profile' : 'View page';

  return (
    <div className="grid max-h-[90vh] grid-cols-1 overflow-y-auto md:grid-cols-[1fr_300px] md:overflow-hidden">
      {/* Main column */}
      <div className="space-y-5 p-6 md:overflow-y-auto">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="pr-8 text-xl leading-snug">{action.title}</DialogTitle>
          <DialogDescription className="sr-only">Action details</DialogDescription>
        </DialogHeader>

        {action.recommendation && (
          <section className="rounded-xl bg-gray-50 p-4">
            <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700"><Lightbulb className="h-4 w-4 text-gray-400" />What to do</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-gray-900">{action.recommendation}</p>
          </section>
        )}

        {reads.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700">Where AI reads it</h3>
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
              {reads.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{r.source}</span>
                  {r.market && <Chip>{r.market}</Chip>}
                  {r.coverage_pct != null && <Chip className="border-sky-200 bg-sky-50 text-sky-800">{r.coverage_pct}% of answers</Chip>}
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer" aria-label={`Open ${r.source ?? 'source'}`} className="text-gray-400 hover:text-gray-900">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {hasDetails && (
          <section className="rounded-xl border border-gray-200">
            <button type="button" onClick={() => setDetailsOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-gray-900">
              <ListChecks className="h-4 w-4 text-gray-400" />Details
              <ChevronRight className={cn('ml-auto h-4 w-4 text-gray-400 transition-transform', detailsOpen && 'rotate-90')} />
            </button>
            {detailsOpen && (
              <div className="space-y-4 border-t border-gray-100 px-4 py-4 text-sm leading-relaxed text-gray-800">
                {action.problem && <div><div className="mb-1 text-xs font-semibold text-gray-500">Why</div>{action.problem}</div>}
                {action.ai_says && <div><div className="mb-1 text-xs font-semibold text-gray-500">What AI says</div>{action.ai_says}</div>}
                {notes.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-semibold text-gray-500">Success and worth</div>
                    <p className="whitespace-pre-line">
                      {notes.map((p, i) => (p.kind === 'text' ? <span key={i}>{p.text}</span> : (
                        <a key={i} href={p.url} target="_blank" rel="noreferrer" className="underline">{p.label}</a>
                      )))}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {(checks.length > 0 || action.asserted_done_at) && (
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700">Progress</h3>
            <ol className="space-y-3">
              {action.asserted_done_at && (
                <li className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div className="text-sm text-gray-800">
                    Marked done{dateInWords(action.asserted_done_at) ? ` on ${dateInWords(action.asserted_done_at)}` : ''}.
                    {action.assertion_note && <span className="text-gray-600"> {action.assertion_note}</span>}
                    {action.assertion_url && <> <a href={action.assertion_url} target="_blank" rel="noreferrer" className="underline">View the change</a></>}
                  </div>
                </li>
              )}
              {checks.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="font-medium text-gray-900">{cycleLabel(c.cycle)}</span>
                      <Chip className={cn('capitalize', STATUS_CHIP[c.status])}>{STATUS_LABEL[c.status] ?? c.status}</Chip>
                    </div>
                    {(c.metric_readings || []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {(c.metric_readings || []).map((r, i) => (
                          <Chip key={i}>
                            {r.metric}{r.attribute ? ` · ${r.attribute}` : ''}{r.market ? ` · ${r.market}` : ''}: <span className="ml-1 font-medium">{r.value_pct != null ? `${r.value_pct}%` : 'n/a'}</span>
                            {r.metric_status === 'provisional' && <span className="ml-1 text-amber-600">provisional</span>}
                          </Chip>
                        ))}
                      </div>
                    )}
                    {c.note && <p className="text-sm text-gray-600">{c.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      {/* Side column */}
      <aside className="space-y-5 border-t border-gray-200 bg-gray-50/70 p-6 md:overflow-y-auto md:border-l md:border-t-0">
        {!isWatchItem && (
          <Field label="Owner">
            {members ? (
              <Select value={action.assignee_id ?? UNASSIGNED} onValueChange={(v) => onAssign(v === UNASSIGNED ? null : v)} disabled={busy}>
                <SelectTrigger className="h-9 bg-white"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <div className="rounded-md bg-white px-3 py-2 text-gray-700 ring-1 ring-gray-200">{assigneeName ?? 'Unassigned'}</div>
            )}
            {canAssignSelf && !members && (
              <div className="mt-1 text-right">
                <button type="button" onClick={onAssignSelf} disabled={busy} className="text-sm text-blue-600 hover:underline">Assign to me</button>
              </div>
            )}
            {action.owner_name && <div className="mt-1 text-xs text-gray-500">Agreed in the report: {action.owner_name}</div>}
          </Field>
        )}

        {action.work_kind && <Field label="Type"><KindLabel kind={action.work_kind} /></Field>}
        {action.timing && <Field label="Timing"><TimingPill timing={action.timing} /></Field>}

        {!isWatchItem && (
          <Field label="Status">
            {canChange || (canAccept && action.work_status === 'open') ? (
              <Select value={action.work_status} onValueChange={(v) => onStatus(v as WorkStatus)} disabled={busy}>
                <SelectTrigger className="h-9 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Suggested</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Chip className={STATUS_CHIP[action.work_status]}>{WORK_STATUS_LABEL[action.work_status]}</Chip>
            )}
          </Field>
        )}

        <Field label="PerceptionX check">
          <Chip className={cn('capitalize', STATUS_CHIP[action.tracking_status])}>{STATUS_LABEL[action.tracking_status] ?? action.tracking_status}</Chip>
        </Field>

        <Field label="Markets">
          <div className="flex flex-wrap gap-1.5">
            {markets.length ? markets.map((m) => <Chip key={m}>{m}</Chip>) : <Chip>All markets</Chip>}
          </div>
        </Field>

        {(action.lanes || []).length > 0 && (
          <Field label="Lanes">
            <div className="flex flex-wrap gap-1.5">{(action.lanes || []).map((l) => <Chip key={l}>{LANE_LABEL[l] ?? l}</Chip>)}</div>
          </Field>
        )}

        {cycleLabel(action.cycle_raised) && <Field label="Raised">{cycleLabel(action.cycle_raised)} report</Field>}

        {(links.length > 0 || (domain && onSeeInSources)) && (
          <Field label="Go to">
            <div className="space-y-2">
              {links.slice(0, 3).map((l, i) => (
                <Button key={l.url} asChild variant={i === 0 ? 'default' : 'outline'} className="h-9 w-full justify-between">
                  <a href={l.url} target="_blank" rel="noreferrer">
                    <span className="truncate">{i === 0 ? linkVerb : l.label}</span>
                    <ExternalLink className="ml-2 h-3.5 w-3.5 shrink-0" />
                  </a>
                </Button>
              ))}
              {domain && onSeeInSources && (
                <Button variant="outline" className="h-9 w-full justify-between" onClick={() => onSeeInSources(domain)}>
                  <span className="truncate">See {domain} in Sources</span>
                  <ArrowRight className="ml-2 h-3.5 w-3.5 shrink-0" />
                </Button>
              )}
            </div>
          </Field>
        )}
      </aside>
    </div>
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
