// Action register (company_actions) helpers for the dashboard's Actions tab.
// Pure functions only, so the board's filtering and ordering are unit-tested.
//
// Board columns follow the client owner's own status (work_status):
// open = Suggested, in_progress = In progress, done = Done. PerceptionX's
// verdict (tracking_status) is shown read-only on the card. Retired rows
// (register or tracking_status 'retired') never reach the board; watch items
// sit in their own group under it.

export type WorkStatus = 'open' | 'in_progress' | 'done';

export interface AiRead {
  source?: string | null;
  market?: string | null;
  coverage_pct?: number | null;
  url?: string | null;
}

export interface MetricReading {
  metric?: string | null;
  attribute?: string | null;
  market?: string | null;
  value_pct?: number | null;
  metric_status?: string | null;
}

export interface CompanyAction {
  id: string;
  organization_id: string;
  key: string;
  register: string;
  title: string;
  cycle_raised: string | null;
  action_number: number | null;
  problem: string | null;
  ai_says: string | null;
  ai_reads: AiRead[] | null;
  urls: string[] | null;
  recommendation: string | null;
  lanes: string[] | null;
  timing: string | null;
  work_kind: string | null;
  source_domain?: string | null;
  company_id?: string | null;
  markets: string[] | null;
  owner_name: string | null;
  assignee_id: string | null;
  work_status: WorkStatus;
  tracking_status: string;
  assertion_note: string | null;
  assertion_url: string | null;
  asserted_done_at: string | null;
  notes: string | null;
  published_at: string | null;
  created_at: string;
}

export interface ActionCheck {
  id: string;
  action_id: string;
  cycle: string;
  checked_on: string;
  status: string;
  metric_readings: MetricReading[] | null;
  note: string | null;
}

export const STATUS_LABEL: Record<string, string> = {
  open: 'open', in_progress: 'in progress', done: 'done',
  stalled: 'stalled', escalated: 'escalated', retired: 'retired',
};
export const TIMING_LABEL: Record<string, string> = { act_now: 'Act now', act_next: 'Act next', act_later: 'Act later' };
export const WORK_KIND_LABEL: Record<string, string> = {
  reviews: 'Reviews', conversations: 'Conversations', outreach: 'Outreach', profile_claims: 'Profile claims',
  certifications: 'Certifications', owned_content: 'Owned content', social_pr: 'Social and PR',
};
export const LANE_LABEL: Record<string, string> = { business: 'Business', owned: 'Owned', people: 'People' };

export const BOARD_COLUMNS: { status: WorkStatus; label: string }[] = [
  { status: 'open', label: 'Suggested' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'done', label: 'Done' },
];

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

// Markets that mean "the whole organisation" in the register.
const ORG_WIDE = new Set(['global', 'all markets', 'worldwide']);

export const isRetired = (a: Pick<CompanyAction, 'register' | 'tracking_status'>) =>
  a.register === 'retired' || a.tracking_status === 'retired';
export const isWatch = (a: Pick<CompanyAction, 'register'>) => a.register === 'watch';

// Same rule as the quarterly email's filterActions: an action matches when
// any of its markets equals a wanted market (case-insensitive), or it has no
// markets (organisation-wide). "Global" is also treated as organisation-wide.
// No wanted markets = no filter.
export function matchesMarkets(actionMarkets: string[] | null | undefined, wanted: string[]): boolean {
  const want = new Set(wanted.map(norm).filter(Boolean));
  if (!want.size) return true;
  const mine = (actionMarkets || []).map(norm).filter(Boolean);
  if (!mine.length || mine.some((m) => ORG_WIDE.has(m))) return true;
  return mine.some((m) => want.has(m));
}

const TIMING_RANK: Record<string, number> = { act_now: 0, act_next: 1, act_later: 2 };

// Act now, Act next, Act later, then no timing; newer report first; then the
// number printed in the report; legacy rows without a number go last.
export function compareActions(a: CompanyAction, b: CompanyAction): number {
  const t = (TIMING_RANK[a.timing ?? ''] ?? 3) - (TIMING_RANK[b.timing ?? ''] ?? 3);
  if (t) return t;
  const c = String(b.cycle_raised ?? '').localeCompare(String(a.cycle_raised ?? ''));
  if (c) return c;
  const n = (a.action_number ?? 999) - (b.action_number ?? 999);
  if (n) return n;
  return a.title.localeCompare(b.title);
}

export function columnOf(a: Pick<CompanyAction, 'work_status'>): WorkStatus {
  return a.work_status === 'in_progress' || a.work_status === 'done' ? a.work_status : 'open';
}

export interface BoardFilter {
  markets: string[];        // empty = all markets
  includeUserId?: string | null; // actions this user owns always show
}

export function buildBoard(actions: CompanyAction[], filter: BoardFilter) {
  const visible = actions
    .filter((a) => !isRetired(a))
    .filter((a) => (filter.includeUserId && a.assignee_id === filter.includeUserId) || matchesMarkets(a.markets, filter.markets))
    .sort(compareActions);
  const columns: Record<WorkStatus, CompanyAction[]> = { open: [], in_progress: [], done: [] };
  for (const a of visible.filter((x) => !isWatch(x))) columns[columnOf(a)].push(a);
  return { columns, watch: visible.filter(isWatch) };
}

// "2026-10-01" → "Q4 2026"; anything else passes through (legacy "Q4 2026").
export function cycleLabel(cycle: string | null | undefined): string | null {
  if (!cycle) return null;
  const m = /^(\d{4})-(\d{2})/.exec(cycle);
  if (!m) return cycle;
  return `Q${Math.floor((Number(m[2]) - 1) / 3) + 1} ${m[1]}`;
}

export const numberLabel = (n: number | null | undefined) => (n == null ? null : String(n).padStart(2, '0'));

export type NotePart = { kind: 'text'; text: string } | { kind: 'link'; url: string; label: string };

// Splits free-text notes into text and links. An Amplify link is labelled
// "Share with employees"; any other link shows its host.
export function noteParts(notes: string | null | undefined): NotePart[] {
  if (!notes) return [];
  const parts: NotePart[] = [];
  const re = /https?:\/\/[^\s)]+/g;
  let last = 0;
  for (const m of notes.matchAll(re)) {
    const url = m[0].replace(/[.,;]+$/, '');
    if (m.index! > last) parts.push({ kind: 'text', text: notes.slice(last, m.index) });
    let label = url;
    try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
    if (/amplify/i.test(url)) label = 'Share with employees';
    parts.push({ kind: 'link', url, label });
    last = m.index! + url.length;
  }
  if (last < notes.length) parts.push({ kind: 'text', text: notes.slice(last) });
  return parts;
}

// The Overview card: the user's own open actions (in progress first), then
// unowned suggestions for their market.
export function pendingForUser(actions: CompanyAction[], userId: string | null | undefined, markets: string[]) {
  const live = actions.filter((a) => !isRetired(a) && !isWatch(a) && a.work_status !== 'done');
  const mine = live
    .filter((a) => !!userId && a.assignee_id === userId)
    .sort((a, b) => (a.work_status === b.work_status ? compareActions(a, b) : a.work_status === 'in_progress' ? -1 : 1));
  const suggested = live
    .filter((a) => !a.assignee_id && a.work_status === 'open' && matchesMarkets(a.markets, markets))
    .sort(compareActions);
  return { mine, suggested };
}

export interface SourcesCompany { id: string; name: string; country?: string | null; brand: string }

// Where "See in Sources" goes: a company of this organisation that covers
// the action's market, so the source's figures are the ones the action is
// about. The action's own company when it has one, else a company of the
// organisation's main brand (the brand the organisation is named after, e.g.
// Ford for Ford Motor Company). The market is the action's single market, or
// the header's market when the action covers it (or every market), else the
// action's markets in order. Null when no company covers any of them.
export function sourcesTarget(
  action: Pick<CompanyAction, 'markets'> & { company_id?: string | null },
  companies: SourcesCompany[],
  orgName: string | null | undefined,
  headerMarket: string | null,
  currentCompanyId: string | null | undefined,
  canonical: (raw: string | null | undefined) => string | null,
): { companyId: string; market: string | null } | null {
  const real = (action.markets || []).filter((m) => !ORG_WIDE.has(norm(m)));
  const headerIn = !!headerMarket && (real.length === 0 || real.some((m) => norm(m) === norm(headerMarket)));
  const candidates: (string | null)[] = real.length === 1
    ? real
    : headerIn ? [headerMarket] : real.length ? real : [null];

  const org = norm(orgName);
  const mainBrand = [...new Set(companies.map((c) => c.brand))]
    .filter((b) => org === norm(b) || org.startsWith(`${norm(b)} `))
    .sort((a, b) => b.length - a.length)[0] ?? null;
  const pool = action.company_id
    ? companies.filter((c) => c.id === action.company_id)
    : companies.filter((c) => mainBrand && c.brand === mainBrand);

  for (const market of candidates) {
    const key = market ? canonical(market) : null;
    const fits = pool.filter((c) => key == null || canonical(c.country) === key);
    if (!fits.length) continue;
    const pick = fits.find((c) => c.id === currentCompanyId)
      ?? fits.find((c) => c.name === mainBrand)
      ?? fits[0];
    return { companyId: pick.id, market };
  }
  return null;
}
