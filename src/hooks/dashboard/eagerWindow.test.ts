import { describe, expect, it } from 'vitest';
import { eagerCutoffIso, latestResponseDay, type ScopeStats } from './dashboardQueries';

const DAY = 24 * 60 * 60 * 1000;
const stats = (daily: string[], months: string[] = []): ScopeStats =>
  ({
    daily: daily.map(tested_day => ({ tested_day })),
    scope: months.map(response_month => ({ response_month })),
    prompt_types: [],
    llm: [],
  }) as unknown as ScopeStats;

describe('eager window anchor', () => {
  it('anchors on the latest tested day, not today', () => {
    const cutoff = eagerCutoffIso('2026-03-25');
    expect(cutoff.slice(0, 10)).toBe('2025-09-26');
  });

  it('falls back to now minus the window without an anchor', () => {
    const cutoff = Date.parse(eagerCutoffIso(null));
    expect(Math.abs(cutoff - (Date.now() - 180 * DAY))).toBeLessThan(5000);
  });

  it('never anchors in the future', () => {
    const cutoff = Date.parse(eagerCutoffIso('2999-01-01'));
    expect(Math.abs(cutoff - (Date.now() - 180 * DAY))).toBeLessThan(5000);
  });

  it('keeps a scope last collected before the window visible', () => {
    const latest = latestResponseDay(stats(['2026-03-24', '2026-03-25', '2025-12-10']));
    expect(latest).toBe('2026-03-25');
    expect('2026-03-25' >= eagerCutoffIso(latest).slice(0, 10)).toBe(true);
  });

  it('falls back to the latest month, then to null', () => {
    expect(latestResponseDay(stats([], ['2025-11-01', '2026-03-01']))).toBe('2026-03-01');
    expect(latestResponseDay(stats([]))).toBeNull();
    expect(latestResponseDay(undefined)).toBeNull();
  });
});
