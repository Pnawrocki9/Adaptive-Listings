/**
 * Price and feature focus events. Master Design C.1 row 5.
 *
 * Throughput: 5–30 per session.
 *
 * @module @estalara/shared/schemas/events/price-feature
 */

import { z } from 'zod';

import { EventEnvelopeSchema } from '../event.js';

/**
 * `price.hovered` — pointer dwelled on the listing's price element ≥500ms.
 *
 * @example { type: 'price.hovered', payload: { price: 285000, currency: 'EUR', dwell_ms: 1400 } }
 */
export const PriceHoveredPayloadSchema = z.object({
  price: z.number().nonnegative(),
  currency: z.string().length(3),
  dwell_ms: z.number().int().nonnegative().optional(),
});
export const PriceHoveredEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('price.hovered'),
  payload: PriceHoveredPayloadSchema,
});
export type PriceHoveredEvent = z.infer<typeof PriceHoveredEventSchema>;

/**
 * `price.compared` — listing's price viewed alongside another listing (compare modal).
 *
 * @example { type: 'price.compared', payload: { against_listing_id: 'l_99', delta_pct: 12.5 } }
 */
export const PriceComparedPayloadSchema = z.object({
  against_listing_id: z.string().min(1),
  delta_pct: z.number().optional(),
});
export const PriceComparedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('price.compared'),
  payload: PriceComparedPayloadSchema,
});
export type PriceComparedEvent = z.infer<typeof PriceComparedEventSchema>;

/**
 * `feature.expanded` — user expanded a feature row / amenity disclosure.
 *
 * @example { type: 'feature.expanded', payload: { feature: 'energy_certificate', label: 'B' } }
 */
export const FeatureExpandedPayloadSchema = z.object({
  feature: z.string().min(1),
  label: z.string().optional(),
});
export const FeatureExpandedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('feature.expanded'),
  payload: FeatureExpandedPayloadSchema,
});
export type FeatureExpandedEvent = z.infer<typeof FeatureExpandedEventSchema>;

/**
 * `mortgage_calc.used` — user interacted with the mortgage calculator widget.
 *
 * @example { type: 'mortgage_calc.used', payload: { down_payment_pct: 20, term_years: 25, monthly_payment: 1180 } }
 */
export const MortgageCalcUsedPayloadSchema = z.object({
  down_payment_pct: z.number().min(0).max(100).optional(),
  term_years: z.number().int().positive().optional(),
  monthly_payment: z.number().nonnegative().optional(),
  interest_rate_pct: z.number().nonnegative().optional(),
});
export const MortgageCalcUsedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('mortgage_calc.used'),
  payload: MortgageCalcUsedPayloadSchema,
});
export type MortgageCalcUsedEvent = z.infer<typeof MortgageCalcUsedEventSchema>;
