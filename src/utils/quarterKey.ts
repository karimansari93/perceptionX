// THE quarter-bucketing rule for dashboard periods: "YYYY-Qn" of a
// "YYYY-MM..." month string. Shared so the scope-stats cube filter and the
// raw-row period logic can never diverge (it previously lived inside
// useDashboardData, forcing duplicates to avoid import cycles).
export const quarterKeyOfMonthStr = (s: string): string | null => {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  if (!y || !m) return null;
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
};
