import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Award,
  BadgeCheck,
  ExternalLink,
  FileText,
  LayoutGrid,
  MessagesSquare,
  Send,
  Share2,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { getFavicon } from '@/utils/citationUtils';
import { useAuth } from '@/contexts/AuthContext';
import {
  useCompanyActions,
  type ActionWorkKind,
  type ActionWorkStatus,
  type AiRead,
  type CompanyAction,
} from '@/hooks/useCompanyActions';

interface ActionsTabProps {
  organizationId?: string;
  companyName?: string;
  /** True when the viewer is an owner/admin of this org — can assign anyone. */
  isSuperAdmin?: boolean;
  /** Platform admin: also sees unpublished drafts, badged as such. */
  isPlatformAdmin?: boolean;
}

// Same ink constants the Themes tab uses, so headings match across tabs.
const INK = '#13274F';
const INK_MUTED = 'rgba(19,39,79,0.64)';

type FilterKey = 'all' | 'yours' | 'unassigned' | 'done';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All open' },
  { key: 'yours', label: 'Yours' },
  { key: 'unassigned', label: 'Needs an owner' },
  { key: 'done', label: 'Done' },
];

// Grouped by the kind of work an action takes — which is really a statement
// about who has to say yes before it can happen.
const KIND_ORDER: ActionWorkKind[] = [
  'reviews',
  'conversations',
  'outreach',
  'profile_claims',
  'certifications',
  'owned_content',
  'social_pr',
];

const KIND_META: Record<
  ActionWorkKind,
  { heading: string; tag: string; tagTone: 'teal' | 'dim'; blurb: (co: string) => string }
> = {
  reviews: {
    heading: 'Reviews',
    tag: 'Third-party',
    tagTone: 'dim',
    blurb: () =>
      'Employee-review platforms. The work is claiming the profile, responding, and keeping the company voice visible.',
  },
  conversations: {
    heading: 'Conversations',
    tag: 'Third-party',
    tagTone: 'dim',
    blurb: () =>
      'Threads the AI quotes. The work is a person from the team replying in the thread, in their own voice.',
  },
  outreach: {
    heading: 'Outreach',
    tag: 'Third-party',
    tagTone: 'dim',
    blurb: (co) =>
      `Getting ${co} into lists, roundups and articles the AI already reads. Someone outside the team has to say yes.`,
  },
  profile_claims: {
    heading: 'Profile claims',
    tag: 'One admin task',
    tagTone: 'dim',
    blurb: () => 'Unclaimed employer profiles. Claim once, then the profile can be maintained.',
  },
  certifications: {
    heading: 'Certifications & awards',
    tag: 'Entry window',
    tagTone: 'dim',
    blurb: () => 'Programmes with deadlines. The work starts months before the citation appears.',
  },
  owned_content: {
    heading: 'Owned content',
    tag: 'You control this',
    tagTone: 'teal',
    blurb: (co) => `Pages ${co} publishes itself. Nobody outside the team has to say yes first.`,
  },
  social_pr: {
    heading: 'Social & PR',
    tag: 'You control this',
    tagTone: 'teal',
    blurb: (co) =>
      `Channels ${co} posts to and stories it can place. The work is a post or a pitch, not a page.`,
  },
};

const KIND_ICON: Record<ActionWorkKind, LucideIcon> = {
  reviews: Star,                 // ratings platforms
  conversations: MessagesSquare, // threads
  outreach: Send,                // pitching someone else's surface
  profile_claims: BadgeCheck,    // claim once, then maintain
  certifications: Award,         // programmes and awards
  owned_content: FileText,       // pages you publish
  social_pr: Share2,             // channels you post to
};

const STATUS_LABEL: Record<ActionWorkStatus, string> = {
  open: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
};

// "Rajiv Bawa" -> "R. Bawa"; falls back to the email local part.
const shortName = (full: string): string => {
  const cleaned = full.trim();
  if (cleaned.includes('@')) return cleaned.split('@')[0];
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return cleaned;
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
};

// The logo beside each row. Prefer the domain the evidence actually points at,
// then the first linked source. Nulls fall through to a monogram tile.
const logoDomain = (action: CompanyAction): string | null => {
  const fromFilter = action.evidence_filter?.source_domain;
  if (typeof fromFilter === 'string' && fromFilter) return fromFilter.replace(/^www\./, '');
  const linked = action.ai_reads.find((r) => r.url)?.url;
  if (linked) {
    try {
      return new URL(linked).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }
  return null;
};


// --- AI reads badges ------------------------------------------------------
// Each cited source becomes a badge carrying the platform's mark. Chips are
// authored as label + optional url ("kununu/netflix-services-germany",
// "/kommentare"), so the domain comes from the chip's own url when it has one
// and otherwise from the action's source_domain — a bare "/kommentare" belongs
// to the same platform as the row.
const readDomain = (read: AiRead, fallback: string | null): string | null => {
  if (read.url) {
    try {
      return new URL(read.url).hostname.replace(/^www\./, '');
    } catch {
      /* fall through to the row's own domain */
    }
  }
  return fallback;
};

// With the logo present, repeating the platform in the text is noise:
// "kununu/netflix-services-germany" reads better as "/netflix-services-germany".
const readLabel = (label: string, domain: string | null): string => {
  if (!domain) return label;
  const root = domain.split('.')[0];
  const stripped = label
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(new RegExp(`^${domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '')
    .replace(new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/)`, 'i'), '');
  const cleaned = stripped.trim();
  // Nothing left (the label WAS the domain) — show the domain itself.
  return cleaned === '' || cleaned === '/' ? domain : cleaned;
};

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export const ActionsTab = ({
  organizationId,
  companyName,
  isSuperAdmin = false,
  isPlatformAdmin = false,
}: ActionsTabProps) => {
  const { user } = useAuth();
  const { actions, assignees, assigneeNames, loading, error, assign, setStatus, setSteps } =
    useCompanyActions(organizationId, isPlatformAdmin);

  // Retired actions are closed — they belong to the report's history, not to a
  // work list. Excluded here rather than per-filter so the counts, the sections
  // and the footer can't disagree about what's on the page.
  const active = useMemo(
    () => actions.filter((a) => a.register !== 'retired'),
    [actions],
  );

  const counts = useMemo(() => {
    const open = active.filter((a) => a.work_status !== 'done');
    return {
      all: open.length,
      yours: open.filter((a) => a.assignee_id === user?.id).length,
      unassigned: open.filter((a) => a.assignee_id === null).length,
      done: active.filter((a) => a.work_status === 'done').length,
    };
  }, [active, user?.id]);

  const draftCount = useMemo(
    () => active.filter((a) => a.published_at === null).length,
    [active],
  );

  // Opens on the full register, falling back only when the viewer has work of
  // their own. Derived rather than set by an effect — counts arrive across
  // several renders, so any one-shot guard fires against zeroed counts.
  const [picked, setPicked] = useState<FilterKey | null>(null);
  const filter: FilterKey = picked ?? (counts.yours > 0 ? 'yours' : 'all');

  const [kindFilter, setKindFilter] = useState<ActionWorkKind | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Domains whose logo 404s/401s (logo.dev answers 401 without a publishable
  // token). Falls back to the letter tile rather than an empty box.
  const [logoFailed, setLogoFailed] = useState<Set<string>>(new Set());
  const [doneTarget, setDoneTarget] = useState<CompanyAction | null>(null);
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const visible = useMemo(() => {
    const open = active.filter((a) => a.work_status !== 'done');
    switch (filter) {
      case 'yours':
        return open.filter((a) => a.assignee_id === user?.id);
      case 'unassigned':
        return open.filter((a) => a.assignee_id === null);
      case 'done':
        return active.filter((a) => a.work_status === 'done');
      default:
        return open;
    }
  }, [active, filter, user?.id]);

  // Counts for the TYPE row are taken from the status-filtered set, so they
  // describe what a click would actually reveal.
  const kindCounts = useMemo(() => {
    const counts = new Map<ActionWorkKind, number>();
    visible.forEach((a) => {
      const kind = a.work_kind ?? 'outreach';
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    });
    return counts;
  }, [visible]);

  const grouped = useMemo(() => {
    const groups = new Map<ActionWorkKind, CompanyAction[]>();
    visible
      .filter((a) => kindFilter === 'all' || (a.work_kind ?? 'outreach') === kindFilter)
      .forEach((action) => {
      // Un-categorised actions fall into Outreach rather than vanishing.
        const kind = action.work_kind ?? 'outreach';
        const list = groups.get(kind) ?? [];
        list.push(action);
        groups.set(kind, list);
      });
    return KIND_ORDER.filter((k) => groups.has(k)).map((k) => ({
      kind: k,
      items: groups.get(k) as CompanyAction[],
    }));
  }, [visible, kindFilter]);

  // The design numbers the most-overdue items 01, 02, ... across the whole
  // page, so the eye lands on them before the section headings.
  const priorityRank = useMemo(() => {
    const ranked = active
      .filter((a) => a.work_status !== 'done' && a.overdue_count > 1)
      .sort((a, b) => b.overdue_count - a.overdue_count)
      .slice(0, 4);
    return new Map(ranked.map((a, i) => [a.id, i + 1]));
  }, [active]);

  const toggleStep = async (action: CompanyAction, index: number) => {
    const done = new Set(action.steps_done);
    if (done.has(index)) done.delete(index);
    else done.add(index);
    try {
      await setSteps(action.id, Array.from(done).sort((a, b) => a - b));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update that step');
    }
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleAssign = async (action: CompanyAction, assigneeId: string | null) => {
    try {
      await assign(action.id, assigneeId);
      toast.success(assigneeId ? 'Owner updated' : 'Owner removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the owner');
    }
  };

  const handleStatus = async (action: CompanyAction, status: ActionWorkStatus) => {
    // "Done" is an assertion we want attributed and explained, so it goes
    // through the dialog rather than straight into the RPC.
    if (status === 'done') {
      setDoneTarget(action);
      setNote('');
      setUrl('');
      return;
    }
    try {
      await setStatus(action.id, status);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the status');
    }
  };

  const confirmDone = async () => {
    if (!doneTarget) return;
    setSaving(true);
    try {
      // Status first (it records the note/url), then tick every step so the
      // checklist agrees with the state. set_company_action_steps preserves an
      // existing assertion, so the note survives the second call.
      await setStatus(doneTarget.id, 'done', note, url);
      if (doneTarget.steps.length > 0) {
        await setSteps(doneTarget.id, doneTarget.steps.map((_, i) => i));
      }
      toast.success('Marked as done — we’ll verify it in the next report');
      setDoneTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark this as done');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full space-y-6">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-full max-w-md" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full">
        <p className="text-sm" style={{ color: INK_MUTED }}>
          Could not load actions: {error}
        </p>
      </div>
    );
  }

  const openCount = counts.all;
  const doneCount = counts.done;

  return (
    <div
      className="w-full"
      style={
        {
          color: INK,
          // Design-system tokens, scoped to this tab.
          '--px-ink-muted': 'rgba(19,39,79,0.64)',
          '--px-ink-dim': 'rgba(19,39,79,0.42)',
          '--px-rule': 'rgba(19,39,79,0.12)',
          '--px-rule-strong': 'rgba(19,39,79,0.22)',
          '--px-hairline': '#EEF2F7',
          '--px-card-fill': 'rgba(19,39,79,0.04)',
        } as React.CSSProperties
      }
    >
      <div>
        {/* ---------- Header — same shape as Themes / Competitors ---------- */}
        <div data-tour="actions-heading" className="space-y-2">
            <h2
              className="font-headline text-[28px] font-semibold tracking-[-0.02em]"
              style={{ color: INK }}
            >
              Actions
            </h2>
            <p className="text-sm max-w-[62ch]" style={{ color: INK_MUTED }}>
              Assign and track the recommendations from {companyName ?? 'this company'}'s employer
              brand reporting, grouped by the kind of work each one takes.
            </p>
        </div>

        {isPlatformAdmin && draftCount > 0 && (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <span className="font-medium">
              {draftCount} unpublished {draftCount === 1 ? 'draft' : 'drafts'}
            </span>{' '}
            — visible to you as a platform admin only. Nobody at {companyName ?? 'the client'} can
            see these, and no email can be sent for them, until they are published.
          </div>
        )}

        {/* ---------- Filters ---------- */}
        <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-[color:var(--px-rule)] pb-5">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setPicked(f.key)}
                className={`rounded-full px-[15px] py-[7px] text-[12.5px] font-semibold transition-colors ${
                  active
                    ? 'bg-nightsky text-white'
                    : 'border border-[color:var(--px-rule)] bg-white text-[color:var(--px-ink-muted)] hover:border-[color:var(--px-rule-strong)]'
                }`}
              >
                {f.label}{' '}
                <span
                  className={`font-medium tabular-nums ${active ? 'opacity-55' : 'text-[color:var(--px-ink-dim)]'}`}
                >
                  {counts[f.key]}
                </span>
              </button>
            );
          })}
        </div>

        {kindCounts.size > 0 && (
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-[color:var(--px-ink-dim)]">
              Type
            </span>
            {(['all', ...KIND_ORDER.filter((k) => kindCounts.has(k))] as const).map((k) => {
              const active = kindFilter === k;
              const label = k === 'all' ? 'All' : KIND_META[k as ActionWorkKind].heading;
              const n = k === 'all' ? visible.length : (kindCounts.get(k as ActionWorkKind) ?? 0);
              const Icon = k === 'all' ? LayoutGrid : KIND_ICON[k as ActionWorkKind];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k as ActionWorkKind | 'all')}
                  className={`inline-flex items-center gap-1.5 rounded-full px-[13px] py-1.5 text-[12.5px] font-semibold transition-colors ${
                    active
                      ? 'border border-[color:var(--px-rule-strong)] bg-[color:var(--px-card-fill)] text-nightsky'
                      : 'border border-[color:var(--px-rule)] bg-white text-[color:var(--px-ink-muted)] hover:border-[color:var(--px-rule-strong)]'
                  }`}
                >
                  <Icon className="h-[13px] w-[13px] flex-none" strokeWidth={2} />
                  {label}
                  <span className="font-medium tabular-nums text-[color:var(--px-ink-dim)]">{n}</span>
                </button>
              );
            })}
          </div>
        )}

        {visible.length === 0 && (
          <p className="mt-8 text-sm text-[color:var(--px-ink-muted)]">
            {filter === 'yours'
              ? 'Nothing is assigned to you right now.'
              : filter === 'unassigned'
                ? 'Every action has an owner.'
                : filter === 'done'
                  ? 'Nothing has been marked done yet.'
                  : 'No actions have been published for this company yet.'}
            {filter !== 'all' && openCount > 0 && (
              <button
                type="button"
                onClick={() => setPicked('all')}
                className="ml-2 font-semibold text-pink hover:underline"
              >
                View all {openCount} open
              </button>
            )}
          </p>
        )}

        {/* ---------- Sections ---------- */}
        {grouped.map(({ kind, items }, sectionIndex) => {
          const meta = KIND_META[kind];
          const KindIcon = KIND_ICON[kind];
          const tagClass =
            meta.tagTone === 'teal'
              ? 'text-teal border-teal/35'
              : 'text-[color:var(--px-ink-dim)] border-[color:var(--px-rule)]';

          return (
            <section key={kind} className={sectionIndex === 0 ? 'mt-7' : 'mt-11'}>
              <div className="border-b border-[color:var(--px-rule)] pb-3 pt-3.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span
                    className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[5px]"
                    style={{ background: 'rgba(19,39,79,0.04)', color: 'rgba(19,39,79,0.42)' }}
                  >
                    <KindIcon className="h-[13px] w-[13px]" strokeWidth={2} />
                  </span>
                  <h2 className="font-headline text-[17px] font-bold tracking-[-0.01em] m-0">
                    {meta.heading}
                  </h2>
                  <span className="font-headline text-[17px] font-bold tabular-nums text-[color:var(--px-ink-dim)]">
                    {items.length}
                  </span>
                  <span
                    className={`rounded border px-[7px] py-[3px] text-[9.5px] font-bold uppercase tracking-[0.11em] ${tagClass}`}
                  >
                    {meta.tag}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] leading-[1.5] text-[color:var(--px-ink-muted)]">
                  {meta.blurb(companyName ?? 'the company')}
                </p>
              </div>

              {items.map((action) => {
                const isOpen = expanded.has(action.id);
                const isOwner = action.assignee_id === user?.id;
                const canSetStatus = isOwner || isSuperAdmin;
                const ownerName = action.assignee_id ? assigneeNames.get(action.assignee_id) : null;
                const rank = priorityRank.get(action.id);
                const domain = action.source_domain ?? logoDomain(action);
                const totalSteps = action.steps.length;
                const doneSteps = action.steps_done.filter(
                  (i) => i >= 0 && i < totalSteps,
                ).length;
                const allDone = totalSteps > 0 && doneSteps === totalSteps;
                // The design derives the row's state from the checklist.
                const stateLabel =
                  action.work_status === 'done' || allDone
                    ? 'Done'
                    : doneSteps > 0
                      ? `${doneSteps} of ${totalSteps}`
                      : STATUS_LABEL[action.work_status];
                const stateIsProgress =
                  action.work_status === 'done' || allDone || doneSteps > 0 ||
                  action.work_status === 'in_progress';

                return (
                  <div key={action.id} className="border-b border-[color:var(--px-hairline)]">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggle(action.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggle(action.id);
                        }
                      }}
                      className="flex cursor-pointer items-center justify-between gap-[18px] py-5 pl-4 pr-2 transition-colors hover:bg-[color:var(--px-card-fill)]"
                      style={{
                        borderLeft: `3px solid ${isOpen || rank ? '#DB5E89' : 'transparent'}`,
                        opacity: allDone ? 0.5 : 1,
                      }}
                    >
                      <div className="flex min-w-0 items-start gap-3.5">
                        {domain && !logoFailed.has(domain) ? (
                          <img
                            src={getFavicon(domain, 72)}
                            alt=""
                            onError={() =>
                              setLogoFailed((prev) => new Set(prev).add(domain))
                            }
                            className="mt-0.5 h-[30px] w-[30px] flex-none rounded-[7px] border border-[color:var(--px-rule)] bg-white object-contain"
                          />
                        ) : (
                          <div className="mt-0.5 flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[7px] border border-[color:var(--px-rule)] bg-white font-headline text-[11px] font-bold text-[color:var(--px-ink-dim)]">
                            {action.title.trim().charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2.5">
                            {rank && (
                              <span className="font-headline text-[11px] font-bold text-pink tabular-nums">
                                {String(rank).padStart(2, '0')}
                              </span>
                            )}
                            <h3 className="m-0 text-base font-bold tracking-[-0.01em]">
                              {action.source_name ?? action.title}
                            </h3>
                            {(action.source_label ?? action.markets.join(' · ')) && (
                              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--px-ink-dim)]">
                                {action.source_label ?? action.markets.join(' · ')}
                              </span>
                            )}
                            {action.overdue_count > 1 && (
                              <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-pink">
                                Overdue ×{action.overdue_count}
                              </span>
                            )}
                            {action.published_at === null && (
                              <span className="rounded border border-amber-300 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-amber-700">
                                Draft
                              </span>
                            )}
                          </div>
                          {action.recommendation && (
                            <p className="mt-[7px] text-sm leading-[1.55] text-[color:var(--px-ink-muted)]">
                              {action.recommendation}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-none items-center gap-3.5 whitespace-nowrap">
                        {ownerName ? (
                          <span className="hidden text-[13px] text-[color:var(--px-ink-muted)] sm:inline">
                            {shortName(ownerName)}
                          </span>
                        ) : (
                          <span className="hidden text-[13px] font-semibold text-pink sm:inline">
                            + Assign
                          </span>
                        )}
                        <span
                          className={`hidden min-w-[76px] text-right text-[10px] font-bold uppercase tracking-[0.09em] sm:inline ${
                            stateIsProgress ? 'text-teal' : 'text-[color:var(--px-ink-dim)]'
                          }`}
                        >
                          {stateLabel}
                        </span>
                        <span
                          className="inline-block text-base text-[color:var(--px-ink-dim)] transition-transform duration-200"
                          style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}
                        >
                          ›
                        </span>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="pb-7 pl-[63px] pr-2">
                        {action.evidence && (
                          <p className="m-0 max-w-[76ch] text-sm leading-[1.6] text-[color:var(--px-ink-muted)]">
                            {action.evidence}
                          </p>
                        )}

                        {(totalSteps > 0 || canSetStatus) && (
                          <div
                            className="mt-4 flex flex-col gap-[9px]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {totalSteps > 0 && (
                              <span className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-[color:var(--px-ink-dim)]">
                                Steps
                              </span>
                            )}
                            {action.steps.map((step, i) => {
                              const checked = action.steps_done.includes(i);
                              return (
                                <div
                                  key={`${action.id}-step-${i}`}
                                  className="flex items-start gap-2.5"
                                >
                                  <button
                                    type="button"
                                    disabled={!canSetStatus}
                                    onClick={() => toggleStep(action, i)}
                                    className={`flex items-start gap-2.5 text-left ${
                                      canSetStatus ? 'cursor-pointer' : 'cursor-default'
                                    }`}
                                  >
                                    <span
                                      className="mt-px flex h-[15px] w-[15px] flex-none items-center justify-center rounded-[4px] text-[11px] leading-none transition-colors"
                                      style={{
                                        border: `1.5px solid ${checked ? '#0DBCBA' : 'rgba(19,39,79,0.22)'}`,
                                        background: checked ? '#0DBCBA' : 'transparent',
                                        color: checked ? '#fff' : 'transparent',
                                      }}
                                    >
                                      ✓
                                    </span>
                                    <span
                                      className="text-sm leading-[1.4]"
                                      style={{
                                        color: checked ? 'rgba(19,39,79,0.42)' : INK,
                                        textDecoration: checked ? 'line-through' : 'none',
                                      }}
                                    >
                                      {step.label}
                                    </span>
                                  </button>
                                  {step.url && (
                                    <a
                                      href={step.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      title={step.url}
                                      className="mt-0.5 flex-none text-[color:var(--px-ink-dim)] transition-colors hover:text-pink"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                </div>
                              );
                            })}
                            {canSetStatus && (
                              <div className="mt-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    allDone ? undefined : handleStatus(action, 'done')
                                  }
                                  disabled={allDone}
                                  className="inline-block rounded-full border px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] transition-colors"
                                  style={{
                                    color: allDone ? '#0DBCBA' : '#DB5E89',
                                    borderColor: allDone
                                      ? 'rgba(13,188,186,0.45)'
                                      : 'rgba(219,94,137,0.45)',
                                  }}
                                >
                                  {allDone ? 'Done ✓' : 'Mark done'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[color:var(--px-ink-dim)]">
                          {action.functions.length > 0 && <span>{action.functions.join(' · ')}</span>}
                          {action.moves.length > 0 && <span>Moves {action.moves.join(', ')}</span>}
                        </div>

                        {action.ai_reads.length > 0 && (
                          <div className="mt-4">
                            <span className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-[color:var(--px-ink-dim)]">
                              What AI reads
                            </span>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {action.ai_reads.map((read, i) => {
                                const rd = readDomain(read, domain);
                                const label = readLabel(read.label, rd);
                                const showLogo = rd && !logoFailed.has(rd);
                                const inner = (
                                  <>
                                    {showLogo ? (
                                      <img
                                        src={getFavicon(rd as string, 32)}
                                        alt=""
                                        onError={() =>
                                          setLogoFailed((prev) => new Set(prev).add(rd as string))
                                        }
                                        className="h-[14px] w-[14px] flex-none rounded-[3px] object-contain"
                                      />
                                    ) : (
                                      <span className="flex h-[14px] w-[14px] flex-none items-center justify-center rounded-[3px] bg-[color:var(--px-card-fill)] text-[8px] font-bold uppercase text-[color:var(--px-ink-dim)]">
                                        {(rd ?? label).charAt(0)}
                                      </span>
                                    )}
                                    <span className="font-mono text-xs leading-none">
                                      {label}
                                    </span>
                                    {read.url && (
                                      <ExternalLink className="h-2.5 w-2.5 flex-none opacity-60" />
                                    )}
                                  </>
                                );

                                return read.url ? (
                                  <a
                                    key={`${action.id}-read-${i}`}
                                    href={read.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1.5 rounded-[5px] bg-[color:var(--px-card-fill)] px-[9px] py-1 text-[color:var(--px-ink-muted)] transition-colors hover:text-nightsky"
                                  >
                                    {inner}
                                  </a>
                                ) : (
                                  <span
                                    key={`${action.id}-read-${i}`}
                                    className="inline-flex items-center gap-1.5 rounded-[5px] bg-[color:var(--px-card-fill)] px-[9px] py-1 text-[color:var(--px-ink-muted)]"
                                  >
                                    {inner}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {action.work_status === 'done' && (
                          <div className="mt-4 rounded-md border border-teal/30 bg-teal/5 p-3">
                            <p className="text-[13px] font-medium text-nightsky">
                              Marked done by{' '}
                              {assigneeNames.get(action.asserted_done_by ?? '') ?? 'the owner'}
                              {action.asserted_done_at
                                ? ` on ${formatDate(action.asserted_done_at)}`
                                : ''}{' '}
                              — pending verification in the next report
                            </p>
                            {action.assertion_note && (
                              <p className="mt-1 text-[13px] text-[color:var(--px-ink-muted)]">
                                {action.assertion_note}
                              </p>
                            )}
                            {action.assertion_url && (
                              <a
                                href={action.assertion_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 inline-flex items-center gap-1 text-[13px] text-teal underline"
                              >
                                {action.assertion_url}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        )}

                        {/* Controls live in the detail so the row itself stays as designed. */}
                        <div
                          className="mt-5 flex flex-wrap items-center gap-3 border-t border-[color:var(--px-hairline)] pt-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isSuperAdmin ? (
                            <Select
                              value={action.assignee_id ?? 'unassigned'}
                              onValueChange={(v) =>
                                handleAssign(action, v === 'unassigned' ? null : v)
                              }
                            >
                              <SelectTrigger className="h-8 w-56 text-sm">
                                <SelectValue placeholder="Unassigned" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unassigned">Unassigned</SelectItem>
                                {assignees.map((a) => (
                                  <SelectItem key={a.user_id} value={a.user_id}>
                                    {a.full_name || a.email}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : ownerName ? (
                            <span className="text-sm text-[color:var(--px-ink-muted)]">
                              Owner: <span className="font-semibold text-nightsky">{ownerName}</span>
                            </span>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => handleAssign(action, user?.id ?? null)}
                            >
                              Assign to me
                            </Button>
                          )}

                          {canSetStatus && (
                            <Select
                              value={action.work_status}
                              onValueChange={(v) => handleStatus(action, v as ActionWorkStatus)}
                            >
                              <SelectTrigger className="h-8 w-40 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="open">Not started</SelectItem>
                                <SelectItem value="in_progress">In progress</SelectItem>
                                <SelectItem value="done">Done</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}

        {filter !== 'done' && doneCount > 0 && (
          <p className="mt-10 text-[12.5px] text-[color:var(--px-ink-dim)]">
            {doneCount} done this quarter {doneCount === 1 ? 'is' : 'are'} hidden —{' '}
            <button
              type="button"
              onClick={() => setPicked('done')}
              className="font-semibold text-pink hover:underline"
            >
              filter to Done
            </button>{' '}
            to review {doneCount === 1 ? 'it' : 'them'}.
          </p>
        )}
      </div>

      <Dialog open={doneTarget !== null} onOpenChange={(open) => !open && setDoneTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as done</DialogTitle>
            <DialogDescription>
              This records that the work happened. Whether it worked is checked against the data in
              the next report, so the action stays on the register until then.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">What did you do? (optional)</label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Claimed the kununu profile and responded to the 12 most recent reviews."
                className="mt-1"
                rows={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Link to it (optional)</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://"
                className="mt-1"
              />
              <p className="mt-1 text-xs text-gray-500">
                A link lets us check it directly when we write the next report.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDoneTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={confirmDone} disabled={saving}>
              {saving ? 'Saving…' : 'Mark as done'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ActionsTab;
