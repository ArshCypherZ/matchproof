/* One documented tone rule for every KPI band, live and benchmark, so a
   green dot means the same thing in both sections (critique: live rates
   were green at any non-zero value while the benchmark's twin coverage
   metric read amber at 37%). */

/* A rate earns "safe" only from 75% up — three of four outcomes — so a
   degrading rate loses its green before it reaches zero: a 20% resolution
   rate reads "needs attention" today, not "healthy". The benchmark's
   pinned verdicts independently agree with this bar (100% accuracy
   clears it, 37% coverage falls under it). */
export const RATE_SAFE_THRESHOLD = 0.75;

export function rateTone(rate: number | null) {
  if (rate === null) return "default" as const;
  return rate >= RATE_SAFE_THRESHOLD ? ("safe" as const) : ("warning" as const);
}

/* Count bands follow a 0-vs-nonzero rule: a dot appears only when the
   count is non-zero. A green dot beside "Verified 0" would contradict the
   amber one on "Resolution rate 0%", and a red dot on "Unsafe
   recommendations 0" alarms on a healthy state. */
export function countTone(
  value: number | null,
  tone: "warning" | "safe" | "destructive",
) {
  return value !== null && value > 0 ? tone : ("default" as const);
}
