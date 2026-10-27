// ─── px-tools: report snapshot + action register ────────────────────────────
// get_report_actions returns what PerceptionX told this organization in its
// latest published report (client_report_snapshots) and the action register
// that tracks the recommendations cycle to cycle (company_actions +
// company_action_checks). It is the chat's client knowledge base.
//
// Tenancy: rows are read for ctx.organizationId only (the caller's verified
// org, never model-chosen) and only once published. Both filters run in the
// query AND again on the returned rows, so a draft or another organization's
// row can never reach the payload even if a query filter were dropped.
// Read-only: nothing here writes. Status and owner changes are made by
// PerceptionX from the admin side (admin_update_company_action).
//
// Payload rules: percentages only (no counts are stored), dates in words
// ("13 Oct 2026", never ISO), every item carries the cycle and as-of date it
// belongs to, and metric_status says which figures are provisional. Actions
// go by title: no number, no timing (the organization decides when) and no
// owner. Their steps ({label, url}) are returned exactly as stored, and each
// carries its priority (High, Medium, Low: the expected effect on what AI
// tells candidates, with its reason), High first.
//
// Market filter: an action tagged 'Global' belongs to every market, an
// organization-wide action (no markets) too, and a world region ("Europe")
// expands to every market inside it (_shared/regions.ts), so "Germany"
// returns Germany's actions plus the Global ones and "Europe" every European
// market's plus Global. Before 2026-10-27 the filter kept only exact market
// matches, which dropped the Global actions whenever a market was asked for.

import { coverageFound, coverageNoData, monthToQuarter } from './helpers.ts';
import type { ToolContext } from './scope.ts';
import { bucketsInRegion, countryCodeForLocation, regionFromText } from '../regions.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-10-13" → "13 Oct 2026". Anything else passes through untouched.
export function dateInWords(iso: unknown): string | null {
  if (typeof iso !== 'string') return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const STATUS_LABEL: Record<string, string> = {
  open: 'open', in_progress: 'in progress', done: 'done',
  stalled: 'stalled', escalated: 'escalated', retired: 'retired',
};
// Priority is the expected effect on what AI tells candidates (share of
// negative opinions targeted x how much the client controls x how fast AI
// picks it up). It is not timing, so the register's timing column is never
// returned: the client decides when to act.
const PRIORITY_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
// Markets that mean the whole organisation (same list as the dashboard).
const ORG_WIDE = new Set(['global', 'all markets', 'worldwide']);
const LANE_LABEL: Record<string, string> = { business: 'Business', owned: 'Owned', people: 'People' };
const REPORT_TYPE_LABEL: Record<string, string> = {
  baseline: 'baseline', quarterly: 'quarterly report', refresh: 'refresh', pilot: 'pilot', custom: 'report',
};

const cycleLabel = (cycle: unknown) => (typeof cycle === 'string' && /^\d{4}-\d{2}/.test(cycle) ? monthToQuarter(cycle) : null);
const isMine = (ctx: ToolContext) => (r: any) => r?.organization_id === ctx.organizationId && r?.published_at != null;
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

// Steps as stored: [{label, url}] with url null when the step has no page.
function steps(raw: unknown): Array<{ label: string; url: string | null }> {
  return (Array.isArray(raw) ? raw : [])
    .filter((s: any) => s && typeof s === 'object' && s.label)
    .map((s: any) => ({ label: String(s.label), url: typeof s.url === 'string' && s.url ? s.url : null }));
}

// Does an action apply to the market the user asked about? Yes when it is
// organisation-wide (no markets, or Global), names that market (any
// spelling or ISO code), or names a market inside the region asked for
// ("Europe" takes every European market, plus Global).
export function actionMatchesMarket(actionMarkets: unknown, market: string | undefined): boolean {
  const want = norm(market);
  if (!want) return true;
  const mine = (Array.isArray(actionMarkets) ? actionMarkets : []).map(norm).filter(Boolean);
  if (!mine.length || mine.some((m) => ORG_WIDE.has(m))) return true;
  if (mine.includes(want)) return true;
  const wantCode = countryCodeForLocation(want);
  if (wantCode && mine.some((m) => countryCodeForLocation(m) === wantCode)) return true;
  const region = regionFromText(want);
  return !!region && bucketsInRegion(mine, region).length > 0;
}

const priorityRank = (a: any) => PRIORITY_RANK[String(a?.priority)] ?? 3;

function withDates(facts: unknown): Array<{ fact: string; checked_on: string | null }> {
  return (Array.isArray(facts) ? facts : []).map((f: any) => ({ fact: String(f?.fact ?? ''), checked_on: dateInWords(f?.checked_on) }));
}

// metric_status → { sentiment: { status: 'provisional', reason, since } } with since in words.
function statusBlock(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [metric, v] of Object.entries((raw as Record<string, any>) || {})) {
    out[metric] = { status: v?.status ?? null, reason: v?.reason ?? null, since: dateInWords(v?.since) };
  }
  return out;
}

export async function getReportActions(
  ctx: ToolContext,
  market?: string,
  action?: string,
  include: 'all' | 'report' | 'actions' | 'watch' = 'all',
  actionNumber?: number,
): Promise<string> {
  const { admin, organizationId } = ctx;

  const [snapRes, actionRes] = await Promise.all([
    admin.from('client_report_snapshots')
      .select('organization_id, cycle, period_label, report_type, scope, headline, metric_status, breakdowns, as_of, source_report_name, published_at')
      .eq('organization_id', organizationId)
      .not('published_at', 'is', null)
      .order('cycle', { ascending: false }),
    admin.from('company_actions')
      .select('id, organization_id, key, register, title, cycle_raised, action_number, problem, ai_says, ai_reads, urls, recommendation, steps, lanes, priority, priority_reason, lifts, proof_status, verified_facts, tracking_status, work_status, markets, functions, notes, published_at')
      .eq('organization_id', organizationId)
      .not('published_at', 'is', null),
  ]);
  if (snapRes.error) return JSON.stringify({ error: `Report lookup failed: ${snapRes.error.message}` });
  if (actionRes.error) return JSON.stringify({ error: `Action register lookup failed: ${actionRes.error.message}` });

  const snapshots = (snapRes.data || []).filter(isMine(ctx))
    .sort((a: any, b: any) => String(b.cycle).localeCompare(String(a.cycle)));
  const latest = snapshots[0] ?? null;

  let rows = (actionRes.data || []).filter(isMine(ctx)).filter((a: any) => a.register !== 'retired');
  const wantMarket = norm(market);
  if (wantMarket) rows = rows.filter((a: any) => actionMatchesMarket(a.markets, wantMarket));
  // Title match: exact first, else the title contains the text ("kununu").
  const wantAction = norm(action);
  if (wantAction) {
    const exact = rows.filter((a: any) => norm(a.title) === wantAction);
    rows = exact.length ? exact : rows.filter((a: any) => norm(a.title).includes(wantAction));
  }
  // Old clients may still send action_number; honoured, never advertised.
  if (Number.isInteger(actionNumber)) rows = rows.filter((a: any) => a.action_number === actionNumber);

  // Latest check per action (the baseline row on the first cycle).
  const ids = rows.map((a: any) => a.id);
  const checksByAction = new Map<string, any>();
  if (ids.length) {
    const { data: checks } = await admin.from('company_action_checks')
      .select('action_id, organization_id, cycle, checked_on, status, metric_readings, note')
      .eq('organization_id', organizationId)
      .in('action_id', ids);
    for (const c of (checks || []).filter((c: any) => c.organization_id === organizationId)) {
      const prev = checksByAction.get(c.action_id);
      if (!prev || String(c.cycle) > String(prev.cycle)) checksByAction.set(c.action_id, c);
    }
  }

  const shape = (a: any) => {
    const check = checksByAction.get(a.id);
    return {
      title: a.title,
      raised_in: cycleLabel(a.cycle_raised),
      status: STATUS_LABEL[a.tracking_status] ?? a.tracking_status,
      client_reported_status: STATUS_LABEL[a.work_status] ?? a.work_status,
      markets: a.markets || [],
      functions: a.functions || [],
      problem: a.problem,
      what_ai_says: a.ai_says,
      where_ai_reads: a.ai_reads || [],
      urls: a.urls || [],
      what_to_do: a.recommendation,
      steps: steps(a.steps),
      lanes: (a.lanes || []).map((l: string) => LANE_LABEL[l] ?? l),
      priority: PRIORITY_LABEL[a.priority] ?? null,
      priority_reason: PRIORITY_LABEL[a.priority] && a.priority_reason ? a.priority_reason : null,
      lifts: a.lifts || [],
      proof_status: a.proof_status || null,
      verified_facts: withDates(a.verified_facts),
      notes: a.notes || null,
      latest_check: check ? {
        cycle: cycleLabel(check.cycle),
        checked_on: dateInWords(check.checked_on),
        status: STATUS_LABEL[check.status] ?? check.status,
        metric_readings: check.metric_readings || [],
        note: check.note || null,
      } : null,
    };
  };

  // High, Medium, Low, then unlabelled; within a label the newest cycle
  // first, then by title: no numbers to order by any more.
  const order = (a: any, b: any) =>
    (priorityRank(a) - priorityRank(b))
    || String(b.cycle_raised ?? '').localeCompare(String(a.cycle_raised ?? ''))
    || String(a.title ?? '').localeCompare(String(b.title ?? ''));
  const actions = rows.filter((a: any) => a.register !== 'watch').sort(order).map(shape);
  const watch = rows.filter((a: any) => a.register === 'watch').sort(order).map(shape);

  const report = latest ? {
    period: latest.period_label,
    report: `${latest.period_label} ${REPORT_TYPE_LABEL[latest.report_type] ?? latest.report_type}`,
    as_of: dateInWords(latest.as_of),
    source_report_name: latest.source_report_name,
    scope: latest.scope || {},
    headline: latest.headline || {},
    metric_status: statusBlock(latest.metric_status),
    breakdowns: latest.breakdowns || {},
  } : null;

  if (!report && !actions.length && !watch.length) {
    return JSON.stringify({
      report: null, actions: [], watch_items: [],
      _coverage: coverageNoData(wantMarket || wantAction || Number.isInteger(actionNumber)
        ? 'No published recommendations match that market or action title.'
        : 'No report or action register has been published for this organization yet.'),
    });
  }

  // A market or title filter that matches nothing is no_data, even when the
  // report itself is there: the host must not invent an action to fit.
  const filtered = !!(wantMarket || wantAction || Number.isInteger(actionNumber));
  const nothingMatched = filtered && !actions.length && !watch.length;
  return JSON.stringify({
    ...(include === 'all' || include === 'report' ? { report } : {}),
    ...(include === 'all' || include === 'actions' ? { actions } : {}),
    ...(include === 'all' || include === 'watch' ? { watch_items: watch } : {}),
    _coverage: nothingMatched
      ? coverageNoData('No published recommendations match that market or action title.')
      : coverageFound(),
    _meta: {
      cite_as: report ? `${report.report}, as of ${report.as_of}` : null,
      methodology: [
        'These are the figures and recommendations from the published PerceptionX report, frozen at its as-of date. Live tools may show different figures because they read the latest data; quote both with their dates when they differ.',
        'Every figure is a share of answers or a score; coverage_pct is the share of the answers in question that cite the source.',
        'metric_status marks each headline metric final or provisional. Say "provisional" whenever quoting a provisional metric.',
        'status is the PerceptionX verdict on the action; client_reported_status is what the organization reported. Neither can be changed from here, and action status and owners are set in the PerceptionX platform.',
        'Refer to actions by their title. No timing is given: the organization decides when to act. steps are the stored steps with their links, to be linked exactly as returned.',
        'priority (High, Medium, Low) is the expected effect on what AI tells candidates: the share of negative opinions it targets, how much the client controls, and how fast AI picks it up. priority_reason says why in the client\'s own figures. It is not timing: never tell the client when to act.',
      ],
    },
  });
}
