/**
 * Search and filter behavior events. Master Design C.1 row 6.
 *
 * Throughput: 5–50 per session.
 *
 * @module @estalara/shared/schemas/events/search-filter
 */

import { z } from 'zod';

import { EventEnvelopeSchema } from '../event.js';

/**
 * `search.query` — user submitted a free-text search.
 *
 * @example { type: 'search.query', payload: { query: 'penthouse marbella sea view', results_count: 42 } }
 */
export const SearchQueryPayloadSchema = z.object({
  query: z.string().min(1).max(500),
  results_count: z.number().int().nonnegative().optional(),
});
export const SearchQueryEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('search.query'),
  payload: SearchQueryPayloadSchema,
});
export type SearchQueryEvent = z.infer<typeof SearchQueryEventSchema>;

/**
 * `filter.applied` — user added a filter facet (price range, bedrooms, amenity, etc.).
 *
 * @example { type: 'filter.applied', payload: { facet: 'price_max', value: 500000 } }
 */
export const FilterAppliedPayloadSchema = z.object({
  facet: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export const FilterAppliedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('filter.applied'),
  payload: FilterAppliedPayloadSchema,
});
export type FilterAppliedEvent = z.infer<typeof FilterAppliedEventSchema>;

/**
 * `filter.removed` — user cleared a filter facet.
 *
 * @example { type: 'filter.removed', payload: { facet: 'bedrooms_min' } }
 */
export const FilterRemovedPayloadSchema = z.object({
  facet: z.string().min(1),
});
export const FilterRemovedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('filter.removed'),
  payload: FilterRemovedPayloadSchema,
});
export type FilterRemovedEvent = z.infer<typeof FilterRemovedEventSchema>;

/**
 * `sort.changed` — user changed the sort order of search results.
 *
 * @example { type: 'sort.changed', payload: { sort_by: 'price_asc' } }
 */
export const SortChangedPayloadSchema = z.object({
  sort_by: z.string().min(1),
});
export const SortChangedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('sort.changed'),
  payload: SortChangedPayloadSchema,
});
export type SortChangedEvent = z.infer<typeof SortChangedEventSchema>;
