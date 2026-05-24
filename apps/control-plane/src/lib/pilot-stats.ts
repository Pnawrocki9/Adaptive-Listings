/**
 * Pilot CTA-lift statistics helpers.
 *
 * The pilot primary metric is CTA lift: adapted sessions vs the 10% holdout.
 * These helpers compute the two-proportion z-test and classify confidence with
 * the pilot-specific minimum-sample guard (n >= 30 per arm).
 *
 * Extracted into a non-route module so Next.js does not complain about
 * non-HTTP exports in a Route Handler file (same pattern as `@/lib/z-test`).
 *
 * No external statistics libraries — the normal CDF is inlined via the
 * Abramowitz & Stegun error-function approximation (max error 1.5e-7).
 *
 * @module apps/control-plane/src/lib/pilot-stats
 */

/** Minimum sample size per arm required to report a significance verdict. */
export const MIN_SAMPLE_PER_ARM = 30;

/**
 * Error-function approximation — Abramowitz & Stegun 7.1.26 (max error 1.5e-7).
 */
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return Math.sign(x) * (1 - poly * Math.exp(-x * x));
}

/** Standard normal CDF via the error function. */
export function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Two-proportion z-test — two-tailed p-value.
 *
 * Signature matches the pilot spec: proportions and arm sizes are passed
 * directly (p1, n1, p2, n2). Returns 1.0 (no significance) when either arm
 * has fewer than {@link MIN_SAMPLE_PER_ARM} observations or when the pooled
 * standard error is zero.
 *
 * @param p1 - Proportion (rate) in arm 1 (adapted), in [0, 1].
 * @param n1 - Sample size in arm 1.
 * @param p2 - Proportion (rate) in arm 2 (holdout), in [0, 1].
 * @param n2 - Sample size in arm 2.
 * @returns Two-tailed p-value in [0, 1].
 */
export function twoProportionZTest(p1: number, n1: number, p2: number, n2: number): number {
  // Insufficient sample: do not claim significance.
  if (n1 < MIN_SAMPLE_PER_ARM || n2 < MIN_SAMPLE_PER_ARM) return 1.0;

  const pPool = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return 1.0;

  const z = Math.abs(p1 - p2) / se;
  // Two-tailed p-value from the standard normal survival function.
  return 2 * (1 - normalCDF(z));
}

/** Confidence label buckets for the pilot summary panel. */
export type PilotConfidence = '95%' | '90%' | 'not_significant';

/**
 * Classify a p-value into a pilot confidence label, applying the minimum
 * sample guard. With fewer than {@link MIN_SAMPLE_PER_ARM} per arm the result
 * is always `not_significant` regardless of p-value.
 */
export function classifyConfidence(
  pValue: number,
  nAdapted: number,
  nHoldout: number,
): PilotConfidence {
  if (nAdapted < MIN_SAMPLE_PER_ARM || nHoldout < MIN_SAMPLE_PER_ARM) {
    return 'not_significant';
  }
  if (pValue < 0.05) return '95%';
  if (pValue < 0.1) return '90%';
  return 'not_significant';
}

/**
 * Relative lift in percent: (adaptedRate - holdoutRate) / holdoutRate * 100.
 * Returns null when the holdout rate is zero (no holdout conversions yet) to
 * avoid a division-by-zero / Infinity result.
 */
export function relativeLiftPct(adaptedRate: number, holdoutRate: number): number | null {
  if (holdoutRate === 0) return null;
  return ((adaptedRate - holdoutRate) / holdoutRate) * 100;
}
