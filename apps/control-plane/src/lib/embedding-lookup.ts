/**
 * Embedding lookups used by the adapt route to compute real archetype-listing
 * affinity (FOLLOW-019).
 *
 *   - {@link fetchArchetypeEmbedding} — single archetype 1024-dim vector
 *     from `archetype_embeddings` (cross-tenant global table).
 *   - {@link fetchListingEmbeddings} — batched per-tenant listing vectors
 *     from `listing_embeddings`, returning a Map keyed by listing_id.
 *
 * A missing row resolves to null / an absent map entry; a DB error THROWS
 * (FOLLOW-1220), so the adapt route can record `embeddings_lookup_failed`
 * instead of conflating an outage with an unseeded table. The route catches it
 * and withholds its `reorder` directive (FOLLOW-1202, CEO decision #3: reorder
 * fails closed, text directives stay fail-open); it MUST never 5xx on this.
 *
 * @module apps/control-plane/src/lib/embedding-lookup
 */

import { and, eq, inArray } from 'drizzle-orm';

import { archetypeEmbeddings, createAdminClient, listingEmbeddings } from '@estalara/db';

/**
 * Maximum number of listing_ids that will be embedding-looked-up in a single
 * adapt request. Beyond this, the adapt route skips the lookup and withholds
 * the reorder for the whole batch (latency guard; FOLLOW-1202).
 *
 * The batch query is a single `WHERE tenant_id = ? AND listing_id IN (...)`
 * with a pgvector textual decode per row. p95 target: ≤10ms at 50 ids.
 */
export const LISTING_EMBEDDING_BATCH_LIMIT = 50;

/**
 * Look up the 1024-dim embedding for a named archetype.
 *
 * Returns `null` when:
 *   - the archetype row does not exist
 *   - the row exists but `embedding` is NULL (not yet computed)
 *
 * THROWS when the DB query throws (FOLLOW-1220) — the caller records it as a lookup failure.
 *
 * @param archetypeName - Archetype identifier (e.g. 'investor', 'family').
 * @returns The 1024-dim vector, or null on a miss.
 */
export async function fetchArchetypeEmbedding(archetypeName: string): Promise<number[] | null> {
  const db = createAdminClient();
  const rows = await db
    .select({ embedding: archetypeEmbeddings.embedding })
    .from(archetypeEmbeddings)
    .where(eq(archetypeEmbeddings.archetypeName, archetypeName))
    .limit(1);

  const embedding = rows[0]?.embedding;
  if (!embedding || embedding.length === 0) return null;
  return embedding;
}

/**
 * Batch-look-up listing embeddings for a tenant.
 *
 * Returns a Map keyed by listing_id. Listings without a row in
 * `listing_embeddings` are simply absent from the map (callers treat
 * `map.get(id) ?? null` as "no embedding → no cosine score → reorder withheld",
 * FOLLOW-1202).
 *
 * THROWS when the DB query throws (FOLLOW-1220); an empty Map means the lookup ran and found
 * no rows.
 *
 * @param tenantId   - Tenant UUID (RLS-scoped lookup target).
 * @param listingIds - Listing IDs to fetch embeddings for (max
 *                     LISTING_EMBEDDING_BATCH_LIMIT — caller must enforce).
 * @returns          Map of listing_id → embedding vector (null for rows
 *                   present but un-embedded).
 */
export async function fetchListingEmbeddings(
  tenantId: string,
  listingIds: string[],
): Promise<Map<string, number[] | null>> {
  const result = new Map<string, number[] | null>();
  if (listingIds.length === 0) return result;

  const db = createAdminClient();
  const rows = await db
    .select({
      listingId: listingEmbeddings.listingId,
      embedding: listingEmbeddings.embedding,
    })
    .from(listingEmbeddings)
    .where(
      and(
        eq(listingEmbeddings.tenantId, tenantId),
        inArray(listingEmbeddings.listingId, listingIds),
      ),
    );

  for (const row of rows) {
    const embedding = row.embedding && row.embedding.length > 0 ? row.embedding : null;
    result.set(row.listingId, embedding);
  }
  return result;
}
