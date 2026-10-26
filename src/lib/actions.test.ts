import { describe, expect, it } from 'vitest';
import { actionScope, buildBoard, isForYou, selectionMarkets, isPeopleAction, pickAmplifyLink, readingView, trendText, compareActions, cycleLabel, matchesMarkets, noteParts, ownedChannel, pendingForUser, sourcesTarget, typeLabel, type CompanyAction } from './actions';

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
    action({ id: 'no', markets: ['Germany'], work_status: 'dismissed', dismiss_reason: 'not_now' }),
  ];

  it('puts actions in columns by the owner status and never shows retired', () => {
    const { columns, watch } = buildBoard(rows, { forYou: false, markets: [] });
    expect(columns.open.map((r) => r.id)).toEqual(['de', 'sg']);
    expect(columns.in_progress.map((r) => r.id)).toEqual(['de-us']);
    expect(columns.done.map((r) => r.id)).toEqual(['us']);
    expect(watch.map((r) => r.id)).toEqual(['watch']);
  });

  it('keeps dismissed actions off the board, in their own list', () => {
    const { columns, dismissed } = buildBoard(rows, { forYou: false, markets: [] });
    expect(Object.values(columns).flat().map((r) => r.id)).not.toContain('no');
    expect(dismissed.map((r) => r.id)).toEqual(['no']);
  });

  it('For you shows the market\'s own actions plus the user\'s', () => {
    const { columns } = buildBoard(rows, { forYou: true, markets: ['Germany'], includeUserId: 'me' });
    expect(columns.open.map((r) => r.id)).toEqual(['de']);
    expect(columns.done.map((r) => r.id)).toEqual(['us']);
  });

  it('All shows every action', () => {
    const { columns } = buildBoard(rows, { forYou: false, markets: [] });
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
      action({ id: 'dismissed', markets: ['India'], work_status: 'dismissed' }),
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

describe('ownedChannel', () => {
  const ch = (title: string, extra: Partial<{ urls: string[]; source_name: string; source_domain: string }> = {}) =>
    ownedChannel({ title, urls: extra.urls ?? [], source_name: extra.source_name ?? null, source_domain: extra.source_domain ?? null }).label;

  it('spots the careers site from the page, the title or the domain', () => {
    expect(ch('Add response times to the German interview guide page', {
      urls: ['https://www.kununu.com/de/x/bewerbung', 'https://jobs.thermofisher.com/de/de/interview-resources'], source_domain: 'kununu.com',
    })).toBe('Careers site');
    expect(ch('Germany: a statement on the German careers page.', { urls: ['https://www.ford.de/ford-entdecken/beruf-karriere'] })).toBe('Careers site');
    expect(ch('Publish how hiring works on postings and the FAQ.')).toBe('Careers site');
  });

  it('names social channels and platforms', () => {
    expect(ch('Japanese-language employer video on YouTube', { source_domain: 'youtube.com' })).toBe('YouTube');
    expect(ch('Refresh the LinkedIn life page')).toBe('LinkedIn');
    expect(ch('Publish Korean employer content across Naver', { source_domain: 'naver.com' })).toBe('Naver');
  });

  it('falls back to the company website, then owned content', () => {
    expect(ch('Retire the 2018 and 2022 ford.mx posts')).toBe('Company website');
    expect(ch('Address the culture polarity directly', { source_domain: 'netflix.com' })).toBe('Company website');
    expect(ch('Studocu coursework in Latin America')).toBe('Owned content');
    expect(ch('Put Singapore pay facts where AI reads them', { source_domain: 'glassdoor.com' })).toBe('Owned content');
  });

  it('leaves other kinds alone', () => {
    expect(typeLabel({ title: 'AmbitionBox in India', urls: [], work_kind: 'profile_claims' })?.label).toBe('Profile claims');
  });
});

describe('actionScope', () => {
  it('is a market action only when it names exactly one market', () => {
    expect(actionScope({ markets: ['India'] })).toEqual({ kind: 'market', market: 'India' });
    expect(actionScope({ markets: ['Romania', 'Hungary'] })).toEqual({ kind: 'global' });
    expect(actionScope({ markets: [] })).toEqual({ kind: 'global' });
    expect(actionScope({ markets: ['Global'] })).toEqual({ kind: 'global' });
    expect(actionScope({ markets: ['United States', 'Global'] })).toEqual({ kind: 'global' });
  });

  it('For you is the market\'s own actions, or only global ones in the global view', () => {
    const rows = [
      action({ id: 'global', markets: [], action_number: 1 }),
      action({ id: 'ro-hu', markets: ['Romania', 'Hungary'], action_number: 2 }),
      action({ id: 'hu', markets: ['Hungary'], action_number: 3 }),
      action({ id: 'in', markets: ['India'], action_number: 4 }),
    ];
    const ids = (forYou: boolean, markets: string[]) => buildBoard(rows, { forYou, markets }).columns.open.map((r) => r.id);
    expect(ids(true, ['Hungary'])).toEqual(['hu']);
    expect(ids(true, [])).toEqual(['global', 'ro-hu']);
    expect(ids(false, ['Hungary'])).toEqual(['global', 'ro-hu', 'hu', 'in']);
    expect(isForYou({ markets: ['hungary'] }, ['Hungary'])).toBe(true);
  });
});

describe('readingView', () => {
  it('reads metric readings', () => {
    const v = readingView({ metric: 'Sentiment', attribute: 'Application', market: 'Germany', value_pct: 24, metric_status: 'provisional' });
    expect(v).toMatchObject({ label: 'Sentiment · Application', market: 'Germany', value: 24, ofAnswers: false, provisional: true });
  });

  it('reads source readings, latest quarter first, with the trend', () => {
    const v = readingView({ source: 'kununu', market: 'Germany', q3_pct: 45, q4_pct: 45 })!;
    expect(v).toMatchObject({ label: 'kununu', value: 45, ofAnswers: true, previous: { value: 45, quarter: 'Q3' } });
    expect(trendText(v)).toBe('same as Q3');
    expect(trendText(readingView({ source: 'x', q3_pct: 38, q4_pct: 46 })!)).toBe('up from 38% in Q3');
    expect(trendText(readingView({ source: 'x', q4_pct: 46 })!)).toBeNull();
  });

  it('drops readings with no figure', () => {
    expect(readingView({ metric: 'Sentiment', market: 'Germany' })).toBeNull();
    expect(readingView({ source: 'kununu', market: 'Germany' })).toBeNull();
  });
});

describe('Amplify links', () => {
  const links = [
    { token: 'de', label: 'Germany', prefill_market_code: 'DE', link_subdomain: 'ford' },
    { token: 'global', label: 'Global', prefill_market_code: null, link_subdomain: 'ford' },
  ];
  it('prefers the market link, else the general one', () => {
    expect(pickAmplifyLink(links, 'DE')?.token).toBe('de');
    expect(pickAmplifyLink(links, 'IN')?.token).toBe('global');
    expect(pickAmplifyLink(links, null)?.token).toBe('global');
    expect(pickAmplifyLink([links[0]], 'IN')).toBeNull();
  });
  it('only People actions share with employees', () => {
    expect(isPeopleAction({ lanes: ['people', 'owned'] })).toBe(true);
    expect(isPeopleAction({ lanes: ['owned'] })).toBe(false);
  });
});

describe('selectionMarkets', () => {
  const opt = (canonicalKey: string, label: string, rawValues: string[], memberKeys?: string[]) =>
    ({ canonicalKey, label, rawValues, icon: memberKeys ? 'region' : 'flag', flagCode: null, companyIds: [], memberKeys }) as never;
  const options = [
    opt('germany', 'Germany', ['Germany']),
    opt('hungary', 'Hungary', ['Hungary']),
    opt('india', 'India', ['India']),
    opt('region:europe', 'Europe', [], ['germany', 'hungary']),
  ];
  it('expands a region or a set to its markets', () => {
    expect(selectionMarkets('region:europe', options)?.spellings.sort()).toEqual(['Germany', 'Hungary']);
    expect(selectionMarkets('set:hungary|india', options)?.spellings.sort()).toEqual(['Hungary', 'India']);
    expect(selectionMarkets('india', options)).toEqual({ label: 'India', spellings: ['India'] });
  });
  it('is null for the global view', () => {
    expect(selectionMarkets(null, options)).toBeNull();
    expect(selectionMarkets('__general__', options)).toBeNull();
  });
});
