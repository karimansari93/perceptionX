import { describe, expect, it } from 'vitest';
import { buildBoard, compareActions, cycleLabel, matchesMarkets, noteParts, pendingForUser, sourcesTarget, type CompanyAction } from './actions';

const action = (over: Partial<CompanyAction>): CompanyAction => ({
  id: over.id ?? Math.random().toString(36),
  organization_id: 'org-1', key: 'k', register: 'act_now', title: 'T', cycle_raised: '2026-09-01',
  action_number: null, problem: null, ai_says: null, ai_reads: [], urls: [], recommendation: null,
  lanes: [], timing: null, work_kind: null, markets: [], owner_name: null, assignee_id: null, work_status: 'open',
  tracking_status: 'open', assertion_note: null, assertion_url: null, asserted_done_at: null,
  notes: null, published_at: '2026-10-01', created_at: '2026-10-01',
  ...over,
});

describe('matchesMarkets', () => {
  it('matches any shared market, case-insensitive', () => {
    expect(matchesMarkets(['Germany', 'United States'], ['germany'])).toBe(true);
    expect(matchesMarkets(['Singapore'], ['Germany'])).toBe(false);
  });
  it('treats empty and Global markets as organisation-wide', () => {
    expect(matchesMarkets([], ['India'])).toBe(true);
    expect(matchesMarkets(['Global', 'United States'], ['India'])).toBe(true);
  });
  it('does not filter when no market is wanted', () => {
    expect(matchesMarkets(['Singapore'], [])).toBe(true);
  });
});

describe('ordering', () => {
  it('sorts by timing, newer report, then number; unnumbered last', () => {
    const rows = [
      action({ id: 'later', timing: 'act_later', action_number: 1 }),
      action({ id: 'n3', timing: 'act_now', action_number: 3 }),
      action({ id: 'none', timing: null, action_number: 1 }),
      action({ id: 'n1', timing: 'act_now', action_number: 1 }),
      action({ id: 'old', timing: 'act_now', action_number: 1, cycle_raised: '2026-04-01' }),
      action({ id: 'legacy', timing: 'act_now', action_number: null }),
    ];
    expect([...rows].sort(compareActions).map((r) => r.id)).toEqual(['n1', 'n3', 'legacy', 'old', 'later', 'none']);
  });
});

describe('buildBoard', () => {
  const rows = [
    action({ id: 'de', markets: ['Germany'], action_number: 1 }),
    action({ id: 'sg', markets: ['Singapore'], action_number: 2 }),
    action({ id: 'de-us', markets: ['Germany', 'United States'], action_number: 3, work_status: 'in_progress' }),
    action({ id: 'us', markets: ['United States'], action_number: 4, assignee_id: 'me', work_status: 'done' }),
    action({ id: 'watch', register: 'watch', markets: [] }),
    action({ id: 'gone', register: 'retired', markets: ['Germany'] }),
  ];

  it('filters by market, columns by the owner status, never shows retired', () => {
    const { columns, watch } = buildBoard(rows, { markets: ['Germany'] });
    expect(columns.open.map((r) => r.id)).toEqual(['de']);
    expect(columns.in_progress.map((r) => r.id)).toEqual(['de-us']);
    expect(columns.done).toEqual([]);
    expect(watch.map((r) => r.id)).toEqual(['watch']);
  });

  it('keeps the user\'s own actions in view whatever the market', () => {
    const { columns } = buildBoard(rows, { markets: ['Germany'], includeUserId: 'me' });
    expect(columns.done.map((r) => r.id)).toEqual(['us']);
  });

  it('shows every action with no market filter', () => {
    const { columns } = buildBoard(rows, { markets: [] });
    expect(columns.open.length + columns.in_progress.length + columns.done.length).toBe(4);
  });
});

describe('labels', () => {
  it('turns cycles into quarters', () => {
    expect(cycleLabel('2026-10-01')).toBe('Q4 2026');
    expect(cycleLabel('Q4 2026')).toBe('Q4 2026');
    expect(cycleLabel(null)).toBeNull();
  });
  it('labels Amplify links for employees', () => {
    const parts = noteParts('Worth: a lot. Share via https://amplify.example.com/x.');
    expect(parts).toContainEqual({ kind: 'link', url: 'https://amplify.example.com/x', label: 'Share with employees' });
  });
});

describe('pendingForUser', () => {
  it('lists the user\'s open actions first, then unowned suggestions for their market', () => {
    const rows = [
      action({ id: 'mine-open', assignee_id: 'me', action_number: 1 }),
      action({ id: 'mine-wip', assignee_id: 'me', work_status: 'in_progress', action_number: 2 }),
      action({ id: 'mine-done', assignee_id: 'me', work_status: 'done' }),
      action({ id: 'theirs', assignee_id: 'other', markets: ['India'] }),
      action({ id: 'india', markets: ['India'] }),
      action({ id: 'germany', markets: ['Germany'] }),
      action({ id: 'watch', register: 'watch' }),
    ];
    const { mine, suggested } = pendingForUser(rows, 'me', ['India']);
    expect(mine.map((r) => r.id)).toEqual(['mine-wip', 'mine-open']);
    expect(suggested.map((r) => r.id)).toEqual(['india']);
  });
});

describe('sourcesTarget', () => {
  const canonical = (r: string | null | undefined) => {
    const map: Record<string, string> = { de: 'germany', germany: 'germany', in: 'india', india: 'india', us: 'united states', 'united states': 'united states' };
    return r ? map[r.trim().toLowerCase()] ?? r.trim().toLowerCase() : null;
  };
  const ford = [
    { id: 'ford-us', name: 'Ford', country: 'US', brand: 'Ford' },
    { id: 'ford-de', name: 'Ford', country: 'DE', brand: 'Ford' },
    { id: 'fbs', name: 'Ford Business Solutions', country: 'IN', brand: 'Ford' },
    { id: 'credit-de', name: 'Ford Credit', country: 'DE', brand: 'Ford Credit' },
  ];

  it('picks the main brand company covering a one-market action', () => {
    expect(sourcesTarget({ markets: ['Germany'] }, ford, 'Ford Motor Company', 'India', 'fbs', canonical))
      .toEqual({ companyId: 'ford-de', market: 'Germany' });
    expect(sourcesTarget({ markets: ['India'] }, ford, 'Ford Motor Company', null, 'ford-us', canonical))
      .toEqual({ companyId: 'fbs', market: 'India' });
  });

  it('uses the header market when the action covers it, and keeps the current company', () => {
    expect(sourcesTarget({ markets: [] }, ford, 'Ford Motor Company', 'India', 'fbs', canonical))
      .toEqual({ companyId: 'fbs', market: 'India' });
  });

  it('prefers the action\'s own company', () => {
    expect(sourcesTarget({ markets: ['Germany'], company_id: 'credit-de' }, ford, 'Ford Motor Company', null, 'fbs', canonical))
      .toEqual({ companyId: 'credit-de', market: 'Germany' });
  });

  it('returns null when no company covers the market', () => {
    expect(sourcesTarget({ markets: ['Romania'] }, ford, 'Ford Motor Company', null, 'fbs', canonical)).toBeNull();
    expect(sourcesTarget({ markets: ['India'], company_id: 'credit-de' }, ford, 'Ford Motor Company', null, 'fbs', canonical)).toBeNull();
  });
});
