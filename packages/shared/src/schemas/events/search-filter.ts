/**
 * Search and filter behavior events. Master Design C.1 row 6.
 *
 * Throughput: 5–50 per session.
 *
 * @module @estalara/shared/schemas/events/search-filter
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * `search.query` — user submitted a free-text search.
 *
 * @example { type: 'search.query', payload: { query: 'penthouse marbella sea view', results_count: 42 } }
 */
export const SearchQueryPayloadSchema = z.object({
  query: z.string().min(1).max(500),
  results_count: z.number().int().nonnegative().optional(),
});
export const SearchQueryEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('search.query'),
  payload: SearchQueryPayloadSchema,
});
export type SearchQueryEvent = z.infer<typeof SearchQueryEventSchema>;

/**
 * Enumerated facets for `filter.applied`.
 *
 * Each value maps to a named filter dimension. Adding a new facet here is the
 * authoritative change — the intent engine's conditional boosts reference
 * the same string literals.
 *
 * Taxonomy (Master Design C.1):
 *   - price_range    : min/max price slider
 *   - bedrooms       : minimum bedroom count
 *   - bathrooms      : minimum bathroom count
 *   - property_type  : residential / commercial / land / etc.
 *   - location       : neighbourhood, city, or polygon filter
 *   - amenities      : pool, garage, terrace, etc.
 *   - investment_yield: gross rental yield filter
 *   - commercial     : commercial-only listing type
 */
export const FILTER_APPLIED_FACETS = [
  'price_range',
  'bedrooms',
  'bathrooms',
  'property_type',
  'location',
  'amenities',
  'investment_yield',
  'commercial',
] as const;
export type FilterAppliedFacet = (typeof FILTER_APPLIED_FACETS)[number];

/**
 * `filter.applied` — user added a filter facet (price range, bedrooms, amenity, etc.).
 *
 * The `facet` field is an enum so the intent engine can apply per-facet archetype
 * boosts (see `applyBehavioralSignal` in `packages/sdk/src/core/intent.ts`).
 *
 * `value` is optional — some facets are boolean-style toggles (e.g. `commercial`).
 *
 * @example { type: 'filter.applied', payload: { facet: 'commercial' } }
 * @example { type: 'filter.applied', payload: { facet: 'bedrooms', value: 3 } }
 * @example { type: 'filter.applied', payload: { facet: 'amenities', value: ['pool', 'garage'] } }
 */
export const FilterAppliedPayloadSchema = z.object({
  facet: z.enum(FILTER_APPLIED_FACETS),
  value: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
});
export const FilterAppliedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('filter.applied'),
  payload: FilterAppliedPayloadSchema,
});
export type FilterAppliedEvent = z.infer<typeof FilterAppliedEventSchema>;
export type FilterAppliedPayload = z.infer<typeof FilterAppliedPayloadSchema>;

/**
 * `filter.removed` — user cleared a filter facet.
 *
 * @example { type: 'filter.removed', payload: { facet: 'bedrooms_min' } }
 */
export const FilterRemovedPayloadSchema = z.object({
  facet: z.string().min(1),
});
export const FilterRemovedEventSchema = EventEnvelopeBaseSchema.extend({
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
export const SortChangedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('sort.changed'),
  payload: SortChangedPayloadSchema,
});
export type SortChangedEvent = z.infer<typeof SortChangedEventSchema>;
