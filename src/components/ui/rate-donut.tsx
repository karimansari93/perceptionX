/** Small donut showing a 0–1 rate (e.g. share of answers mentioning the
 *  company). Used in the Source / Response / Theme detail modal stat strips. */
export const RateDonut = ({ rate, size = 30 }: { rate: number; size?: number }) => {
  const stroke = 3;
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, rate));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EBECED" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#0DBCBA"
        strokeWidth={stroke}
        strokeDasharray={`${c * pct} ${c}`}
        strokeLinecap="round"
        className="transition-all duration-500"
      />
    </svg>
  );
};
