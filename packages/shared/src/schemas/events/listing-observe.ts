/**
 * Listing observation events emitted by the SDK observer and intent engine.
 *
 * These are distinct from cross-listing journey events (listing.next, listing.compared,
 * listing.bookmarked) — they represent passive observation of listing cards in the viewport.
 *
 * @module @estalara/shared/schemas/events/listing-observe
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * `listing.viewed` — a listing card scrolled into the viewport and was visible
 * for at least 50% of its area (IntersectionObserver threshold: 0.5).
 *
 * Emitted by: packages/sdk/src/core/observer.ts (IntersectionObserver callback)
 *
 * @example
 * {
 *   type: 'listing.viewed',
 *   payload: { listing_id: 'prop-456', element: 'div' }
 * }
 */
export const ListingViewedPayloadSchema = z.object({
  /** data-listing-id attribute on the observed element (may be empty string when absent). */
  listing_id: z.string(),
  /** Tag name of the observed DOM element (lowercased). */
  element: z.string().min(1).optional(),
});
export const ListingViewedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('listing.viewed'),
  payload: ListingViewedPayloadSchema,
});
export type ListingViewedEvent = z.infer<typeof ListingViewedEventSchema>;
export type ListingViewedPayload = z.infer<typeof ListingViewedPayloadSchema>;

/**
 * `cta.clicked` — user clicked a CTA element annotated with `data-estalara-cta`.
 *
 * Emitted by: packages/sdk/src/core/observer.ts (document click listener)
 *
 * @example
 * {
 *   type: 'cta.clicked',
 *   payload: { cta_id: 'contact_agent', href: 'https://...', text: 'Contact Agent' }
 * }
 */
export const CtaClickedPayloadSchema = z.object({
  /** Value of the `data-estalara-cta` attribute. */
  cta_id: z.string(),
  /** href of the clicked anchor (empty string when not an anchor). */
  href: z.string().optional(),
  /** Trimmed text content of the CTA, truncated at 100 chars. */
  text: z.string().max(100).optional(),
});
export const CtaClickedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('cta.clicked'),
  payload: CtaClickedPayloadSchema,
});
export type CtaClickedEvent = z.infer<typeof CtaClickedEventSchema>;
export type CtaClickedPayload = z.infer<typeof CtaClickedPayloadSchema>;
