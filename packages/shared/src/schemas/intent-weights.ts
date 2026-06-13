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

// ─── Canonical key sets ───────────────────────────────────────────────────────

/**
 * All 18 valid archetype keys. Derived from `ARCHETYPE_NAMES` in
 * `packages/sdk/src/core/intent.ts` — do NOT add keys here without adding the
 * corresponding archetype to the SDK's `Archetype` union and `ARCHETYPE_NAMES`.
 */
export const ARCHETYPE_KEYS = [
  // Investors
  'yield_hunter',
  'vacation_rental_investor',
  'flip_investor',
  'portfolio_builder',
  'golden_visa_buyer',
  'commercial_investor',
  // Own use
  'family_buyer',
  'first_time_buyer',
  'upsizer',
  'downsizer',
  'luxury_buyer',
  'remote_worker',
  // Special / cross-border
  'lifestyle_expat',
  'retiree_relocator',
  'diaspora_buyer',
  'second_home_buyer',
  'student_parent',
  // Fallback
  'neutral',
] as const;

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
