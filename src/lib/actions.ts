import { GENERAL_KEY, type LocationEntry } from '@/utils/locationContext';
import { expandSelectionKey, resolveSelectionEntry } from '@/utils/locationSelection';

// Action register (company_actions) helpers for the dashboard's Actions tab.
// Pure functions only, so the board's filtering and ordering are unit-tested.
//
// Board columns follow the client owner's own status (work_status):
// open = Suggested, in_progress = In progress, done = Done. PerceptionX's
// verdict (tracking_status) is shown read-only on the card. Retired rows
// (register or tracking_status 'retired') never reach the board; watch items
// sit in their own group under it.

export type WorkStatus = 'open' | 'in_progress' | 'done' | 'dismissed';

export interface AiRead {
  source?: string | null;
  market?: string | null;
  coverage_pct?: number | null;
  url?: string | null;
  basis?: string | null;
}

// Two shapes are stored: a metric reading {metric, attribute, market,
// value_pct, metric_status}, and a source reading {source, market, basis,
// q3_pct, q4_pct, ...} (share of answers citing the source, per quarter).
export interface MetricReading {
  metric?: string | null;
  attribute?: string | null;
  market?: string | null;
  value_pct?: number | null;
  metric_status?: string | null;
  source?: string | null;
  basis?: string | null;
  [quarterPct: `q${number}_pct`]: number | null | undefined;
}

export interface ReadingView {
  label: string;
  market: string | null;
  value: number;
  previous: { value: number; quarter: string } | null;
  ofAnswers: boolean;   // a source reading: % of answers citing it
  provisional: boolean;
}

// One reading as shown on the card; null when it carries no figure.
export function readingView(r: MetricReading | null | undefined): ReadingView | null {
  if (!r) return null;
  const market = r.market ?? null;
  if (typeof r.value_pct === 'number') {
    return {
      label: [r.metric, r.attribute].filter(Boolean).join(' · ') || 'Reading',
      market, value: r.value_pct, previous: null, ofAnswers: false,
      provisional: r.metric_status === 'provisional',
    };
  }
  const quarters = Object.entries(r)
    .map(([k, v]) => ({ m: /^q([1-4])_pct$/.exec(k), v }))
    .filter((x): x is { m: RegExpExecArray; v: number } => !!x.m && typeof x.v === 'number')
    .map((x) => ({ q: Number(x.m[1]), v: x.v }))
    .sort((a, b) => a.q - b.q);
  const latest = quarters.at(-1);
  if (!latest) return null;
  const prev = quarters.at(-2);
  return {
    label: [r.source, r.basis].filter(Boolean).join(' · ') || 'Source',
    market, value: latest.v,
    previous: prev ? { value: prev.v, quarter: `Q${prev.q}` } : null,
    ofAnswers: true, provisional: false,
  };
}

// "same as Q3", "up from 38% in Q3", "down from 52% in Q3".
export function trendText(r: ReadingView): string | null {
  if (!r.previous) return null;
  if (r.previous.value === r.value) return `same as ${r.previous.quarter}`;
  return `${r.value > r.previous.value ? 'up' : 'down'} from ${r.previous.value}% in ${r.previous.quarter}`;
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
  lifts?: { metric?: string | null; attribute?: string | null; market?: string | null }[] | null;
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
  dismissed_at?: string | null;
  dismissed_by?: string | null;
  dismiss_reason?: string | null;
  dismiss_note?: string | null;
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

// Why a client dismissed an action (company_actions.dismiss_reason).
export const DISMISS_REASONS: { value: string; label: string }[] = [
  { value: 'already_done', label: 'We already do this' },
  { value: 'not_our_market', label: 'Not relevant to our market' },
  { value: 'not_our_area', label: 'Not something our team owns' },
  { value: 'disagree', label: 'We disagree with the recommendation' },
  { value: 'not_now', label: 'Not a priority right now' },
  { value: 'other', label: 'Other' },
];
export const dismissReasonLabel = (v: string | null | undefined) =>
  DISMISS_REASONS.find((r) => r.value === v)?.label ?? null;

type BoardStatus = Exclude<WorkStatus, 'dismissed'>;

export const BOARD_COLUMNS: { status: BoardStatus; label: string }[] = [
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
export const isDismissed = (a: Pick<CompanyAction, 'work_status'>) => a.work_status === 'dismissed';

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

export function columnOf(a: Pick<CompanyAction, 'work_status'>): BoardStatus {
  return a.work_status === 'in_progress' || a.work_status === 'done' ? a.work_status : 'open';
}

export interface BoardFilter {
  forYou: boolean;               // false = every action ("All")
  markets: string[];             // the viewer's market spellings; empty = global view
  includeUserId?: string | null; // actions this user owns always show
}

// An action is either for one market or global: global when it names no
// market, an organisation-wide one, or more than one market. There is no
// per-market state; a global action is one shared card everywhere.
export function actionScope(a: Pick<CompanyAction, 'markets'>): { kind: 'market'; market: string } | { kind: 'global' } {
  const real = (a.markets || []).map((m) => m.trim()).filter((m) => m && !ORG_WIDE.has(norm(m)));
  return real.length === 1 && (a.markets || []).every((m) => !ORG_WIDE.has(norm(m)))
    ? { kind: 'market', market: real[0] }
    : { kind: 'global' };
}

// "For you": a market team sees only the actions for its own market; with no
// market selected (the global view) only the global actions. "All" shows
// everything, global actions included.
export function isForYou(a: Pick<CompanyAction, 'markets'>, markets: string[]): boolean {
  const scope = actionScope(a);
  if (!markets.length) return scope.kind === 'global';
  return scope.kind === 'market' && matchesMarkets([scope.market], markets);
}

export function buildBoard(actions: CompanyAction[], filter: BoardFilter) {
  const visible = actions
    .filter((a) => !isRetired(a))
    .filter((a) => !filter.forYou || (!!filter.includeUserId && a.assignee_id === filter.includeUserId) || isForYou(a, filter.markets))
    .sort(compareActions);
  const columns: Record<BoardStatus, CompanyAction[]> = { open: [], in_progress: [], done: [] };
  for (const a of visible.filter((x) => !isWatch(x) && !isDismissed(x))) columns[columnOf(a)].push(a);
  return { columns, watch: visible.filter((x) => isWatch(x) && !isDismissed(x)), dismissed: visible.filter(isDismissed) };
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
// unowned suggestions "for you" (their market's own, or global ones in the
// global view; see isForYou).
export function pendingForUser(actions: CompanyAction[], userId: string | null | undefined, markets: string[]) {
  const live = actions.filter((a) => !isRetired(a) && !isWatch(a) && a.work_status !== 'done' && !isDismissed(a));
  const mine = live
    .filter((a) => !!userId && a.assignee_id === userId)
    .sort((a, b) => (a.work_status === b.work_status ? compareActions(a, b) : a.work_status === 'in_progress' ? -1 : 1));
  const suggested = live
    .filter((a) => !a.assignee_id && a.work_status === 'open' && isForYou(a, markets))
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

// Owned content is labelled by where the work happens, so the card says
// "Careers site" or "YouTube" instead of the generic "Owned content". Read
// from the pages to act on first, then the title and source; review sites in
// the source are where AI reads, not where the client publishes, so they are
// skipped.
export type OwnedChannel = 'careers_site' | 'linkedin' | 'youtube' | 'company_website' | 'platform' | 'owned_content';

const REVIEW_HOSTS = /(glassdoor|indeed|kununu|ambitionbox|comparably|repvue|jobstreet|undelucram|profession\.hu|teamblind|seek\.com)/i;
const CAREERS_HOST = /(^|\.)(careers?|jobs|karriere)\./i;
const CAREERS_PATH = /\/(careers?|jobs|karriere|beruf-karriere|stellenangebote|empleo|vagas)(\/|$|-)/i;
const CAREERS_TEXT = /\bcareers?\b|\bjob postings?\b|\bpostings\b|\bfaqs?\b|\binterview guide\b/i;
const PLATFORM_LABEL: Record<string, string> = { 'naver.com': 'Naver', 'note.com': 'note.com', 'instagram.com': 'Instagram', 'tiktok.com': 'TikTok', 'x.com': 'X', 'twitter.com': 'X' };

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
};

const pathOf = (url: string): string => {
  try { return new URL(url).pathname; } catch { return ''; }
};

export function ownedChannel(a: Pick<CompanyAction, 'title' | 'urls'> & { source_name?: string | null; source_domain?: string | null }): { channel: OwnedChannel; label: string } {
  const text = `${a.title} ${a.source_name ?? ''}`;
  const actOn = (a.urls || []).filter((u) => !REVIEW_HOSTS.test(hostOf(u) ?? ''));
  const domain = (a.source_domain ?? '').toLowerCase();
  const ownDomain = domain && !REVIEW_HOSTS.test(domain) ? domain : '';
  const hosts = [...actOn.map(hostOf), ownDomain].filter(Boolean) as string[];

  if (/linkedin/i.test(text) || hosts.some((h) => h.endsWith('linkedin.com'))) return { channel: 'linkedin', label: 'LinkedIn' };
  if (/youtube/i.test(text) || hosts.some((h) => h.endsWith('youtube.com'))) return { channel: 'youtube', label: 'YouTube' };
  const firstUrl = actOn[0];
  if (
    (firstUrl && (CAREERS_HOST.test(hostOf(firstUrl) ?? '') || CAREERS_PATH.test(pathOf(firstUrl))))
    || CAREERS_TEXT.test(text)
    || CAREERS_HOST.test(ownDomain)
  ) return { channel: 'careers_site', label: 'Careers site' };
  const platform = hosts.map((h) => Object.keys(PLATFORM_LABEL).find((p) => h === p || h.endsWith(`.${p}`))).find(Boolean);
  if (platform) return { channel: 'platform', label: PLATFORM_LABEL[platform] };
  if (hosts.length || /\b[a-z0-9-]+\.(com|de|mx|co\.uk|fr|es|com\.br|in)\b/i.test(a.title)) return { channel: 'company_website', label: 'Company website' };
  return { channel: 'owned_content', label: WORK_KIND_LABEL.owned_content };
}

// The single type label a card shows.
export function typeLabel(a: Parameters<typeof ownedChannel>[0] & Pick<CompanyAction, 'work_kind'>): { key: string; label: string } | null {
  if (!a.work_kind) return null;
  if (a.work_kind === 'owned_content') {
    const { channel, label } = ownedChannel(a);
    return { key: channel === 'owned_content' ? 'owned_content' : channel, label };
  }
  return { key: a.work_kind, label: WORK_KIND_LABEL[a.work_kind] ?? a.work_kind };
}

export interface AmplifyLink { token: string; label: string | null; prefill_market_code: string | null; link_subdomain: string | null }

// People actions (reviews, profiles, employee voices) get a "Share with
// employees" link to the organisation's Amplify page.
export const isPeopleAction = (a: Pick<CompanyAction, 'lanes'>) => (a.lanes || []).includes('people');

// The link for an action: one pre-set to the action's market when there is
// one, else the organisation's general link (no market). Links arrive newest
// first, so ties go to the newest.
export function pickAmplifyLink(links: AmplifyLink[], marketCode: string | null): AmplifyLink | null {
  const code = marketCode?.toUpperCase() ?? null;
  return (code && links.find((l) => l.prefill_market_code?.toUpperCase() === code))
    || links.find((l) => !l.prefill_market_code)
    || null;
}

// The header's location selection as action markets: one market, a region
// or a set of markets, each with every spelling the register might use.
// Null for All locations and General (the global view).
export function selectionMarkets(key: string | null | undefined, options: LocationEntry[] | undefined): { label: string; spellings: string[] } | null {
  if (!key || key === GENERAL_KEY || !options) return null;
  const entry = resolveSelectionEntry(key, options);
  if (!entry) return null;
  const members = expandSelectionKey(key, options)
    .map((k) => options.find((o) => o.canonicalKey === k))
    .filter((e): e is LocationEntry => !!e);
  const spellings = new Set<string>([...entry.rawValues, ...members.flatMap((m) => [m.label, ...m.rawValues])]);
  if (!entry.memberKeys) spellings.add(entry.label);
  return { label: entry.label, spellings: [...spellings] };
}

// The title without a market label the card already shows: a leading
// "Mexico: " or "Chile, Colombia and Peru: ", or a trailing " · Germany",
// when it names only the action's own markets. The stored title is unchanged.
export function displayTitle(a: Pick<CompanyAction, 'title' | 'markets'>): string {
  const own = new Set((a.markets || []).map(norm));
  const onlyOwn = (label: string) => {
    const names = label.split(/\s*,\s*|\s+and\s+|\s*&\s*/).map(norm).filter(Boolean);
    return names.length > 0 && names.every((n) => own.has(n));
  };
  const title = a.title.trim();
  const prefix = /^([^:]{2,80}):\s+(.+)$/.exec(title);
  if (prefix && onlyOwn(prefix[1])) return prefix[2].charAt(0).toUpperCase() + prefix[2].slice(1);
  const suffix = /^(.+?)\s+·\s+([^·]+)$/.exec(title);
  if (suffix && onlyOwn(suffix[2])) return suffix[1];
  return title;
}
