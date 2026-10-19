/**
 * Wilson score interval for a binomial proportion — the statistic behind the quiz accuracy
 * criterion (MASTER_DESIGN §E.4.8 v3.0, decision Q-J, FOLLOW-1356).
 *
 * The pre-registered criterion: n = 400 resolved runs on one `definition_hash`, two-sided 95 %
 * Wilson LOWER bound of A = confirmed / (confirmed + corrected) ≥ 0.90, i.e. ≥ 372/400
 * (371/400 fails). Wilson (not the normal approximation) because it stays inside [0, 1] and is
 * well-behaved for p near 1 and moderate n.
 *
 * Consumers: the quiz-accuracy report and verdict (`PASS | FAIL | FUTILE | INSUFFICIENT_N`)
 * in the backoffice, FOLLOW-1365 / Q8 (`wilsonInterval`, `minSuccessesForLowerBound`,
 * `minSampleForObservedRate`).
 *
 * @module @estalara/shared/stats/wilson
 */

/** Two-sided 95 % normal quantile. */
export const Z_95 = 1.959964;

/** A Wilson interval and the observed proportion. */
export interface WilsonInterval {
  /** Lower bound, in [0, 1]. */
  lo: number;
  /** Upper bound, in [0, 1]. */
  hi: number;
  /** Observed proportion `successes / n` (0 when `n` is 0). */
  p: number;
}

/**
 * Wilson score interval for `successes` out of `n` trials.
 *
 * @param successes - number of successes, 0 ≤ successes ≤ n.
 * @param n - number of trials (n = 0 returns the uninformative `[0, 1]`).
 * @param z - normal quantile, default two-sided 95 % (1.959964).
 * @throws RangeError when `successes` is outside `[0, n]` or either is not an integer.
 */
export function wilsonInterval(successes: number, n: number, z: number = Z_95): WilsonInterval {
  if (!Number.isInteger(successes) || !Number.isInteger(n) || successes < 0 || successes > n) {
    throw new RangeError(
      `wilsonInterval: need integers with 0 <= successes <= n (${String(successes)}/${String(n)})`,
    );
  }
  if (n === 0) return { lo: 0, hi: 1, p: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half), p };
}

/**
 * Smallest number of successes out of `n` whose Wilson lower bound is ≥ `bound`
 * (`n = 400`, `bound = 0.9` → 372).
 *
 * @returns the smallest such `k`, or `null` when even `n/n` does not reach `bound`.
 */
export function minSuccessesForLowerBound(
  n: number,
  bound: number,
  z: number = Z_95,
): number | null {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(`minSuccessesForLowerBound: bad n ${String(n)}`);
  if (wilsonInterval(n, n, z).lo < bound) return null;
  let lo = 0;
  let hi = n; // invariant: lower bound at `hi` clears `bound`; the lower bound is monotone in k
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (wilsonInterval(mid, n, z).lo >= bound) hi = mid;
    else lo = mid + 1;
  }
  return hi;
}

/**
 * Smallest sample size `n` at which an OBSERVED rate `rate` (rounded to a whole number of
 * successes, `round(rate * n) / n`) already has a Wilson lower bound ≥ `bound` — how many
 * resolved runs are needed if the true accuracy turns out to be about `rate`.
 *
 * @param rate - observed proportion in (0, 1].
 * @param bound - required lower bound (default 0.90).
 * @param z - normal quantile, default two-sided 95 %.
 * @param maxN - search limit.
 * @returns the smallest such `n`, or `null` if none ≤ `maxN`.
 */
export function minSampleForObservedRate(
  rate: number,
  bound = 0.9,
  z: number = Z_95,
  maxN = 100_000,
): number | null {
  for (let n = 1; n <= maxN; n += 1) {
    if (wilsonInterval(Math.round(rate * n), n, z).lo >= bound) return n;
  }
  return null;
}
