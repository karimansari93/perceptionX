// Score bands: what a score means, in words. Mirrors
// supabase/functions/_shared/px-tools/bands.ts (the email and Ask AI read
// that copy); keep the two identical. Cut-offs are set against where
// measured brands land since the July 2026 methodology change: the top
// tenth is Excellent, above the median Strong, below it Fair, the bottom
// fifth Needs improvement. Agreed with Karim, 2026-10-28.

export type BandMetric = 'eps' | 'sentiment' | 'visibility' | 'relevance';
export type BandLabel = 'Excellent' | 'Strong' | 'Fair' | 'Needs improvement';

const CUTS: Record<BandMetric, [number, number, number]> = {
  eps: [80, 75, 70],
  sentiment: [80, 70, 60],
  visibility: [85, 78, 70],
  relevance: [85, 78, 70],
};

export function bandLabel(metric: BandMetric, value: number | null | undefined): BandLabel | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const [a, b, c] = CUTS[metric];
  return value >= a ? 'Excellent' : value >= b ? 'Strong' : value >= c ? 'Fair' : 'Needs improvement';
}

export function bandScale(metric: BandMetric): string {
  const [a, b, c] = CUTS[metric];
  return `Excellent ${a}+ · Strong ${b} to ${a - 1} · Fair ${c} to ${b - 1} · Needs improvement under ${c}`;
}
