/**
 * FOLLOW-1291 (Codex F-03 / F-17) — the description cache's revision fence, driven through the
 * ACTUAL handlers against a real Postgres engine (PGlite) carrying the REAL migrations.
 *
 * @vitest-environment node
 *
 * The code that touches description_cache_persistent runs unmocked:
 *   GET  /api/adapt/description            — reads the cache; on a miss stamps the job
 *   POST /api/webhooks/listing-updated     — listing.updated: the invalidation
 *   publishPgCachedDescription             — the generator's durable write (the writer)
 * and the schema is built from packages/db/migrations (0023 → 0033 → 0040 → 0041), so a fence
 * that exists only in a mock, or only in TypeScript, cannot make these tests pass.
 *
 * F-03: a job grounded BEFORE a listing.updated (it carries the old revision) completes AFTER it.
 *       Before the fence, its write invalidated the newer row and inserted the withdrawn fact,
 *       which the read path then served as `ai_cached` — permanently.
 * F-17: the active-row key ignored the model, and the write invalidated every model's row
 *       before inserting. An old write of ANOTHER model therefore destroyed the row the
 *       (model-scoped) read path serves.
 *
 * Mocked: auth (resolves the tenant), demo override (off), global model, RAG and the
 * listing-details fetch (the grounding text is the test's input), Sentry. Redis and ClickHouse
 * are unconfigured (structural no-ops). The generator (`lib/description-generator`) is mocked:
 * it records the event the route hands it, and the test plays its Postgres write through the real
 * `publishPgCachedDescription` (FOLLOW-1297: the Modal job and its callback route are deleted).
 *
 * @module apps/control-plane/src/app/api/adapt/description/route.follow1291-fence-pglite.test
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGlite db; schema type is wide
let testDb: ReturnType<typeof drizzlePglite<any>> | null = null;

interface DispatchedEvent {
  listing_revision?: number;
  cache_key: string;
  generation_model?: string;
}

const { pendingAfter, mockOriginal, dispatched } = vi.hoisted(() => ({
  pendingAfter: [] as Promise<unknown>[],
  mockOriginal: vi.fn<() => Promise<string>>(),
  dispatched: [] as DispatchedEvent[],
}));

vi.mock('@/lib/description-generator', () => ({
  // `lib/claim-containment` re-exports the stamp from the generator module.
  CLAIMS_VALIDATION_VERSION: 'claims-v1',
  generateDescription: (event: DispatchedEvent) => {
    dispatched.push(event);
    return Promise.resolve({
      outcome: { verdict: 'FIT', description: 'x', verifiedFacts: [] },
      headline: null,
      writes: { pg: 'published', redis: 'not_configured', audit: 'not_configured' },
    });
  },
}));

vi.mock('@estalara/db', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock importOriginal generic requires inline import() type
  const real = await importOriginal<typeof import('@estalara/db')>();
  return {
    ...real,
    createTenantClient: () => {
      if (!testDb) throw new Error('PGlite not initialised');
      return testDb;
    },
  };
});

vi.mock('@/lib/after-response', () => ({
  afterResponse: (task: () => Promise<unknown>) => {
    pendingAfter.push(task());
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: () => Promise.resolve({ ok: true, tenantId: TENANT_ID }),
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: () =>
    Promise.resolve({ enabled: false, overrideArchetype: null, overrideModel: null }),
}));

const { mockGlobalModel } = vi.hoisted(() => ({ mockGlobalModel: vi.fn<() => Promise<string>>() }));
vi.mock('@/lib/global-config-store', () => ({
  getGlobalGenerationModel: mockGlobalModel,
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: () => Promise.resolve({}),
}));

vi.mock('@/lib/listing-details', () => ({
  fetchListingOriginalDescription: mockOriginal,
}));

import { GET } from './route';
import { POST as listingUpdated } from '../../webhooks/listing-updated/route';
import { CLAIMS_VALIDATION_VERSION } from '@/lib/claim-containment';
import { publishPgCachedDescription } from '@/lib/description-pg-cache';

const TENANT_ID = '00000000-0000-4000-8000-000000001291';
const LISTING_ID = 'listing-f1291';
const ARCHETYPE = 'yield_hunter';
const SONNET = 'claude-sonnet-4-6';
const HAIKU = 'claude-haiku-4-5-20251001';
// Synthetic test value, built at runtime (gitleaks scans literals).
const WEBHOOK_SECRET = 'test-wh-'.concat('y'.repeat(24));

/**
 * The description-cache migrations, by number prefix — resolved from the migrations directory
 * at run time (0023 table → 0033 verdict → 0040 claims_validation → 0041 revision fence).
 */
const MIGRATION_PREFIXES = ['0023_', '0033_', '0040_', '0041_'];

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec('CREATE TABLE tenants (id uuid PRIMARY KEY);');
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dir = resolve(here, '../../../../../../../packages/db/migrations');
  const files = readdirSync(dir);
  for (const prefix of MIGRATION_PREFIXES) {
    const file = files.find((f) => f.startsWith(prefix) && f.endsWith('.sql'));
    if (!file) throw new Error(`migration ${prefix}* not found in ${dir}`);
    await pg.exec(readFileSync(resolve(dir, file), 'utf8'));
  }
  await pg.query('INSERT INTO tenants (id) VALUES ($1)', [TENANT_ID]);
  testDb = drizzlePglite(pg);
}, 60_000); // PGlite boot + four migrations: generous for a loaded CI runner

beforeEach(async () => {
  await pg.exec('DELETE FROM description_cache_persistent');
  await pg.exec('DELETE FROM listing_revisions').catch(() => undefined); // absent before 0041
  dispatched.length = 0;
  pendingAfter.length = 0;
  mockGlobalModel.mockResolvedValue(SONNET);
  mockOriginal.mockResolvedValue('Two-bed flat with a private pool.');
  vi.stubEnv('DATABASE_URL', 'pglite://in-memory');
  vi.stubEnv('LISTING_UPDATED_WEBHOOK_SECRET', WEBHOOK_SECRET);
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ─── Drivers ──────────────────────────────────────────────────────────────────

/** GET the description; returns the body after the route's after() tasks settle. */
async function read(): Promise<{ source: string; description: string }> {
  const res = await GET(
    new NextRequest(
      `http://localhost/api/adapt/description?listing_id=${LISTING_ID}&archetype=${ARCHETYPE}&locale=en`,
      { headers: { Authorization: 'Bearer pk-test' } },
    ),
  );
  await Promise.all(pendingAfter.splice(0));
  expect(res.status).toBe(200);
  return (await res.json()) as { source: string; description: string };
}

/** The listing.updated webhook. */
async function updateListing(): Promise<void> {
  const res = await listingUpdated(
    new NextRequest('http://localhost/api/webhooks/listing-updated', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WEBHOOK_SECRET },
      body: JSON.stringify({ tenant_id: TENANT_ID, listing_id: LISTING_ID }),
    }),
  );
  expect(res.status).toBe(200);
}

/** The generator's durable Postgres write for a dispatched event, as `description-generator.ts` makes it. */
function complete(
  event: DispatchedEvent,
  description: string,
  model: string = SONNET,
): ReturnType<typeof publishPgCachedDescription> {
  return publishPgCachedDescription({
    tenantId: TENANT_ID,
    listingId: LISTING_ID,
    archetype: ARCHETYPE,
    locale: 'en',
    description,
    headline: null,
    model,
    verdict: 'FIT',
    claimsValidation: CLAIMS_VALIDATION_VERSION,
    listingRevision: event.listing_revision ?? 0,
  });
}

async function activeRows(): Promise<{ description: string; model: string }[]> {
  const r = await pg.query<{ description: string; model: string }>(
    'SELECT description, model FROM description_cache_persistent WHERE invalidated_at IS NULL ORDER BY model',
  );
  return r.rows;
}

// ─── F-03 ─────────────────────────────────────────────────────────────────────

describe(
  'FOLLOW-1291 / F-03: a withdrawn fact cannot return after a listing.updated',
  { timeout: 30_000 },
  () => {
    it('a late write of the OLDER revision does not replace the newer row', async () => {
      // Job A is dispatched while the listing still says "private pool".
      expect((await read()).source).toBe('template_fallback');
      const jobA = dispatched[0]!;

      // The seller withdraws the pool. Job B is dispatched on the new text.
      await updateListing();
      mockOriginal.mockResolvedValue('Two-bed flat. No pool.');
      await read();
      const jobB = dispatched[1]!;

      // B finishes first; A, slow, finishes last.
      expect(await complete(jobB, 'A two-bed flat for investors.')).toBe('published');
      const late = await complete(jobA, 'A two-bed flat with a private pool.');

      // The buyer is served B's text, and only B's row is active.
      const served = await read();
      expect(served).toMatchObject({
        source: 'ai_cached',
        description: 'A two-bed flat for investors.',
      });
      expect(await activeRows()).toEqual([
        { description: 'A two-bed flat for investors.', model: SONNET },
      ]);
      expect(late).toBe('stale');

      // The stamps that made it so: revision read before grounding, on the event and the Redis key.
      expect(jobA.listing_revision).toBe(0);
      expect(jobB.listing_revision).toBe(1);
      expect(jobB.cache_key.endsWith(`:${SONNET}:r1`)).toBe(true);
    });

    it('a late write of the older revision is not published into the emptied cache either', async () => {
      await read();
      const jobA = dispatched[0]!;
      await updateListing(); // pool withdrawn; nothing regenerated yet

      const late = await complete(jobA, 'A two-bed flat with a private pool.');
      expect(late).toBe('stale');

      // The read misses (the seller's copy) and re-enqueues a job on the CURRENT revision.
      expect((await read()).source).toBe('template_fallback');
      expect(await activeRows()).toEqual([]);
      expect(dispatched.at(-1)?.listing_revision).toBe(1);
    });
  },
);

describe('FOLLOW-1291: no revision, no generation', { timeout: 30_000 }, () => {
  it('fails closed when the revision is unreadable (the control plane deployed before 0041)', async () => {
    await pg.exec('ALTER TABLE listing_revisions RENAME TO listing_revisions_hidden');
    try {
      const served = await read();
      expect(served.source).toBe('template_fallback');
      expect(dispatched).toEqual([]); // no generation: nothing it wrote could be fenced
    } finally {
      await pg.exec('ALTER TABLE listing_revisions_hidden RENAME TO listing_revisions');
    }
  });
});

// ─── F-17 ─────────────────────────────────────────────────────────────────────

describe(
  'FOLLOW-1291 / F-17: an old write of another model does not destroy the valid row',
  { timeout: 30_000 },
  () => {
    it('the current model’s row survives, and stays served', async () => {
      await read();
      const job = dispatched[0]!;
      expect(await complete(job, 'Sonnet copy for investors.', SONNET)).toBe('published');
      expect((await read()).description).toBe('Sonnet copy for investors.');

      // A write from a job dispatched under the previous global model (same revision) lands late.
      expect(await complete(job, 'Haiku copy from before the switch.', HAIKU)).toBe('published');

      expect(await read()).toMatchObject({
        source: 'ai_cached',
        description: 'Sonnet copy for investors.',
      });
      expect(await activeRows()).toEqual([
        { description: 'Haiku copy from before the switch.', model: HAIKU },
        { description: 'Sonnet copy for investors.', model: SONNET },
      ]);
    });

    it('a same-model regeneration at the same revision replaces the row in place (one active row)', async () => {
      await read();
      const job = dispatched[0]!;
      await complete(job, 'First generation.');
      await complete(job, 'Regenerated under the claim check.');
      expect(await activeRows()).toEqual([
        { description: 'Regenerated under the claim check.', model: SONNET },
      ]);
    });
  },
);
