/**
 * Cross-listing journey events. Master Design C.1 row 8.
 *
 * Throughput: 1–10 per session.
 *
 * @module @estalara/shared/schemas/events/cross-listing
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * `listing.next` — user navigated from one listing detail page to another.
 *
 * @example { type: 'listing.next', payload: { from_listing_id: 'l_42', to_listing_id: 'l_43', via: 'next_button' } }
 */
export const ListingNextPayloadSchema = z.object({
  from_listing_id: z.string().min(1),
  to_listing_id: z.string().min(1),
  via: z.enum(['next_button', 'related', 'search_results', 'gallery']).optional(),
});
export const ListingNextEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('listing.next'),
  payload: ListingNextPayloadSchema,
});
export type ListingNextEvent = z.infer<typeof ListingNextEventSchema>;

/**
 * `listing.compared` — listing added to a side-by-side compare view.
 *
 * @example { type: 'listing.compared', payload: { listing_ids: ['l_42', 'l_43', 'l_44'] } }
 */
export const ListingComparedPayloadSchema = z.object({
  listing_ids: z.array(z.string().min(1)).min(2).max(6),
});
export const ListingComparedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('listing.compared'),
  payload: ListingComparedPayloadSchema,
});
export type ListingComparedEvent = z.infer<typeof ListingComparedEventSchema>;

/**
 * `listing.bookmarked` — listing saved to favorites / shortlist.
 *
 * Extended by FOLLOW-210: listingType, priceRange, bedroomCount added from the
 * `estalara:listing:favorited` CustomEvent dispatched by app.estalara.com.
 *
 * @example { type: 'listing.bookmarked', payload: { collection: 'shortlist', listingType: 'residential', bedroomCount: 4 } }
 */
export const ListingBookmarkedPayloadSchema = z.object({
  collection: z.string().optional(),
  listingType: z.string().optional(),
  priceRange: z.string().optional(),
  bedroomCount: z.number().optional(),
});
export const ListingBookmarkedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('listing.bookmarked'),
  payload: ListingBookmarkedPayloadSchema,
});
export type ListingBookmarkedEvent = z.infer<typeof ListingBookmarkedEventSchema>;
