/**
 * RAG retrieval helper — top-3 agency FAQ answers by cosine similarity.
 *
 * Given a tenant ID, listing ID, and a session intent vector, queries the
 * `answers` table for the 3 rows whose `question_embedding` is closest to
 * the intent vector (cosine distance via pgvector `<=>` operator).
 *
 * Returns the answers as `{ [question]: answer }` for injection into
 * `LlmGatewayInput.listingContext`.
 *
 * Returns `{}` when:
 *   - `listingId` is null or undefined
 *   - `intentVector` is null, undefined, or empty
 *   - No rows exist for the (tenant, listing) pair
 *   - The DB call fails (fail-open: RAG is best-effort)
 *
 * This must complete in <10ms p95 (single indexed pgvector query, LIMIT 3).
 *
 * @module apps/control-plane/src/lib/rag-retrieval
 */

import { sql } from 'drizzle-orm';
import { createAdminClient } from '@estalara/db';

interface RagRow extends Record<string, unknown> {
  question: string;
  answer: string;
}

/**
 * Retrieve the top-3 FAQ answers most relevant to `intentVector` for a given
 * `(tenantId, listingId)` pair.
 *
 * @param tenantId     - The tenant UUID.
 * @param listingId    - The external listing identifier.
 * @param intentVector - Session intent vector (1536 dims). Pass null/[] to skip.
 * @returns Map of question → answer for the top-3 hits, or `{}` on no results.
 */
export async function retrieveListingContext(
  tenantId: string,
  listingId: string | null | undefined,
  intentVector: number[] | null | undefined,
): Promise<Record<string, string>> {
  if (!listingId || !intentVector || intentVector.length === 0) {
    return {};
  }

  try {
    const db = createAdminClient();

    // pgvector cosine distance query — `<=>` is cosine distance (lower = more similar).
    // We order ascending (nearest first) and take top 3.
    const vectorLiteral = `[${intentVector.join(',')}]`;

    const rows = await db.execute<RagRow>(sql`
      SELECT question, answer
      FROM answers
      WHERE tenant_id = ${tenantId}::uuid
        AND listing_id = ${listingId}
      ORDER BY question_embedding <=> ${vectorLiteral}::vector
      LIMIT 3
    `);

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.question] = row.answer;
    }
    return result;
  } catch (err) {
    // Fail open: RAG enrichment is best-effort; never block adaptation on it.
    console.error(
      '[rag-retrieval] query failed (returning empty context):',
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}
