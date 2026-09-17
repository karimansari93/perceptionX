import { describe, expect, it } from 'vitest';
import { parseTextFragment, describeRange } from '@/lib/careerSite/textFragment';
import { aggregateOwnership, deriveActions } from '@/lib/careerSite/actions';
import type { CareerSiteGapRow } from '@/hooks/dashboard/dashboardQueries';

// The fragment strings below are real values from prompt_responses citations
// (careers.ford.com, jobs.netflix.com), not invented shapes: the parser is the
// only thing standing between Google's grammar and a highlight drawn on a
// client's page, so it is tested against what the platforms actually emit.

describe('parseTextFragment', () => {
  it('parses a start,end range', () => {
    const [range] = parseTextFragment(
      'A%20Ford%20recruiter%20may%20contact,consultants%20or%20services%20who%20do.',
    );
    expect(range.textStart).toBe('A Ford recruiter may contact');
    expect(range.textEnd).toBe('consultants or services who do.');
    expect(range.prefix).toBeUndefined();
  });

  it('parses a start-only range', () => {
    const [range] = parseTextFragment('Recruiting%20Process');
    expect(range.textStart).toBe('Recruiting Process');
    expect(range.textEnd).toBeUndefined();
  });

  it('splits the multiple ranges a single citation can carry', () => {
    const ranges = parseTextFragment(
      'Recruiting%20Process&text=A%20Ford%20recruiter%20may%20contact,consultants%20or%20services%20who%20do.',
    );
    expect(ranges).toHaveLength(2);
    expect(ranges[0].textStart).toBe('Recruiting Process');
    expect(ranges[1].textEnd).toBe('consultants or services who do.');
  });

  it('separates a prefix- and -suffix from the quoted text', () => {
    const [range] = parseTextFragment('Culture-,We%20are%20a%20team,-not%20a%20family');
    expect(range.prefix).toBe('Culture');
    expect(range.textStart).toBe('We are a team');
    expect(range.suffix).toBe('not a family');
    // With prefix and suffix peeled off, a lone body is a start, not an end.
    expect(range.textEnd).toBeUndefined();
  });

  it('survives a malformed percent-escape rather than throwing', () => {
    const ranges = parseTextFragment('100%%20raise');
    expect(ranges).toHaveLength(1);
    expect(ranges[0].textStart).toContain('100');
  });

  it('returns nothing for an empty fragment', () => {
    expect(parseTextFragment('')).toEqual([]);
  });

  it('renders a readable label for a range', () => {
    const [range] = parseTextFragment('At%20Netflix,How%20to%20Prepare');
    expect(describeRange(range)).toBe('At Netflix … How to Prepare');
  });
});

// The gap numbers below mirror PepsiCo's measured shape: pay is answered by
// third parties roughly 2.7x more often than by the career site, while the
// application process runs the other way.
const gapRow = (over: Partial<CareerSiteGapRow>): CareerSiteGapRow => ({
  attribute_id: 'compensation',
  response_month: '2026-07-01',
  answers: 50,
  answers_owned: 12,
  answers_benchmark: 34,
  ...over,
});

describe('aggregateOwnership', () => {
  it('sums counts across months rather than averaging monthly percentages', () => {
    const [topic] = aggregateOwnership([
      gapRow({ response_month: '2026-07-01', answers: 90, answers_owned: 9, answers_benchmark: 60 }),
      gapRow({ response_month: '2026-08-01', answers: 10, answers_owned: 8, answers_benchmark: 2 }),
    ]);
    // Summed: 17/100 owned. Averaging the two months would have given 50%.
    expect(topic.answers).toBe(100);
    expect(Math.round(topic.ownedShare)).toBe(17);
    expect(Math.round(topic.benchmarkShare)).toBe(62);
  });

  it('reports the gap in percentage points and sorts worst-first', () => {
    const topics = aggregateOwnership([
      gapRow({ attribute_id: 'application-process', answers: 50, answers_owned: 36, answers_benchmark: 25 }),
      gapRow({ attribute_id: 'compensation', answers: 50, answers_owned: 12, answers_benchmark: 34 }),
    ]);
    expect(topics[0].attributeId).toBe('compensation');
    expect(Math.round(topics[0].gap)).toBe(44);
    expect(topics[1].gap).toBeLessThan(0);
  });

  it('never divides by zero when a topic has no measured answers', () => {
    const [topic] = aggregateOwnership([
      gapRow({ answers: 0, answers_owned: 0, answers_benchmark: 0 }),
    ]);
    expect(topic.ownedShare).toBe(0);
    expect(topic.benchmarkShare).toBe(0);
  });
});

describe('deriveActions', () => {
  it('flags a topic third parties own as critical', () => {
    const [action] = deriveActions(aggregateOwnership([gapRow({})]));
    expect(action.severity).toBe('critical');
    expect(action.headline).toContain('compensation');
    expect(action.detail).toContain('68%');
    expect(action.detail).toContain('24%');
  });

  it('reports a topic the career site leads as a strength', () => {
    const [action] = deriveActions(aggregateOwnership([
      gapRow({ attribute_id: 'application-process', answers: 50, answers_owned: 36, answers_benchmark: 25 }),
    ]));
    expect(action.severity).toBe('strength');
  });

  it('skips topics below the volume floor instead of showing a shaky number', () => {
    const actions = deriveActions(aggregateOwnership([
      gapRow({ answers: 4, answers_owned: 0, answers_benchmark: 4 }),
    ]));
    expect(actions).toEqual([]);
  });

  it('orders critical before warning before strength', () => {
    const actions = deriveActions(aggregateOwnership([
      gapRow({ attribute_id: 'application-process', answers: 60, answers_owned: 40, answers_benchmark: 20 }),
      gapRow({ attribute_id: 'compensation', answers: 60, answers_owned: 10, answers_benchmark: 45 }),
      gapRow({ attribute_id: 'leadership', answers: 60, answers_owned: 24, answers_benchmark: 33 }),
    ]));
    expect(actions.map((a) => a.severity)).toEqual(['critical', 'warning', 'strength']);
  });

  it('carries the evidence it was derived from onto every action', () => {
    const [action] = deriveActions(aggregateOwnership([gapRow({})]));
    expect(action.answers).toBe(50);
    expect(action.source).toBe('derived');
    expect(action.recommendation.length).toBeGreaterThan(0);
  });
});
