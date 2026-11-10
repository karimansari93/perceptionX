import { describe, expect, it } from 'vitest';
import { reviewGrowthAround, reviewsPerWeek } from './api';

const snap = (captured_on: string, review_count: number) => ({ captured_on, review_count });

describe('reviewsPerWeek', () => {
  it('needs two counts at least a week apart', () => {
    expect(reviewsPerWeek([])).toBeNull();
    expect(reviewsPerWeek([snap('2026-11-01', 100)])).toBeNull();
    expect(reviewsPerWeek([snap('2026-11-01', 100), snap('2026-11-05', 104)])).toBeNull();
  });

  it('is the change per 7 days between first and last count, in any order', () => {
    expect(reviewsPerWeek([snap('2026-11-15', 120), snap('2026-11-01', 100)])).toBe(10);
  });
});

describe('reviewGrowthAround', () => {
  it('splits at launch and starts the after window from the last pre-launch count', () => {
    const snaps = [
      snap('2026-10-04', 90),
      snap('2026-10-18', 100), // 5 a week before
      snap('2026-11-01', 120), // 10 a week after
    ];
    expect(reviewGrowthAround(snaps, '2026-10-20T09:00:00Z')).toEqual({ before: 5, after: 10 });
  });

  it('a count taken on launch day anchors both windows', () => {
    const snaps = [snap('2026-10-04', 90), snap('2026-10-18', 100), snap('2026-11-01', 107)];
    expect(reviewGrowthAround(snaps, '2026-10-18')).toEqual({ before: 5, after: 3.5 });
  });

  it('has no before rate when counting started after launch', () => {
    const snaps = [snap('2026-11-01', 100), snap('2026-11-15', 110)];
    expect(reviewGrowthAround(snaps, '2026-10-01')).toEqual({ before: null, after: 5 });
  });
});
