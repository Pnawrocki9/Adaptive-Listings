/**
 * Two-proportion z-test helper.
 *
 * Extracted from the analytics lift route so Next.js does not complain about
 * non-HTTP exports in a Route Handler file.
 *
 * @module apps/control-plane/src/lib/z-test
 */

/**
 * Approximation of the error function.
 * Abramowitz & Stegun 7.1.26 — max error 1.5e-7.
 */
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return Math.sign(x) * (1 - poly * Math.exp(-x * x));
}

/** Standard normal CDF via erf. */
function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Two-proportion z-test — two-tailed p-value.
 *
 * @param n1 - Total count in arm 1 (adapted).
 * @param k1 - Conversion count in arm 1.
 * @param n2 - Total count in arm 2 (holdout).
 * @param k2 - Conversion count in arm 2.
 * @returns Two-tailed p-value in [0, 1]. Returns 1 when inputs are invalid.
 */
export function zTest(n1: number, k1: number, n2: number, k2: number): number {
  if (n1 <= 0 || n2 <= 0) return 1;
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const p = (k1 + k2) / (n1 + n2);
  const denom = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (denom === 0) return 1;
  const z = (p1 - p2) / denom;
  return 2 * (1 - normalCDF(Math.abs(z)));
}
