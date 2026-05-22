/**
 * scripts/seed-archetypes.mts — one-shot archetype embedding seeder.
 *
 * Purpose:
 *   `packages/db/migrations/0005_seed_archetype_embeddings.sql` inserts 18
 *   canonical archetype rows with `embedding = NULL`. Without a populated
 *   vector, `fetchArchetypeEmbedding()` returns null for every archetype and
 *   the cosine-affinity path in the adapt route silently falls back to djb2.
 *
 *   This script reads each archetype's description, calls OpenAI
 *   `text-embedding-3-small` at 1024 dims, and writes the result back.
 *
 * Connection:
 *   Uses Supabase PostgREST (HTTP) with the service_role key — no direct
 *   Postgres connection required. service_role bypasses all RLS policies per
 *   Supabase design. The Supabase direct host is IPv6-only and unreachable
 *   from GitHub Actions and many CI environments.
 *
 * Credentials (in priority order):
 *   1. SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL — explicit, fastest
 *   2. SUPABASE_ACCESS_TOKEN — Management API fetches the service_role key
 *
 * Refresh cadence:
 *   MVP:      one-shot manual run after any archetype description change.
 *             Trigger:  `pnpm seed:archetypes`
 *   Post-MVP: daily Modal cron in apps/archetype-pipeline (future FOLLOW-NNN).
 *
 * Idempotency:
 *   The script only touches rows WHERE embedding IS NULL. Re-running with all
 *   rows populated is a no-op (logs "nothing to seed").
 *
 * Failure handling:
 *   Per-archetype errors are logged and skipped. Exit 1 only if every
 *   attempted row failed.
 *
 * Usage:
 *   pnpm seed:archetypes
 */

import OpenAI from 'openai';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_REF = 'yhmivuqeqkmzpxpyrsvc';
const SUPABASE_URL_DEFAULT = `https://${PROJECT_REF}.supabase.co`;
const ARCHETYPE_EMBEDDING_DIM = 1024;
const EMBEDDING_MODEL = 'text-embedding-3-small';

// ─── OpenAI helper ────────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('[seed-archetypes] OPENAI_API_KEY is not set');
  _openai = new OpenAI({ apiKey });
  return _openai;
}

async function embedText(text: string): Promise<number[]> {
  const res = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: ARCHETYPE_EMBEDDING_DIM,
  });
  const vec = res.data[0]?.embedding;
  if (!vec) throw new Error('OpenAI returned no embedding data');
  if (vec.length !== ARCHETYPE_EMBEDDING_DIM)
    throw new Error(`Unexpected embedding length: ${String(vec.length)}`);
  return vec;
}

// ─── Supabase PostgREST helpers ───────────────────────────────────────────────

async function getServiceRoleKey(): Promise<string> {
  // Prefer an explicit key — skip the Management API round-trip.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token)
    throw new Error('[seed-archetypes] Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN');

  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw new Error(
      `[seed-archetypes] Management API error ${String(res.status)}: ${await res.text()}`,
    );

  const keys = (await res.json()) as Array<{ name: string; api_key: string }>;
  const srKey = keys.find((k) => k.name === 'service_role')?.api_key;
  if (!srKey) throw new Error('[seed-archetypes] service_role key not found in API response');
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

interface ArchetypeRow {
  archetype_name: string;
  description: string;
}

async function fetchPendingRows(baseUrl: string, srKey: string): Promise<ArchetypeRow[]> {
  const url = `${baseUrl}/rest/v1/archetype_embeddings?embedding=is.null&select=archetype_name,description`;
  const res = await fetch(url, { headers: restHeaders(srKey) });
  if (!res.ok)
    throw new Error(`[seed-archetypes] SELECT failed ${String(res.status)}: ${await res.text()}`);
  return res.json() as Promise<ArchetypeRow[]>;
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
    // pgvector accepts the array as a JSON string in the format "[x,y,z,...]"
    body: JSON.stringify({ embedding: `[${embedding.join(',')}]` }),
  });
  if (!res.ok)
    throw new Error(
      `[seed-archetypes] PATCH failed for ${archetypeName} ${String(res.status)}: ${await res.text()}`,
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface SeedResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

async function seedArchetypeEmbeddings(): Promise<SeedResult> {
  const srKey = await getServiceRoleKey();
  const baseUrl = (process.env.SUPABASE_URL ?? SUPABASE_URL_DEFAULT).replace(/\/$/, '');

  const pending = await fetchPendingRows(baseUrl, srKey);

  if (pending.length === 0) {
    console.log('[seed-archetypes] nothing to seed — all archetypes already embedded.');
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  console.log(`[seed-archetypes] ${String(pending.length)} archetype(s) need embeddings.`);

  let succeeded = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      const embedding = await embedText(row.description);
      const preview = embedding
        .slice(0, 4)
        .map((n) => n.toFixed(4))
        .join(', ');
      console.log(`[seed] ${row.archetype_name} → vector[0..3]: [${preview}, ...]`);

      await updateEmbedding(baseUrl, srKey, row.archetype_name, embedding);
      succeeded += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[seed-archetypes] FAILED for ${row.archetype_name}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[seed-archetypes] done. attempted=${String(pending.length)} succeeded=${String(succeeded)} failed=${String(failed)}`,
  );
  return { attempted: pending.length, succeeded, failed };
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('seed-archetypes.mts') ||
    process.argv[1].endsWith('seed-archetypes.ts'));

if (isMain) {
  seedArchetypeEmbeddings()
    .then((result) => {
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

export { seedArchetypeEmbeddings, embedText, ARCHETYPE_EMBEDDING_DIM, EMBEDDING_MODEL };
