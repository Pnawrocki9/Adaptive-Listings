/**
 * Embedding math helpers used across services that consume archetype, session,
 * or listing embeddings (FOLLOW-019).
 *
 * Pure, dependency-free, browser-safe. The control-plane adapt route imports
 * `computeCosineSimilarity` directly. The decision-api Cloudflare Worker
 * cannot depend on workspace packages at runtime — it maintains a mirror copy
 * in `apps/decision-api/src/lib/reorder.ts` per the duplication comment.
 *
 * @module @estalara/shared/embeddings
 */

/**
 * Cosine similarity between two equal-length numeric vectors.
 *
 * Returns a float in [-1, 1]. For OpenAI text-embedding-3-small the values
 * are practically clamped to [0, 1] because all entries lie on the unit
 * hypersphere with non-negative dot products in common cases, but the math
 * itself returns the full range.
 *
 * Throws `RangeError` when:
 *   - The two vectors have different lengths.
 *   - Either vector has zero magnitude (undefined cosine — caller must
 *     handle missing/empty embeddings before calling this function).
 *
 * @param a - First vector.
 * @param b - Second vector of the same length as `a`.
 * @returns The cosine similarity `dot(a,b) / (||a|| * ||b||)`.
 * @throws {RangeError} On length mismatch or zero-magnitude input.
 */
export function computeCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new RangeError(
      `[embeddings] Vectors must have equal length (got ${String(a.length)} and ${String(b.length)})`,
    );
  }
  if (a.length === 0) {
    throw new RangeError('[embeddings] Vectors must be non-empty');
  }
  let dot = 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    sumA += ai * ai;
    sumB += bi * bi;
  }
  const magA = Math.sqrt(sumA);
  const magB = Math.sqrt(sumB);
  if (magA === 0 || magB === 0) {
    throw new RangeError('[embeddings] Zero-magnitude vector — cosine similarity is undefined');
  }
  return dot / (magA * magB);
}
