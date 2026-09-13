/**
 * assert-archetype-embeddings.ts — CLI for the `Archetype embeddings not-NULL
 * check` CI gate (FOLLOW-1191 / audit finding E-5).
 *
 * The assertion logic lives in `src/archetype-embedding-assert.ts` so it can be
 * unit-tested; this file is the thin query + exit-code wrapper. Read that
 * module's header for what the gate now asserts and why the previous inline
 * version could not fail on an empty table.
 *
 * An operator on the localhost substrate now has the same check CI runs:
 *
 *   DATABASE_URL_ADMIN='postgresql://supabase_admin:postgres@127.0.0.1:5433/postgres' \
 *     pnpm --filter @estalara/db exec tsx scripts/assert-archetype-embeddings.ts
 *
 * Uses `postgres` + raw SQL rather than the Drizzle client on purpose:
 * `vector_dims()` is a pgvector function with no Drizzle expression, and this
 * way the gate needs no `dist/` build to run.
 */

import postgres from 'postgres';

import {
  EXPECTED_EMBEDDING_DIM,
  evaluateArchetypeEmbeddings,
  type ArchetypeEmbeddingRow,
} from '../src/archetype-embedding-assert.js';
import { ARCHETYPE_SEEDS } from '../src/seed/archetype-seeds.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!url) {
    console.error('[archetype-embeddings-not-null] ERROR: DATABASE_URL_ADMIN is not set.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: false });
  let rows: ArchetypeEmbeddingRow[];
  try {
    rows = await sql<ArchetypeEmbeddingRow[]>`
      SELECT archetype_name, vector_dims(embedding) AS dims
      FROM archetype_embeddings
      ORDER BY archetype_name
    `;
  } finally {
    // postgres-js holds the socket open; without this the job hangs to timeout.
    await sql.end({ timeout: 5 });
  }

  const expectedNames = ARCHETYPE_SEEDS.map((s) => s.archetypeName);
  const failures = evaluateArchetypeEmbeddings(rows, expectedNames);

  if (failures.length > 0) {
    for (const f of failures) console.error(`[archetype-embeddings-not-null] FAIL: ${f}`);
    console.error(
      '[archetype-embeddings-not-null] Run: pnpm seed:archetypes (hosted), or against a loopback ' +
        'DATABASE_URL_ADMIN for the local substrate — see README "Local development setup".',
    );
    process.exit(1);
  }

  console.log(
    `[archetype-embeddings-not-null] PASS: ${String(rows.length)} archetype embeddings, all non-NULL ` +
      `and ${String(EXPECTED_EMBEDDING_DIM)}-dim, all ${String(expectedNames.length)} seeded names present.`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(
    '[archetype-embeddings-not-null] fatal error:',
    err instanceof Error ? (err.stack ?? err.message) : err,
  );
  process.exit(1);
});
