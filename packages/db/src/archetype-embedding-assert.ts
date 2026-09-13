/**
 * archetype-embedding-assert.ts — the assertion behind the CI gate
 * `Archetype embeddings not-NULL check`.
 *
 * FOLLOW-1191 / audit finding E-5. The gate used to be a heredoc inside
 * `.github/workflows/ci.yml` that checked exactly one thing: that no row of
 * `archetype_embeddings` has a NULL `embedding`. An EMPTY table satisfies that
 * vacuously, so the one control standing between a fresh database and a silently
 * all-djb2 pilot could not fail on the case that matters most. It also printed
 * "all 18 archetype embeddings populated" without ever counting rows.
 *
 * What it asserts now:
 *   1. row count == ARCHETYPE_SEEDS.length (18) — kills the empty-table pass
 *   2. no row has a NULL embedding                — the original check
 *   3. every embedding has vector_dims() == 1024  — a 1536-dim or truncated
 *      vector makes `<=>` error or mis-rank rather than fall back cleanly
 *   4. every seeded archetype_name is present     — 18 rows of the WRONG names
 *      would satisfy (1) on its own
 *
 * Consumed by:
 *   - packages/db/scripts/assert-archetype-embeddings.ts (the CLI the gate runs)
 *
 * @module @estalara/db/archetype-embedding-assert
 */

/** Estalara-standard archetype vector width (OpenAI text-embedding-3-small, reduced). */
export const EXPECTED_EMBEDDING_DIM = 1024;

/** One row as the assertion reads it. `dims` is NULL exactly when `embedding` is. */
export interface ArchetypeEmbeddingRow {
  archetype_name: string;
  dims: number | null;
}

/**
 * Pure evaluation of a live table snapshot. Returns a list of human-readable
 * failures — empty means the gate passes.
 *
 * Kept pure so `src/__tests__/assert-archetype-embeddings.test.ts` can prove the
 * empty-table case is RED without a database. That test is the red-first
 * evidence for E-5: the old assertion returned "no NULL rows" on `[]`.
 */
export function evaluateArchetypeEmbeddings(
  rows: ArchetypeEmbeddingRow[],
  expectedNames: readonly string[],
  expectedDim = EXPECTED_EMBEDDING_DIM,
): string[] {
  const failures: string[] = [];

  if (rows.length !== expectedNames.length) {
    failures.push(
      `row count is ${String(rows.length)}, expected ${String(expectedNames.length)} ` +
        '(ARCHETYPE_SEEDS.length). An empty or partially-migrated table used to PASS this gate.',
    );
  }

  const nullRows = rows.filter((r) => r.dims === null).map((r) => r.archetype_name);
  if (nullRows.length > 0) {
    failures.push(
      `${String(nullRows.length)} archetype(s) have a NULL embedding: ${nullRows.join(', ')}`,
    );
  }

  const wrongDim = rows
    .filter((r) => r.dims !== null && r.dims !== expectedDim)
    .map((r) => `${r.archetype_name}=${String(r.dims)}`);
  if (wrongDim.length > 0) {
    failures.push(
      `${String(wrongDim.length)} archetype(s) are not ${String(expectedDim)}-dim: ${wrongDim.join(', ')}`,
    );
  }

  const present = new Set(rows.map((r) => r.archetype_name));
  const missing = expectedNames.filter((name) => !present.has(name));
  if (missing.length > 0) {
    failures.push(`${String(missing.length)} seeded archetype(s) absent: ${missing.join(', ')}`);
  }

  return failures;
}
