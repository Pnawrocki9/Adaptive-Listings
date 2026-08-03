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
 * found, no listing card children, an unresolved `{token}` placeholder, or (FOLLOW-791)
 * `'stale'` — a rapid cross-listing navigation superseded a pending MutationObserver
 * repair before it could re-write the DOM (Rule AB latest-wins guard).
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
   * 'no_cards', 'unresolved_token_<name>' (dynamic, one per token name), 'stale'
   * (FOLLOW-791 — superseded by a newer cross-listing navigation).
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

/**
 * `adapt.reapplied` — a directive was re-asserted into the DOM after a framework
 * revert (React/Svelte/Vue reconciliation) reverted the SDK's original write.
 *
 * FOLLOW-791: the generic directive pipeline (`applyTextDirective`,
 * `applyClassDirective`, `applyReorderDirective`) previously wrote once and never
 * looked again — a framework re-render could silently, permanently revert the
 * adaptation for the rest of the session while `adapt.applied` had already told the
 * pipeline the write succeeded. This event distinguishes a REPAIR from the original
 * `adapt.applied` so observability (and downstream consumers) can tell the two apart,
 * mirroring `adapt.description.re` / `adapt.description.headline.re`
 * (packages/sdk/src/core/adapt-description.ts, FOLLOW-548 / Rule AB).
 *
 * Emitted by: packages/sdk/src/core/adapt.ts (attachResilience's `reapply` closure,
 * shared by applyTextDirective, applyClassDirective, applyReorderDirective).
 *
 * @example
 * {
 *   type: 'adapt.reapplied',
 *   payload: { slot_or_selector: 'hero_headline', archetype: 'yield_hunter', confidence: 0.87 }
 * }
 */
export const AdaptReappliedPayloadSchema = z.object({
  /** The slot name (TextDirective), CSS selector (ClassDirective), or
   * container selector (ReorderDirective) that was re-asserted. */
  slot_or_selector: z.string().min(1),
  /** Archetype ID the directive was generated for. */
  archetype: z.string().min(1),
  /** Confidence score at directive application time (0–1). */
  confidence: z.number().min(0).max(1),
});
export const AdaptReappliedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('adapt.reapplied'),
  payload: AdaptReappliedPayloadSchema,
});
export type AdaptReappliedEvent = z.infer<typeof AdaptReappliedEventSchema>;
export type AdaptReappliedPayload = z.infer<typeof AdaptReappliedPayloadSchema>;
