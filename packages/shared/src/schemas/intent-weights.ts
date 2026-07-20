/**
 * Canonical intent weights schema — shared between the control-plane write API
 * (FOLLOW-268-write) and the SDK weight-application path (FOLLOW-268-sdk).
 *
 * This file is the single source of truth for valid archetype and intent signal
 * key sets. All consumers (Postgres validator, SDK parser) import from here to
 * prevent the key-list drift pattern documented in RETRO-053/055.
 *
 * Key design decisions (ADR-0012 §2):
 *   - All three sub-fields are optional — partial overrides are valid.
 *   - `.strict()` rejects the previously-invented keys that had no SDK consumers
 *     (`quiz_answer`, `chat_turn`, `dwell`, `pageview`, `referrer`, `filter_applied`).
 *   - `priors` values must be positive; the SDK normalizes to sum-to-1 after merge,
 *     so absolute magnitudes are relative — only ratios matter.
 *   - `behavioral_damping` must be in (0, 1]; 1.0 = no damping, 0.3 = SDK default.
 *   - `signal_likelihoods` per-archetype values must be positive; 1.0 = no information.
 *
 * Non-test consumers (Rule H):
 *   - apps/control-plane/src/app/api/intent/config/route.ts (weight query response)
 *
 * @module @estalara/shared/schemas/intent-weights
 */

import { z } from 'zod';

import { CANONICAL_ARCHETYPE_IDS } from '../archetypes.js';

// ─── Canonical key sets ───────────────────────────────────────────────────────

/**
 * All 18 valid archetype keys.
 *
 * Derived from `CANONICAL_ARCHETYPE_IDS` (`../archetypes.js`), the single canonical
 * source of this list within `packages/shared` (FOLLOW-584/FOLLOW-586). That array
 * is itself kept in sync with `ARCHETYPE_NAMES` in `packages/sdk/src/core/intent.ts`
 * — do NOT add keys here; add them to `archetypes.ts`. Order/parity is guarded by
 * `packages/sdk/src/__tests__/intent-weights-drift.test.ts` and
 * `packages/shared/src/__tests__/archetype-canonical-parity.test.ts`.
 */
export const ARCHETYPE_KEYS = CANONICAL_ARCHETYPE_IDS;

export type ArchetypeKey = (typeof ARCHETYPE_KEYS)[number];

/**
 * All 13 valid behavioral signal keys. Derived from the keys of `SIGNAL_LIKELIHOODS`
 * in `packages/sdk/src/core/intent.ts` — do NOT add keys here without adding the
 * corresponding entry to the SDK's `SIGNAL_LIKELIHOODS` table.
 *
 * Note: `filter.applied` is handled as a payload-conditional intercept in the SDK
 * and does NOT appear in `SIGNAL_LIKELIHOODS`, so it is not overridable via the
 * server weight API in v1.
 */
export const INTENT_SIGNAL_KEYS = [
  'scroll.depth',
  'listing.viewed',
  'cta.clicked',
  'quiz.event',
  'listing.bookmarked',
  'device_type.desktop',
  'device_type.mobile',
  'micro_poll.answered',
  'photo.dwell',
  'feature.expanded',
  'mortgage_calc.used',
  'price.compared',
  'inquiry.started',
] as const;

export type IntentSignalKey = (typeof INTENT_SIGNAL_KEYS)[number];

// ─── IntentWeightsSchema ──────────────────────────────────────────────────────

/**
 * Canonical wire schema for intent weight overrides served by
 * `GET /api/intent/config` and written by the FOLLOW-268-write admin API.
 *
 * All three sub-fields are optional. A weights object may supply any combination
 * of the three. Missing sub-fields mean "use SDK defaults for that parameter."
 *
 * `.strict()` rejects any key not declared below — prevents silent acceptance of
 * the previously-invented keys (`quiz_answer`, `chat_turn`, `dwell`, `pageview`,
 * `referrer`, `filter_applied`) that had no SDK consumers.
 */
export const IntentWeightsSchema = z
  .object({
    /**
     * Per-archetype prior probability overrides. Values must be > 0.
     * The SDK normalizes to sum-to-1 after merging with its internal BASE_PRIOR,
     * so absolute magnitudes are relative — only ratios matter. Partial records are
     * accepted; unspecified archetypes retain their SDK-internal BASE_PRIOR value.
     * All keys must be valid ArchetypeKey values.
     */
    priors: z.record(z.enum(ARCHETYPE_KEYS), z.number().positive()).optional(),

    /**
     * Behavioral damping scalar applied to all SIGNAL_LIKELIHOODS before the
     * multiplicative Bayesian update. Must be in (0, 1].
     * Value 1.0 = no damping (raw likelihood applied).
     * Value 0.3 = SDK default (BEHAVIORAL_DAMPING).
     */
    behavioral_damping: z.number().positive().max(1).optional(),

    /**
     * Per-signal-type likelihood overrides. Keys must be valid IntentSignalKey values.
     * Values are per-archetype likelihood multipliers (> 0; 1.0 = no information for
     * that archetype from this signal). Partial records are accepted; unspecified signal
     * types retain their SDK-internal SIGNAL_LIKELIHOODS values. Unspecified archetypes
     * within a given signal entry default to 1.0 (no information).
     *
     * Note: `listing.bookmarked`, `micro_poll.answered`, `feature.expanded`, and
     * `filter.applied` have payload-conditional intercepts in the SDK that run before
     * the SIGNAL_LIKELIHOODS lookup. Server-supplied likelihoods for these signals
     * apply to the base (non-payload-conditional) component only. The payload-conditional
     * boosts are not overridable in v1.
     */
    signal_likelihoods: z
      .record(z.enum(INTENT_SIGNAL_KEYS), z.record(z.enum(ARCHETYPE_KEYS), z.number().positive()))
      .optional(),
  })
  .strict();

export type IntentWeights = z.infer<typeof IntentWeightsSchema>;

// ─── Canonical default weights ─────────────────────────────────────────────────

/**
 * Canonical default intent weights — the project-agreed starting point the
 * Weight Editor pre-loads and resets to.
 *
 * Values mirror the SDK's internal constants in `packages/sdk/src/core/intent.ts`:
 *   - `priors` = `BASE_PRIOR` (Master Design §D distribution: 6 investor + 6 own-use
 *     archetypes at 0.04, 5 special at 0.03, `neutral` 0.37 — sums to 1.00).
 *   - `behavioral_damping` = `BEHAVIORAL_DAMPING` (0.3).
 *   - `signal_likelihoods` is intentionally omitted: an empty/absent value means the
 *     SDK applies its internal `SIGNAL_LIKELIHOODS` table, which is NOT overridable to
 *     a meaningful default here (it is a large per-signal/per-archetype matrix). Reset
 *     therefore clears any operator overrides back to SDK defaults.
 *
 * The SDK's `BASE_PRIOR` remains the runtime source of truth for the SDK itself; this
 * constant restates it for the admin contract. The cross-package drift guard
 * (`packages/sdk/src/__tests__/intent-weights-drift.test.ts`, FOLLOW-331) imports
 * BOTH this constant and the SDK's exported `BASE_PRIOR`/`BEHAVIORAL_DAMPING` and
 * asserts full equality — so any divergence is caught in CI.
 */
export const DEFAULT_INTENT_WEIGHTS: IntentWeights = {
  behavioral_damping: 0.3,
  priors: {
    // Investors (each 0.04)
    yield_hunter: 0.04,
    vacation_rental_investor: 0.04,
    flip_investor: 0.04,
    portfolio_builder: 0.04,
    golden_visa_buyer: 0.04,
    commercial_investor: 0.04,
    // Own use (each 0.04)
    family_buyer: 0.04,
    first_time_buyer: 0.04,
    upsizer: 0.04,
    downsizer: 0.04,
    luxury_buyer: 0.04,
    remote_worker: 0.04,
    // Special / cross-border (each 0.03)
    lifestyle_expat: 0.03,
    retiree_relocator: 0.03,
    diaspora_buyer: 0.03,
    second_home_buyer: 0.03,
    student_parent: 0.03,
    // Fallback
    neutral: 0.37,
  },
};
