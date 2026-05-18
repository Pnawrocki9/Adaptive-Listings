/**
 * Adaptation observability events. Emitted by the SDK adaptation engine
 * (packages/sdk/src/core/adapt.ts) to record when directives were applied
 * or skipped, enabling observability of the personalization layer.
 *
 * @module @estalara/shared/schemas/events/adapt-events
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * `adapt.applied` — a personalization directive was successfully applied to a DOM element.
 *
 * Emitted by: packages/sdk/src/core/adapt.ts (applyTextDirective, applyClassDirective,
 * applyReorderDirective — after DOM mutation succeeds)
 *
 * @example
 * {
 *   type: 'adapt.applied',
 *   payload: {
 *     slot_or_selector: 'hero_headline',
 *     archetype: 'yield_hunter',
 *     confidence: 0.87
 *   }
 * }
 */
export const AdaptAppliedPayloadSchema = z.object({
  /** The slot name (TextDirective), CSS selector (ClassDirective), or
   * container selector (ReorderDirective) that was targeted. */
  slot_or_selector: z.string().min(1),
  /** Archetype ID the directive was generated for. */
  archetype: z.string().min(1),
  /** Confidence score at directive application time (0–1). */
  confidence: z.number().min(0).max(1),
});
export const AdaptAppliedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('adapt.applied'),
  payload: AdaptAppliedPayloadSchema,
});
export type AdaptAppliedEvent = z.infer<typeof AdaptAppliedEventSchema>;
export type AdaptAppliedPayload = z.infer<typeof AdaptAppliedPayloadSchema>;

/**
 * `adapt.skipped` — a directive could not be applied and was intentionally skipped.
 *
 * Reasons include: missing slot elements, disallowed CSS selector, no container
 * found, no listing card children, or an unresolved `{token}` placeholder.
 *
 * Emitted by: packages/sdk/src/core/adapt.ts (interpolatePlaceholders,
 * applyTextDirective, applyClassDirective, applyReorderDirective)
 *
 * @example
 * {
 *   type: 'adapt.skipped',
 *   payload: { reason: 'no_slot_elements', slot_or_selector: 'hero_headline' }
 * }
 */
export const AdaptSkippedPayloadSchema = z.object({
  /**
   * Machine-readable reason code explaining why the directive was skipped.
   * Known values: 'no_slot_elements', 'disallowed_selector', 'no_container',
   * 'no_cards', 'unresolved_token_<name>' (dynamic, one per token name).
   * z.string() is used (not z.enum) to allow forward-compat token names.
   */
  reason: z.string().min(1),
  /** The slot name, CSS selector, or container selector that was targeted. */
  slot_or_selector: z.string().min(1),
});
export const AdaptSkippedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('adapt.skipped'),
  payload: AdaptSkippedPayloadSchema,
});
export type AdaptSkippedEvent = z.infer<typeof AdaptSkippedEventSchema>;
export type AdaptSkippedPayload = z.infer<typeof AdaptSkippedPayloadSchema>;
