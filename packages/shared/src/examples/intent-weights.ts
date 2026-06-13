/**
 * Wire examples for IntentWeightsSchema (ADR-0012 §Wire Contract).
 *
 * These are the four documented payload examples that appear in ADR-0012 and
 * are validated by IntentWeightsSchema. Used in documentation and as test fixtures.
 *
 * Non-test consumer: this file is imported by the documentation build and by
 * any admin tooling that needs sample weight shapes. The FOLLOW-268-write admin
 * API will reference these as defaults in its request body documentation.
 *
 * @module @estalara/shared/examples/intent-weights
 */

import type { IntentWeights } from '../schemas/intent-weights.js';

/**
 * Example 1 — behavioral damping only.
 * Use when you only want to dial down the influence of behavioral signals
 * (e.g. on a high-traffic listing page where behavioral noise is significant).
 */
export const EXAMPLE_DAMPING_ONLY: IntentWeights = {
  behavioral_damping: 0.2,
};

/**
 * Example 2 — priors only (partial).
 * Use when your site over-indexes for yield hunters and you want the initial
 * distribution to reflect that without touching signal weights.
 */
export const EXAMPLE_PRIORS_ONLY: IntentWeights = {
  priors: {
    yield_hunter: 0.08,
    neutral: 0.28,
  },
};

/**
 * Example 3 — all three sub-fields, partial overrides.
 * Use when you have measured click patterns that deviate from SDK defaults.
 */
export const EXAMPLE_ALL_THREE: IntentWeights = {
  behavioral_damping: 0.25,
  priors: {
    family_buyer: 0.07,
    neutral: 0.3,
  },
  signal_likelihoods: {
    'cta.clicked': {
      yield_hunter: 1.2,
    },
    'listing.viewed': {
      portfolio_builder: 1.15,
    },
  },
};

/**
 * Example 4 — empty (SDK defaults for all parameters).
 * Equivalent to not having a configured row — the SDK uses its internal defaults.
 */
export const EXAMPLE_EMPTY: IntentWeights = {};
