/**
 * archetype-seeder.ts — core logic for populating archetype_embeddings.
 *
 * Extracted from scripts/seed-archetypes.ts so it can be unit-tested (the
 * script file is outside the tsc include and cannot be imported in tests).
 *
 * Consumed by:
 *   - apps/control-plane/scripts/seed-archetypes.ts (CLI entrypoint)
 *
 * The job is idempotent: it only touches rows WHERE embedding IS NULL. A
 * re-run with all rows populated is a no-op ("nothing to seed").
 *
 * Two transports (FOLLOW-1191 / audit finding L-8):
 *   - `postgrest` — Supabase PostgREST (HTTP + service_role key). The hosted
 *     path. The Supabase direct host is IPv6-only and unreachable from GitHub
 *     Actions, which is why the REST transport exists and stays the default.
 *   - `postgres`  — a direct Postgres connection, LOOPBACK HOSTS ONLY. Before
 *     this existed the seeder could only ever write to the hardcoded hosted
 *     project, so `archetype_embeddings.embedding` stayed NULL on every local
 *     database and the adapt route's cosine path was structurally unreachable
 *     on the localhost substrate (`scoring_path` could only be
 *     `djb2_fallback`).
 *
 * See {@link resolveSeedTarget} for how the transport is chosen.
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

/**
 * Hosts the direct-Postgres transport is willing to WRITE to.
 *
 * Same set and same reasoning as `packages/db/scripts/bootstrap-local.ts`: a
 * seeder that mutates rows must never be pointed at the shared hosted project
 * by an environment variable that happens to be in scope. Doppler `dev`
 * defines `DATABASE_URL_ADMIN` for hosted Supabase, so without this guard
 * `doppler run -- pnpm seed:archetypes` with `ARCHETYPE_SEED_TRANSPORT=postgres`
 * would silently write to the shared database an operator believed was local.
 */
const ALLOWED_DIRECT_PG_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

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

/** Where {@link seedArchetypeEmbeddings} will write. */
type SeedTarget =
  | { transport: 'postgres'; databaseUrl: string }
  | { transport: 'postgrest'; baseUrl: string };

// ─── Transport selection ──────────────────────────────────────────────────────

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    throw new Error(`[archetype-seeder] DATABASE_URL_ADMIN is not a parseable URL: ${url}`);
  }
}

/**
 * Decide which database this run writes to.
 *
 * Rules, in order:
 *   1. `ARCHETYPE_SEED_TRANSPORT=postgres` — force the direct connection. A
 *      non-loopback `DATABASE_URL_ADMIN` is REFUSED (throws), never silently
 *      downgraded to the hosted PostgREST path: the operator asked for a
 *      direct write and must be told the target is not the one they meant.
 *   2. A `DATABASE_URL_ADMIN` (or `DATABASE_URL_DIRECT`) whose host is loopback
 *      IS the localhost substrate — prefer it over the hosted project. This is
 *      what makes `pnpm seed:archetypes` reachable on localhost at all.
 *   3. Otherwise PostgREST against `SUPABASE_URL` (hosted default). A hosted
 *      `DATABASE_URL_ADMIN` lands here, which keeps the CI/prod path unchanged.
 *
 * Deliberately NOT exported (Rule I): its only caller is
 * {@link seedArchetypeEmbeddings} below, and the tests exercise it THROUGH that
 * function — which is also the only way to prove the chosen transport is the one
 * actually used, rather than the one a resolver returned.
 *
 * @throws {Error} when transport `postgres` is forced but no admin URL is set,
 *                 or the URL is unparseable, or its host is not loopback.
 */
function resolveSeedTarget(env: NodeJS.ProcessEnv = process.env): SeedTarget {
  const adminUrl = env.DATABASE_URL_ADMIN ?? env.DATABASE_URL_DIRECT;
  const postgrest: SeedTarget = {
    transport: 'postgrest',
    baseUrl: (env.SUPABASE_URL ?? SUPABASE_URL_DEFAULT).replace(/\/$/, ''),
  };

  if (env.ARCHETYPE_SEED_TRANSPORT === 'postgres') {
    if (!adminUrl)
      throw new Error(
        '[archetype-seeder] ARCHETYPE_SEED_TRANSPORT=postgres requires DATABASE_URL_ADMIN.',
      );
    const host = hostOf(adminUrl);
    if (!ALLOWED_DIRECT_PG_HOSTS.has(host))
      throw new Error(
        `[archetype-seeder] REFUSING a direct write to host "${host}". The direct-Postgres ` +
          'transport is for a loopback container only; a hosted project is shared and must be ' +
          'seeded over PostgREST (unset ARCHETYPE_SEED_TRANSPORT) so the service_role key, not a ' +
          'stray DATABASE_URL_ADMIN, decides the target.',
      );
    return { transport: 'postgres', databaseUrl: adminUrl };
  }

  if (adminUrl) {
    let host: string;
    try {
      host = hostOf(adminUrl);
    } catch {
      return postgrest;
    }
    if (ALLOWED_DIRECT_PG_HOSTS.has(host)) return { transport: 'postgres', databaseUrl: adminUrl };
  }

  return postgrest;
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

// ─── Transport-agnostic backend ───────────────────────────────────────────────

/** The three writes the seeding loop needs, independent of transport. */
interface SeedBackend {
  label: string;
  fetchPending(): Promise<ArchetypeRow[]>;
  clearAllEmbeddings(): Promise<void>;
  updateEmbedding(archetypeName: string, embedding: number[]): Promise<void>;
}

async function postgrestBackend(baseUrl: string): Promise<SeedBackend> {
  const srKey = await getServiceRoleKey();
  return {
    label: `PostgREST ${baseUrl}`,
    fetchPending: () => fetchPendingRows(baseUrl, srKey),
    clearAllEmbeddings: () => clearAllEmbeddings(baseUrl, srKey),
    updateEmbedding: (name, embedding) => updateEmbedding(baseUrl, srKey, name, embedding),
  };
}

/**
 * Direct-Postgres backend for the localhost substrate.
 *
 * `@estalara/db` is imported dynamically so the hosted PostgREST path — which
 * is what CI and the `--import-check` gate exercise — never needs the package's
 * `dist/` to exist. The caller (`scripts/seed-archetypes.ts`) ends with an
 * explicit `process.exit()`, so the postgres-js socket this opens does not need
 * closing to let the process end.
 */
async function directPostgresBackend(databaseUrl: string): Promise<SeedBackend> {
  const { createAdminClient, archetypeEmbeddings } = await import('@estalara/db');
  const { eq, isNull } = await import('drizzle-orm');
  const db = createAdminClient();

  return {
    label: `direct Postgres ${hostOf(databaseUrl)}`,
    fetchPending: async () => {
      const rows = await db
        .select({
          archetype_name: archetypeEmbeddings.archetypeName,
          description: archetypeEmbeddings.description,
        })
        .from(archetypeEmbeddings)
        .where(isNull(archetypeEmbeddings.embedding));
      return rows;
    },
    clearAllEmbeddings: async () => {
      await db.update(archetypeEmbeddings).set({ embedding: null });
      console.log(
        '[archetype-seeder] force-reseed: cleared all embeddings — re-embedding from current descriptions.',
      );
    },
    updateEmbedding: async (archetypeName, embedding) => {
      await db
        .update(archetypeEmbeddings)
        .set({ embedding })
        .where(eq(archetypeEmbeddings.archetypeName, archetypeName));
    },
  };
}

// ─── Main seeding function ────────────────────────────────────────────────────

/**
 * Populate archetype_embeddings.embedding for all rows where it is NULL.
 *
 * Reads each archetype's description, calls OpenAI text-embedding-3-small
 * at 1024 dims, and writes the result back over whichever transport
 * {@link resolveSeedTarget} picks (hosted PostgREST, or a direct connection to
 * a loopback Postgres).
 *
 * Idempotent: rows already populated are skipped. Per-archetype errors are
 * counted but do not abort the run. Caller should exit(1) if every attempted
 * row failed.
 *
 * Consumed by:
 *   - scripts/seed-archetypes.ts (pnpm seed:archetypes CLI)
 *   - post-migrate-seed.yml GHA workflow (on push:main)
 */
export async function seedArchetypeEmbeddings(): Promise<SeedResult> {
  const target = resolveSeedTarget();
  const backend =
    target.transport === 'postgres'
      ? await directPostgresBackend(target.databaseUrl)
      : await postgrestBackend(target.baseUrl);

  console.log(`[archetype-seeder] target: ${backend.label}`);

  if (process.env.FORCE_RESEED === 'true') {
    await backend.clearAllEmbeddings();
  }

  const pending = await backend.fetchPending();

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

      await backend.updateEmbedding(row.archetype_name, embedding);
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
