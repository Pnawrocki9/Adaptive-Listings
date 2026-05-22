/**
 * scripts/seed-archetype-embeddings.ts — one-shot archetype embedding seeder.
 *
 * Purpose:
 *   `packages/db/migrations/0005_seed_archetype_embeddings.sql` inserts 18
 *   canonical archetype rows with `embedding = NULL`. Without a populated
 *   vector, `fetchArchetypeEmbedding()` returns null for every archetype and
 *   the cosine-affinity path in the adapt route (FOLLOW-019) silently falls
 *   back to djb2 deterministic scoring for every listing.
 *
 *   This script reads each archetype's `description` column, calls OpenAI
 *   `text-embedding-3-small` at 1024 dimensions (Matryoshka — matches the
 *   listing_embeddings table), and UPDATEs the row with the resulting vector.
 *
 * Refresh cadence:
 *   MVP:      one-shot manual run after any archetype description change.
 *             Trigger:  `pnpm seed:archetypes`
 *   Post-MVP: daily Modal cron in apps/archetype-pipeline (future FOLLOW-NNN).
 *             That job will re-embed any rows whose description has changed
 *             since the last run AND any rows with embedding IS NULL.
 *
 * Idempotency:
 *   The script SELECTs only WHERE embedding IS NULL. Re-running with all rows
 *   populated is a no-op (logs "nothing to seed").
 *
 * Failure handling:
 *   Per-archetype OpenAI / DB errors are logged and skipped — the script does
 *   not abort the whole batch on a single failure. Exit code is 0 if at least
 *   one row was updated, 1 if every attempt failed.
 *
 * Environment:
 *   OPENAI_API_KEY        — required (text-embedding-3-small)
 *   DATABASE_URL_ADMIN    — preferred (service role, direct connection, port 5432)
 *   DATABASE_URL_DIRECT   — fallback (same effect; legacy var name)
 *
 * Usage:
 *   pnpm seed:archetypes
 *
 *   # or directly via the control-plane workspace (which carries openai + @estalara/db):
 *   pnpm --filter @estalara/control-plane exec tsx ../../scripts/seed-archetype-embeddings.ts
 *
 * Verification after run:
 *   SELECT COUNT(*) FROM archetype_embeddings WHERE embedding IS NOT NULL;
 *   -- must return 18
 */

import { eq, isNull } from 'drizzle-orm';
import OpenAI from 'openai';

import { archetypeEmbeddings, createAdminClient } from '@estalara/db';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Estalara-standard embedding dimensionality for archetype + listing vectors. */
const ARCHETYPE_EMBEDDING_DIM = 1024;

/** OpenAI embeddings model. Held constant — Matryoshka truncation at 1024 dims. */
const EMBEDDING_MODEL = 'text-embedding-3-small';

// ─── OpenAI helper ────────────────────────────────────────────────────────────

let _openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (_openaiClient) return _openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('[seed-archetypes] OPENAI_API_KEY is not set');
  }
  _openaiClient = new OpenAI({ apiKey });
  return _openaiClient;
}

async function embedDescription(text: string): Promise<number[]> {
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: ARCHETYPE_EMBEDDING_DIM,
  });
  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error('OpenAI returned no embedding data');
  }
  if (embedding.length !== ARCHETYPE_EMBEDDING_DIM) {
    throw new Error(
      `Unexpected embedding length: ${String(embedding.length)} (wanted ${String(ARCHETYPE_EMBEDDING_DIM)})`,
    );
  }
  return embedding;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface SeedResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

async function seedArchetypeEmbeddings(): Promise<SeedResult> {
  if (!process.env.DATABASE_URL_ADMIN && !process.env.DATABASE_URL_DIRECT) {
    throw new Error('[seed-archetypes] Neither DATABASE_URL_ADMIN nor DATABASE_URL_DIRECT is set');
  }

  const db = createAdminClient();

  // SELECT only rows whose vector has not been computed yet (idempotent).
  const pending = await db
    .select({
      archetypeName: archetypeEmbeddings.archetypeName,
      description: archetypeEmbeddings.description,
    })
    .from(archetypeEmbeddings)
    .where(isNull(archetypeEmbeddings.embedding));

  if (pending.length === 0) {
    console.log('[seed-archetypes] nothing to seed — all archetypes already embedded.');
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  console.log(`[seed-archetypes] ${String(pending.length)} archetype(s) need embeddings.`);

  let succeeded = 0;
  let failed = 0;

  for (const row of pending) {
    const { archetypeName, description } = row;
    try {
      const embedding = await embedDescription(description);

      // Visual sanity log — first 4 dims rounded to 4 decimals.
      const preview = embedding
        .slice(0, 4)
        .map((n) => n.toFixed(4))
        .join(', ');
      console.log(`[seed] ${archetypeName} → vector[0..3]: [${preview}, ...]`);

      await db
        .update(archetypeEmbeddings)
        .set({ embedding })
        .where(eq(archetypeEmbeddings.archetypeName, archetypeName));

      succeeded += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[seed-archetypes] FAILED for ${archetypeName}:`,
        err instanceof Error ? err.message : err,
      );
      // Continue to next archetype — never abort the whole batch.
    }
  }

  console.log(
    `[seed-archetypes] done. attempted=${String(pending.length)} succeeded=${String(succeeded)} failed=${String(failed)}`,
  );
  return { attempted: pending.length, succeeded, failed };
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

// Only run when invoked directly (not when imported by tests).
const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  process.argv[1].endsWith('seed-archetype-embeddings.ts');

if (isMain) {
  seedArchetypeEmbeddings()
    .then((result) => {
      // Exit 1 only if every attempted row failed AND at least one was attempted.
      const allFailed = result.attempted > 0 && result.succeeded === 0;
      process.exit(allFailed ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error(
        '[seed-archetypes] fatal error:',
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
      process.exit(1);
    });
}

export { seedArchetypeEmbeddings, embedDescription, ARCHETYPE_EMBEDDING_DIM, EMBEDDING_MODEL };
