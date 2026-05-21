/**
 * Thompson sampling bandit for adaptation variant selection.
 *
 * Implements Master Design E.3.1 — per-archetype multi-armed bandit using
 * Thompson sampling on Beta posteriors.
 *
 * Algorithm:
 *   For each (archetype, variant) pair, sample θ ~ Beta(alpha, beta).
 *   Return the variant with the highest sampled θ.
 *
 * The Beta distribution is approximated using the Johnk method (ratio of
 * two gamma variates) which is computable without external libraries.
 *
 * Shared module so both `apps/decision-api` (Worker) and `apps/control-plane`
 * (Next.js) can import the same algorithm without cross-app imports.
 * See FOLLOW-007 for the wiring story. `apps/decision-api/src/lib/bandit.ts`
 * re-exports from this module to preserve its public surface.
 *
 * @module @estalara/shared/bandit
 */

/**
 * A bandit arm with Beta distribution parameters.
 */
export interface BanditArm {
  variant: string;
  alpha: number;
  beta: number;
  /** When true, this variant is paused — will never be selected by sampling. */
  paused?: boolean;
}

/**
 * Samples from a Beta(alpha, beta) distribution using Johnk's method.
 *
 * Johnk (1954): sample X ~ Gamma(alpha, 1) and Y ~ Gamma(beta, 1),
 * then B = X / (X + Y) ~ Beta(alpha, beta).
 *
 * We approximate Gamma samples by summing exponential variates
 * (valid for integer shape parameters, approximate for non-integer).
 * For small integer shape parameters (α, β typically 1–100 in early experiments)
 * this is accurate and fast.
 *
 * For large shape parameters (α + β > 200) we use a normal approximation
 * to the Beta distribution for performance.
 *
 * @param alpha - Beta alpha parameter (must be > 0).
 * @param beta  - Beta beta parameter (must be > 0).
 * @returns     A sample from Beta(alpha, beta) in (0, 1).
 */
export function sampleBeta(alpha: number, beta: number): number {
  if (alpha <= 0 || beta <= 0) {
    throw new RangeError(
      `sampleBeta: alpha and beta must be > 0, got alpha=${String(alpha)} beta=${String(beta)}`,
    );
  }

  const total = alpha + beta;

  // For large total, use normal approximation to Beta.
  if (total > 200) {
    const mean = alpha / total;
    const variance = (alpha * beta) / (total * total * (total + 1));
    const std = Math.sqrt(variance);
    // Box-Muller normal sample.
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-300)) * Math.cos(2 * Math.PI * u2);
    return Math.max(1e-9, Math.min(1 - 1e-9, mean + std * z));
  }

  // Johnk's method: B = X / (X + Y) where X ~ Gamma(alpha), Y ~ Gamma(beta).
  // Approximate Gamma by summing exponential variates (Gamma(k, 1) = sum of k Exp(1)).
  // For non-integer shape we use the integer floor and add the fractional part via
  // the Wilson-Hilferty approximation.
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  const sum = x + y;
  if (sum === 0) return 0.5;
  return x / sum;
}

/**
 * Samples from Gamma(shape, 1) using Marsaglia-Tsang method (valid for shape ≥ 1)
 * or Ahrens-Dieter for shape < 1.
 */
export function sampleGamma(shape: number): number {
  if (shape < 1) {
    // Ahrens-Dieter: Gamma(shape) = Gamma(shape + 1) * U^(1/shape)
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }

  // Marsaglia-Tsang method (shape ≥ 1).
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  for (;;) {
    let x: number;
    let v: number;
    do {
      // Box-Muller normal sample.
      const u1 = Math.random();
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1 + 1e-300)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = Math.random();

    // Squeeze test.
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    // Logarithm test.
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Selects the best variant for an archetype using Thompson sampling.
 *
 * Paused variants are excluded from selection. If all variants are paused,
 * returns null (caller should serve default experience).
 *
 * @param arms - Array of bandit arms (one per variant).
 * @returns    The selected variant name, or null if all arms are paused.
 */
export function thompsonSample(arms: BanditArm[]): string | null {
  const activeArms = arms.filter((arm) => !arm.paused);
  if (activeArms.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length === 1 checked above
  if (activeArms.length === 1) return activeArms[0]!.variant;

  // activeArms.length >= 2 guaranteed by the length checks above.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length checked above
  const firstArm = activeArms[0]!;
  let bestVariant = firstArm.variant;
  let bestSample = sampleBeta(firstArm.alpha, firstArm.beta);

  for (let i = 1; i < activeArms.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounds checked by loop
    const arm = activeArms[i]!;
    const sample = sampleBeta(arm.alpha, arm.beta);
    if (sample > bestSample) {
      bestSample = sample;
      bestVariant = arm.variant;
    }
  }

  return bestVariant;
}

/**
 * Computes updated Beta parameters after observing a conversion signal.
 *
 * @param alpha      - Current alpha parameter.
 * @param beta       - Current beta parameter.
 * @param converted  - Whether a conversion was observed.
 * @returns          Updated { alpha, beta }.
 */
export function updateBanditArm(
  alpha: number,
  beta: number,
  converted: boolean,
): { alpha: number; beta: number } {
  return converted ? { alpha: alpha + 1, beta } : { alpha, beta: beta + 1 };
}
