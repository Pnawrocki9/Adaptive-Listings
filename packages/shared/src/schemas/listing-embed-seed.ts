/**
 * Zod schema for the listing embedding seed pipeline event.
 *
 * Published by `apps/control-plane` when a tenant's catalog exceeds the
 * MAX_INLINE_SEED inline-embedding budget during schema activation.  The
 * Modal consumer (ml-engineer, LEG 2 of FOLLOW-435) subscribes to the topic
 * `estalara.listing-embeddings` and calls `POST /api/listings/embed` for each
 * listing_id in the payload (idempotent upsert semantics).
 *
 * Cross-language contract:
 *   - Shared fixture: `packages/shared/contracts/listing-embed-seed-event.required.json`
 *   - TS gate:  `src/__tests__/cross-runtime/listing-embed-seed-event-contract.test.ts`
 *   - Python gate (LEG 2): `apps/llm-gateway/src/jobs/test_listing_embed_seed_event_contract.py`
 *     (to be created by ml-engineer; must derive REQUIRED_FIELDS from the same fixture)
 *
 * @module @estalara/shared/schemas/listing-embed-seed
 */

import { z } from 'zod';

/**
 * Redpanda event published when overflow listings from the activation embedding
 * seed loop must be processed by the Modal background job.
 *
 * Topic: `estalara.listing-embeddings` (env: REDPANDA_TOPIC_LISTING_EMBEDDINGS)
 * Consumer: Modal job (ml-engineer, FOLLOW-435 LEG 2)
 *
 * The consumer must call `POST /api/listings/embed` for each listing_id:
 *   - Auth header: `x-internal-api-secret: <INTERNAL_API_SECRET>`
 *   - Body: `{ tenant_id, listing_id, text_fields?: { ... } }`
 *   - Idempotent upsert — safe to re-run.
 *
 * @example
 * {
 *   tenant_id: "550e8400-e29b-41d4-a716-446655440000",
 *   listing_ids: ["prop-051", "prop-052", "prop-053"]
 * }
 */
export const ListingEmbeddingSeedRequestedEventSchema = z.object({
  /** Tenant UUID — RLS scope for the embed endpoint. */
  tenant_id: z.string().uuid(),

  /**
   * Non-empty list of listing IDs to embed.
   *
   * Each ID must be passed as `listing_id` in a separate
   * `POST /api/listings/embed` call by the Modal consumer.
   */
  listing_ids: z.array(z.string().min(1)).min(1),
});

export type ListingEmbeddingSeedRequestedEvent = z.infer<
  typeof ListingEmbeddingSeedRequestedEventSchema
>;
