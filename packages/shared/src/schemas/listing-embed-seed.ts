/**
 * Zod schema for the listing embedding seed pipeline event.
 *
 * POSTed by `apps/control-plane` to its own `POST /api/internal/listings/embed-seed` when one
 * embed-seed hop leaves listings unprocessed during schema activation (FOLLOW-1297, ADR-0023
 * §6 G-06). The route calls `POST /api/listings/embed` for each listing_id in the payload
 * (idempotent upsert semantics). Until FOLLOW-1297 the consumer was a Modal job.
 *
 * Contract:
 *   - Fixture: `packages/shared/contracts/listing-embed-seed-event.required.json`
 *   - TS gate: `src/__tests__/cross-runtime/listing-embed-seed-event-contract.test.ts`
 *     (single-runtime since the Python consumer was deleted)
 *
 * @module @estalara/shared/schemas/listing-embed-seed
 */

import { z } from 'zod';

/**
 * Payload POSTed when listings left over by an activation embed-seed hop must be processed
 * by the next hop (ADR-0023 §6 G-06).
 *
 * Endpoint: `POST /api/internal/listings/embed-seed` (control plane)
 * Consumer: `runEmbedSeedHop` in apps/control-plane/src/lib/seed-listing-embeddings.ts
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

  /**
   * FOLLOW-1297 (ADR-0023 §6 G-06): how many control-plane requeue hops this payload has already
   * taken on `POST /api/internal/listings/embed-seed`. Each hop embeds what fits its wall-clock
   * budget and requeues the remainder with `requeue_depth + 1`; at 20 the remainder is reported
   * instead. Absent ⇒ 0 (a first hop, or a Modal payload — the Modal consumer ignores the field).
   */
  requeue_depth: z.number().int().min(0).max(20).optional(),

  /**
   * FOLLOW-1297 (G-06): the subset of `listing_ids` that already failed once on the previous hop
   * and is on its single retry. A listing that fails again is reported with its id, not requeued.
   * Absent ⇒ none.
   */
  retry_listing_ids: z.array(z.string().min(1)).optional(),
});

export type ListingEmbeddingSeedRequestedEvent = z.infer<
  typeof ListingEmbeddingSeedRequestedEventSchema
>;
