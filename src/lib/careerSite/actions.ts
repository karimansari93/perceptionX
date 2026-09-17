// Turning topic ownership into the tab's right-hand action list.
//
// The ranking signal is deliberately NOT sentiment. Measured across a
// client's own career-site pages, sentiment does not discriminate — an answer
// citing the career site almost always mentions the brand, so every page
// lands in the same narrow band and the list would rank on noise. What does
// discriminate is who gets cited when a topic comes up: on PepsiCo's data,
// pay is answered by Glassdoor/Indeed/Reddit in 67% of answers and by
// pepsicojobs.com in 25%, while the application process runs the other way
// (71% career site, 50% third party). That contrast is the product.
//
// Every action carries the numbers it was derived from so the UI can show its
// own evidence, and `source` leaves room for actions fed in from a client's
// report rather than derived here.

import { ATTRIBUTES } from '@/config/attributes';
import type { CareerSiteGapRow } from '@/hooks/dashboard/dashboardQueries';

export type ActionSeverity = 'critical' | 'warning' | 'watch' | 'strength';

export interface CareerSiteAction {
  id: string;
  attributeId: string;
  attributeName: string;
  severity: ActionSeverity;
  headline: string;
  detail: string;
  recommendation: string;
  /** % of answers on this topic citing the career-site property. */
  ownedShare: number;
  /** % of answers on this topic citing an employer-review or job-board site. */
  benchmarkShare: number;
  /** Percentage points by which third parties out-cite the career site. */
  gap: number;
  answers: number;
  source: 'derived' | 'report';
}

// A topic needs this many measured answers before it can raise an action —
// below it, a single answer moves the share by double digits.
const MIN_ANSWERS = 25;

// Thresholds in percentage points. `critical` is where third parties own the
// answer outright; `warning` is a real but recoverable deficit; a topic the
// career site leads on is reported as a strength so the list is not all bad
// news (and so clients can see what to copy).
const CRITICAL_GAP = 25;
const WARNING_GAP = 10;
const LOW_OWNED_SHARE = 20;

const attributeName = (attributeId: string): string => {
  const known = ATTRIBUTES.find((a) => a.id === attributeId);
  if (known) return known.name;
  // Legacy/renamed ids still appear in older measured quarters.
  return attributeId
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

export interface TopicOwnership {
  attributeId: string;
  attributeName: string;
  answers: number;
  ownedShare: number;
  benchmarkShare: number;
  gap: number;
}

/**
 * Collapse month-grain gap rows into one row per topic for the active window.
 * Shares are computed from summed counts, never averaged from per-month
 * percentages, so a light month cannot swing the figure.
 */
export function aggregateOwnership(rows: CareerSiteGapRow[]): TopicOwnership[] {
  const acc = new Map<string, { answers: number; owned: number; benchmark: number }>();
  for (const row of rows) {
    const key = row.attribute_id;
    const entry = acc.get(key) ?? { answers: 0, owned: 0, benchmark: 0 };
    entry.answers += Number(row.answers) || 0;
    entry.owned += Number(row.answers_owned) || 0;
    entry.benchmark += Number(row.answers_benchmark) || 0;
    acc.set(key, entry);
  }

  return Array.from(acc.entries())
    .map(([attributeId, e]) => {
      const ownedShare = e.answers > 0 ? (e.owned / e.answers) * 100 : 0;
      const benchmarkShare = e.answers > 0 ? (e.benchmark / e.answers) * 100 : 0;
      return {
        attributeId,
        attributeName: attributeName(attributeId),
        answers: e.answers,
        ownedShare,
        benchmarkShare,
        gap: benchmarkShare - ownedShare,
      };
    })
    .sort((a, b) => b.gap - a.gap);
}

const RECOMMENDATIONS: Record<string, string> = {
  compensation:
    'Publish pay ranges, bonus structure and total-rewards detail on a page of its own. Salary questions resolve to whoever states a number, and right now that is not you.',
  'wellbeing-balance':
    'Describe the actual flexibility policy — hybrid split, shift patterns, leave — in specifics rather than adjectives. Review sites answer this with employee anecdote by default.',
  'company-culture':
    'Move culture off the hero banner and into named, dated evidence: team stories, day-in-the-life content, what changed this year.',
  'candidate-feedback':
    'Publish what happens after an application: response times, stages, and what silence means. This is the single most-asked candidate question and reviews currently own it.',
  'interview-experience':
    'Document the interview format per job family — rounds, who is in them, how to prepare. Candidates find this on Glassdoor otherwise.',
  'career-opportunities':
    'Show real progression paths with timeframes and internal-mobility numbers, not a generic development statement.',
  leadership:
    'Put named leaders on the career site with their own words on how they run teams.',
  inclusion:
    'Pair the commitment with measurable outcomes — representation data, ERG activity, accommodations process.',
  'job-security':
    'Address stability directly: tenure, growth areas, and how restructuring is handled.',
  'social-impact':
    'Link the employer brand to the impact work candidates ask about, on the career site rather than only the corporate site.',
  'rewards-recognition':
    'Spell out recognition programmes and what actually earns one.',
  'application-process':
    'Keep this current — it is a topic your career site already owns.',
};

const fallbackRecommendation = (name: string): string =>
  `Give ${name.toLowerCase()} a dedicated, factual page on the career site — third-party sites currently answer it for you.`;

/**
 * Derive the action list from topic ownership.
 * Topics below the volume floor are skipped entirely rather than shown with a
 * caveat: an action a client cannot trust is worse than no action.
 */
export function deriveActions(ownership: TopicOwnership[]): CareerSiteAction[] {
  const actions: CareerSiteAction[] = [];

  for (const topic of ownership) {
    if (topic.answers < MIN_ANSWERS) continue;

    const base = {
      id: `derived:${topic.attributeId}`,
      attributeId: topic.attributeId,
      attributeName: topic.attributeName,
      ownedShare: topic.ownedShare,
      benchmarkShare: topic.benchmarkShare,
      gap: topic.gap,
      answers: topic.answers,
      source: 'derived' as const,
      recommendation: RECOMMENDATIONS[topic.attributeId] ?? fallbackRecommendation(topic.attributeName),
    };

    const owned = Math.round(topic.ownedShare);
    const benchmark = Math.round(topic.benchmarkShare);

    if (topic.gap >= CRITICAL_GAP || (topic.ownedShare < LOW_OWNED_SHARE && topic.gap >= WARNING_GAP)) {
      actions.push({
        ...base,
        severity: 'critical',
        headline: `Third parties own the answer on ${topic.attributeName.toLowerCase()}`,
        detail: `${benchmark}% of answers on this topic cite a review or job-board site. Your career site is cited by ${owned}%.`,
      });
    } else if (topic.gap >= WARNING_GAP) {
      actions.push({
        ...base,
        severity: 'warning',
        headline: `Losing ground on ${topic.attributeName.toLowerCase()}`,
        detail: `Review and job-board sites are cited by ${benchmark}% of answers here, against ${owned}% for your career site.`,
      });
    } else if (topic.gap <= -WARNING_GAP) {
      actions.push({
        ...base,
        severity: 'strength',
        headline: `Your career site leads on ${topic.attributeName.toLowerCase()}`,
        detail: `${owned}% of answers cite your career site, against ${benchmark}% citing third parties.`,
        recommendation: 'Hold this. It is the pattern to copy onto the topics above.',
      });
    } else {
      actions.push({
        ...base,
        severity: 'watch',
        headline: `Contested: ${topic.attributeName.toLowerCase()}`,
        detail: `Career site ${owned}% vs third parties ${benchmark}% of answers — neither source owns this topic.`,
      });
    }
  }

  const rank: Record<ActionSeverity, number> = { critical: 0, warning: 1, watch: 2, strength: 3 };
  return actions.sort((a, b) => rank[a.severity] - rank[b.severity] || b.gap - a.gap);
}

export const SEVERITY_LABEL: Record<ActionSeverity, string> = {
  critical: 'Losing the answer',
  warning: 'At risk',
  watch: 'Contested',
  strength: 'Working',
};
