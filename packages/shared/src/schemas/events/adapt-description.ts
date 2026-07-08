/**
 * Long-form description + per-listing headline adaptation observability events (ADR-0009).
 *
 * Emitted by the SDK description-adaptation engine
 * (packages/sdk/src/core/adapt-description.ts) to record whether an archetype-adapted
 * listing description / headline was applied, skipped, re-asserted after a framework
 * revert, or failed to fetch. Without these types in `EventSchema`, ingest silently
 * rejects them and description-adaptation observability is blind in production
 * (FOLLOW-461 / audit F-04).
 *
 * The `type` literals and payload shapes below mirror the SDK emit sites BYTE-FOR-BYTE
 * (verified field-by-field against packages/sdk/src/core/adapt-description.ts):
 *
 *   `adapt.description.applied`         — emit `{ listing_id, archetype }`
 *   `adapt.description.skipped`         — emit `{ reason: 'neutral' }` / `{}`
 *   `adapt.description.error`           — emit `{ reason, status? }`
 *   `adapt.description.re`              — reapply emit `{}`
 *   `adapt.description.headline.applied`— headline emit `{ listing_id, archetype }`
 *   `adapt.description.headline.re`     — headline reapply emit `{}`
 *
 * Per ADR-0003 payload validation is lenient (unknown fields ignored, not rejected), so
 * these use non-strict `z.object` — additive SDK payload changes will not break ingest.
 *
 * @module @estalara/shared/schemas/events/adapt-description
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * `adapt.description.applied` — an archetype-adapted long-form description was written
 * into every `[data-estalara-slot="description"]` element on the page.
 *
 * Emitted by: packages/sdk/src/core/adapt-description.ts (applyDescriptionAdaptation,
 * final emit after all slots are written).
 *
 * @example
 * { type: 'adapt.description.applied', payload: { listing_id: 'listing-001', archetype: 'yield_hunter' } }
 */
export const AdaptDescriptionAppliedPayloadSchema = z.object({
  /** Listing the adapted description was applied to (from data-estalara-listing-id). */
  listing_id: z.string().min(1),
  /** Archetype ID the description was generated for (never 'neutral' — that path skips). */
  archetype: z.string().min(1),
});
export const AdaptDescriptionAppliedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('adapt.description.applied'),
  payload: AdaptDescriptionAppliedPayloadSchema,
});
export type AdaptDescriptionAppliedEvent = z.infer<typeof AdaptDescriptionAppliedEventSchema>;
export type AdaptDescriptionAppliedPayload = z.infer<typeof AdaptDescriptionAppliedPayloadSchema>;

/**
 * `adapt.description.skipped` — description adaptation was intentionally not applied.
 *
 * Emitted with `{ reason: 'neutral' }` when the archetype is 'neutral', or with `{}` when
 * the fetch returned a non-adaptable response (source !== 'ai_cached' or empty description).
 *
 * Emitted by: packages/sdk/src/core/adapt-description.ts (applyDescriptionAdaptation).
 *
 * @example
 * { type: 'adapt.description.skipped', payload: { reason: 'neutral' } }
 */
export const AdaptDescriptionSkippedPayloadSchema = z.object({
  /** Optional machine-readable reason. Currently only 'neutral'; absent for a non-adaptable
   * fetch result. z.string() (not z.enum) keeps forward-compat with new reason codes. */
  reason: z.string().min(1).optional(),
});
export const AdaptDescriptionSkippedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('adapt.description.skipped'),
  payload: AdaptDescriptionSkippedPayloadSchema,
});
export type AdaptDescriptionSkippedEvent = z.infer<typeof AdaptDescriptionSkippedEventSchema>;
export type AdaptDescriptionSkippedPayload = z.infer<typeof AdaptDescriptionSkippedPayloadSchema>;

/**
 * `adapt.description.error` — the description fetch failed (network, HTTP, or bad response).
 *
 * Guardrail K.2: description-fetch failures are surfaced as an observable event rather than
 * swallowed silently. `status` is present only for the `http_err` reason.
 *
 * Emitted by: packages/sdk/src/core/adapt-description.ts (fetchDescription).
 * Reason codes: 'ne' (network error), 'http_err' (non-2xx), 'br' (bad/unparseable response).
 *
 * @example
 * { type: 'adapt.description.error', payload: { reason: 'http_err', status: 500 } }
 */
export const AdaptDescriptionErrorPayloadSchema = z.object({
  /** Machine-readable failure reason: 'ne' | 'http_err' | 'br'. z.string() for forward-compat. */
  reason: z.string().min(1),
  /** HTTP status code — present only when reason === 'http_err'. */
  status: z.number().int().optional(),
});
export const AdaptDescriptionErrorEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('adapt.description.error'),
  payload: AdaptDescriptionErrorPayloadSchema,
});
export type AdaptDescriptionErrorEvent = z.infer<typeof AdaptDescriptionErrorEventSchema>;
export type AdaptDescriptionErrorPayload = z.infer<typeof AdaptDescriptionErrorPayloadSchema>;

/**
 * `adapt.description.re` — the adapted description was re-asserted into a slot after a
 * framework re-render (SvelteKit/React/Vue reconciliation) reverted it.
 *
 * Payload is intentionally empty — this is a bare convergence-count signal.
 *
 * Emitted by: packages/sdk/src/core/adapt-description.ts (applyAndObserveSlot reapply).
 *
 * @example
 * { type: 'adapt.description.re', payload: {} }
 */
export const AdaptDescriptionReappliedPayloadSchema = z.object({});
export const AdaptDescriptionReappliedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('adapt.description.re'),
  payload: AdaptDescriptionReappliedPayloadSchema,
});
export type AdaptDescriptionReappliedEvent = z.infer<typeof AdaptDescriptionReappliedEventSchema>;
export type AdaptDescriptionReappliedPayload = z.infer<
  typeof AdaptDescriptionReappliedPayloadSchema
>;

/**
 * `adapt.description.headline.applied` — an archetype-adapted per-listing headline (ADR-0009)
 * was written into every `[data-estalara-slot="headline"]` element on the page.
 *
 * Emitted by: packages/sdk/src/core/adapt-description.ts (applyDescriptionAdaptation, after
 * headline slots are written).
 *
 * @example
 * { type: 'adapt.description.headline.applied', payload: { listing_id: 'listing-001', archetype: 'yield_hunter' } }
 */
export const AdaptDescriptionHeadlineAppliedPayloadSchema = z.object({
  /** Listing the adapted headline was applied to. */
  listing_id: z.string().min(1),
  /** Archetype ID the headline was generated for. */
  archetype: z.string().min(1),
});
export const AdaptDescriptionHeadlineAppliedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('adapt.description.headline.applied'),
  payload: AdaptDescriptionHeadlineAppliedPayloadSchema,
});
export type AdaptDescriptionHeadlineAppliedEvent = z.infer<
  typeof AdaptDescriptionHeadlineAppliedEventSchema
>;
export type AdaptDescriptionHeadlineAppliedPayload = z.infer<
  typeof AdaptDescriptionHeadlineAppliedPayloadSchema
>;

/**
 * `adapt.description.headline.re` — the adapted headline was re-asserted into a slot after a
 * framework re-render reverted it.
 *
 * Payload is intentionally empty — a bare convergence-count signal.
 *
 * Emitted by: packages/sdk/src/core/adapt-description.ts (applyAndObserveHeadlineSlot reapply).
 *
 * @example
 * { type: 'adapt.description.headline.re', payload: {} }
 */
export const AdaptDescriptionHeadlineReappliedPayloadSchema = z.object({});
export const AdaptDescriptionHeadlineReappliedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('adapt.description.headline.re'),
  payload: AdaptDescriptionHeadlineReappliedPayloadSchema,
});
export type AdaptDescriptionHeadlineReappliedEvent = z.infer<
  typeof AdaptDescriptionHeadlineReappliedEventSchema
>;
export type AdaptDescriptionHeadlineReappliedPayload = z.infer<
  typeof AdaptDescriptionHeadlineReappliedPayloadSchema
>;
