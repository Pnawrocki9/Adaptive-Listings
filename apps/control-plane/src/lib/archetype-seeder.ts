/**
 * archetype-seeder.ts — core logic for populating archetype_embeddings.
 *
 * Extracted from scripts/seed-archetypes.mts so it can be unit-tested (the
 * script file is outside the tsc include and cannot be imported in tests).
 *
 * Consumed by:
 *   - apps/control-plane/scripts/seed-archetypes.mts (CLI entrypoint)
 *
 * The job is idempotent: it only touches rows WHERE embedding IS NULL. A
 * re-run with all rows populated is a no-op ("nothing to seed").
 *
 * Connects to Supabase via PostgREST (HTTP + service_role key) — no direct
 * Postgres connection. The Supabase direct host is IPv6-only and unreachable
 * from GitHub Actions, hence the REST transport.
 *
 * @module apps/control-plane/src/lib/archetype-seeder
 */

import OpenAI from 'openai';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_REF = 'yhmivuqeqkmzpxpyrsvc';
const SUPABASE_URL_DEFAULT = `https://${PROJECT_REF}.supabase.co`;

/** Embedding dimension used by OpenAI text-embedding-3-small (reduced). */
export const ARCHETYPE_EMBEDDING_DIM = 1024;

const EMBEDDING_MODEL = 'text-embedding-3-small';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArchetypeRow {
  archetype_name: string;
  description: string;
}

export interface SeedResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

// ─── OpenAI singleton ─────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('[archetype-seeder] OPENAI_API_KEY is not set');
  _openai = new OpenAI({ apiKey });
  return _openai;
}

/** Reset the OpenAI singleton — tests only. */
export function _resetOpenAIForTest(): void {
  _openai = null;
}

async function embedText(text: string): Promise<number[]> {
  const res = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: ARCHETYPE_EMBEDDING_DIM,
  });
  const vec = res.data[0]?.embedding;
  if (!vec) throw new Error('[archetype-seeder] OpenAI returned no embedding data');
  if (vec.length !== ARCHETYPE_EMBEDDING_DIM)
    throw new Error(`[archetype-seeder] Unexpected embedding length: ${String(vec.length)}`);
  return vec;
}

// ─── Supabase PostgREST helpers ───────────────────────────────────────────────

async function getServiceRoleKey(): Promise<string> {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token)
    throw new Error('[archetype-seeder] Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN');

  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw new Error(
      `[archetype-seeder] Management API error ${String(res.status)}: ${await res.text()}`,
    );

  const keys = (await res.json()) as { name: string; api_key: string }[];
  const srKey = keys.find((k) => k.name === 'service_role')?.api_key;
  if (!srKey) throw new Error('[archetype-seeder] service_role key not found in API response');
  return srKey;
}

function restHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
}

async function fetchPendingRows(baseUrl: string, srKey: string): Promise<ArchetypeRow[]> {
  const url = `${baseUrl}/rest/v1/archetype_embeddings?embedding=is.null&select=archetype_name,description`;
  const res = await fetch(url, { headers: restHeaders(srKey) });
  if (!res.ok)
    throw new Error(`[archetype-seeder] SELECT failed ${String(res.status)}: ${await res.text()}`);
  return res.json() as Promise<ArchetypeRow[]>;
}

/**
 * Clears all embedding columns to NULL so a subsequent seed pass re-embeds
 * from the current description strings. Used when FORCE_RESEED=true (e.g.
 * archetype-seeds.ts was edited and descriptions changed).
 */
async function clearAllEmbeddings(baseUrl: string, srKey: string): Promise<void> {
  const url = `${baseUrl}/rest/v1/archetype_embeddings`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...restHeaders(srKey), Prefer: 'return=minimal' },
    body: JSON.stringify({ embedding: null }),
  });
  if (!res.ok)
    throw new Error(
      `[archetype-seeder] clear embeddings failed ${String(res.status)}: ${await res.text()}`,
    );
  console.log(
    '[archetype-seeder] force-reseed: cleared all embeddings — re-embedding from current descriptions.',
  );
}

async function updateEmbedding(
  baseUrl: string,
  srKey: string,
  archetypeName: string,
  embedding: number[],
): Promise<void> {
  const url = `${baseUrl}/rest/v1/archetype_embeddings?archetype_name=eq.${encodeURIComponent(archetypeName)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: restHeaders(srKey),
    // pgvector accepts the array as a JSON string: "[x,y,z,...]"
    body: JSON.stringify({ embedding: `[${embedding.join(',')}]` }),
  });
  if (!res.ok)
    throw new Error(
      `[archetype-seeder] PATCH failed for ${archetypeName} ${String(res.status)}: ${await res.text()}`,
    );
}

// ─── Main seeding function ────────────────────────────────────────────────────

/**
 * Populate archetype_embeddings.embedding for all rows where it is NULL.
 *
 * Reads each archetype's description, calls OpenAI text-embedding-3-small
 * at 1024 dims, and PATCHes the result back via Supabase PostgREST.
 *
 * Idempotent: rows already populated are skipped. Per-archetype errors are
 * counted but do not abort the run. Caller should exit(1) if every attempted
 * row failed.
 *
 * Consumed by:
 *   - scripts/seed-archetypes.mts (pnpm seed:archetypes CLI)
 *   - post-migrate-seed.yml GHA workflow (on push:main)
 */
export async function seedArchetypeEmbeddings(): Promise<SeedResult> {
  const srKey = await getServiceRoleKey();
  const baseUrl = (process.env.SUPABASE_URL ?? SUPABASE_URL_DEFAULT).replace(/\/$/, '');

  if (process.env.FORCE_RESEED === 'true') {
    await clearAllEmbeddings(baseUrl, srKey);
  }

  const pending = await fetchPendingRows(baseUrl, srKey);

  if (pending.length === 0) {
    console.log('[archetype-seeder] nothing to seed — all archetypes already embedded.');
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  console.log(`[archetype-seeder] ${String(pending.length)} archetype(s) need embeddings.`);

  let succeeded = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      const embedding = await embedText(row.description);
      const preview = embedding
        .slice(0, 4)
        .map((n) => n.toFixed(4))
        .join(', ');
      console.log(`[archetype-seeder] ${row.archetype_name} → vector[0..3]: [${preview}, ...]`);

      await updateEmbedding(baseUrl, srKey, row.archetype_name, embedding);
      succeeded += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[archetype-seeder] FAILED for ${row.archetype_name}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[archetype-seeder] done. attempted=${String(pending.length)} succeeded=${String(succeeded)} failed=${String(failed)}`,
  );
  return { attempted: pending.length, succeeded, failed };
}
