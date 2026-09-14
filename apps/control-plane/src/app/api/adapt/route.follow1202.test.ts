/**
 * FOLLOW-1202 / CEO decision #3 (2026-09-13) — `reorder` fails CLOSED when any listing in the
 * batch cannot be scored by cosine. Text directives stay fail-open.
 *
 * WHAT THIS PINS. Before this ticket `buildReorderDirective()` scored an un-embedded listing with
 * a djb2 hash (uniform on `[0, 1)`) and sorted it in ONE array with the embedded listings' cosine
 * similarities (`[-1, 1]`, unclamped, typically ~0.1-0.5 for text pairs), then served the result
 * as `score_function: 'archetype_affinity'`. In a mixed batch the un-embedded listings therefore
 * outranked the embedded ones more often than not (audit 2026-09-13 E-3): a pseudo-random order
 * read as a fitted ranking.
 *
 * THE RULE. A batch is all-cosine, or it gets no `reorder`. The withholding is countable:
 *   - the decision row's `features_snapshot` carries `reorder_withheld` (written on every
 *     deployment, no flag-gated column needed);
 *   - `scoring_path` keeps its FOLLOW-560 value (`djb2_fallback` / `djb2_guard`), so a localhost
 *     run with an unseeded listing still shows WHY in AC(3)'s distribution (RETRO-332 §5a);
 *   - one `console.warn` per withheld batch names the reason code.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow1202.test
 */

vi.mock('next/server', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('next/server');
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => {
      void fn();
    }),
  };
});

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

vi.mock('@/lib/llm-gateway', () => ({
  callLlmGateway: vi.fn().mockResolvedValue(null),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi
    .fn()
    .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]),
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/embedding-lookup', () => ({
  fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
  fetchListingEmbeddings: vi.fn().mockResolvedValue(new Map()),
  LISTING_EMBEDDING_BATCH_LIMIT: 20,
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  })),
  tenants: {},
  demoOverrides: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn().mockResolvedValue({
    enabled: false,
    overrideArchetype: null,
    overrideModel: 'claude-sonnet-4-6',
  }),
  DEMO_OVERRIDE_CONFIDENCE: 0.95,
  DEMO_OVERRIDE_SIMILARITY: 0.75,
}));

vi.mock('@/lib/demo-jwt-verify', () => ({
  verifyDemoJwt: vi.fn().mockResolvedValue({}),
  DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
  DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
}));

vi.mock('@estalara/shared', async () => {
  const mod = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  return {
    ...mod,
    assignHoldout: vi.fn().mockResolvedValue({
      holdout_group: false,
      skipped: false,
      assigned_at: new Date().toISOString(),
    }),
    thompsonSample: vi.fn().mockReturnValue('control'),
  };
});

vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi
    .fn()
    .mockResolvedValue({ ok: true, tenantId: '550e8400-e29b-41d4-a716-446655440001' }),
}));

import { POST } from './route';
import { getTenantSchema } from '@/lib/tenant-schema';
import { fetchArchetypeEmbedding, fetchListingEmbeddings } from '@/lib/embedding-lookup';

const mockGetTenantSchema = vi.mocked(getTenantSchema);
const mockFetchArchetypeEmbedding = vi.mocked(fetchArchetypeEmbedding);
const mockFetchListingEmbeddings = vi.mocked(fetchListingEmbeddings);

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';
const CLICKHOUSE_URL = 'http://localhost:8123';

const REORDER_SCHEMA = {
  reorder_capable: true,
  container_selector: '[data-estalara-listings-grid]',
  item_selector: '[data-estalara-listing-id]',
};

/** Above the server gate, so the text-directive branch runs and serves something to compare. */
const BODY = {
  tenant_id: TENANT_ID,
  session_id: 'sess-follow1202',
  page_type: 'listing_list' as const,
  archetype_hint: 'diaspora_buyer',
  confidence: 0.8,
  similarity: 0.9,
};

/** Unit archetype vector: a listing's cosine against it is exactly its first component. */
const ARCHETYPE_VEC = [1, 0];
/** A unit vector whose cosine against `ARCHETYPE_VEC` is `c`. */
const unitWithCosine = (c: number): number[] => [c, Math.sqrt(1 - c * c)];

const FOUR_IDS = ['embedded-high', 'unembedded-a', 'embedded-low', 'unembedded-b'];

/** The audit's E-3 batch: two embedded listings (cosine 0.3, 0.25), two with no row. */
const MIXED = new Map<string, number[] | null>([
  ['embedded-high', unitWithCosine(0.3)],
  ['embedded-low', unitWithCosine(0.25)],
]);

/** The same four listings, all embedded. */
const ALL_EMBEDDED = new Map<string, number[] | null>([
  ['embedded-high', unitWithCosine(0.3)],
  ['unembedded-a', unitWithCosine(0.1)],
  ['embedded-low', unitWithCosine(0.25)],
  ['unembedded-b', unitWithCosine(-0.2)],
]);

interface Directive {
  type: string;
  slot?: string;
  scores?: { listing_id: string; score: number }[];
}

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

describe('FOLLOW-1202 — reorder fails closed on any non-cosine score', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  async function adapt(listingIds: string[]): Promise<{
    directives: Directive[];
    snapshot: Record<string, unknown>;
    scoringPath: string | null;
  }> {
    mockFetch.mockClear();
    const res = await POST(makePostRequest({ ...BODY, listing_ids: listingIds }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { directives: Directive[] };
    await new Promise((r) => setTimeout(r, 0));
    // The adaptation_decisions INSERT is the first ClickHouse write of the request.
    const insert = mockFetch.mock.calls
      .map(([u, init]) => ({
        url: new URL(String(u)),
        body: (init as { body?: string } | undefined)?.body ?? '',
      }))
      .find((c) => c.body.includes('adaptation_decisions'));
    expect(insert, 'an adaptation_decisions INSERT was issued').toBeDefined();
    return {
      directives: json.directives,
      snapshot: JSON.parse(
        insert!.url.searchParams.get('param_p_features_snapshot') ?? '{}',
      ) as Record<string, unknown>,
      scoringPath: insert!.url.searchParams.get('param_p_scoring_path'),
    };
  }

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    vi.stubEnv('CLICKHOUSE_URL', CLICKHOUSE_URL);
    vi.stubEnv('SCORING_PATH_COLUMN_ENABLED', 'true');
    vi.stubEnv('DEMO_MODE_JWT_SECRET', 'test-secret-32-chars-long-enough!!');
    mockGetTenantSchema.mockResolvedValue(REORDER_SCHEMA);
    mockFetchArchetypeEmbedding.mockResolvedValue(ARCHETYPE_VEC);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('4-listing rank test: 2 embedded + 2 not → NO reorder, reason code on the decision row', async () => {
    mockFetchListingEmbeddings.mockResolvedValue(MIXED);

    const { directives, snapshot, scoringPath } = await adapt(FOUR_IDS);

    // The behaviour, asserted first so a pre-fix run fails HERE, printing the mixed ranking.
    const reorder = directives.find((d) => d.type === 'reorder');
    expect(reorder?.scores ?? null, 'a mixed batch must not be served as a ranking').toBeNull();

    expect(snapshot.reorder_withheld).toBe('embeddings_missing');
    // FOLLOW-560's value is kept, so the unseeded listing stays visible to AC(3).
    expect(scoringPath).toBe('djb2_fallback');
    const warned = warnSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(warned).toContain('reorder_withheld=embeddings_missing');
  });

  it('the same four listings, all embedded → reorder ranked by cosine alone', async () => {
    mockFetchListingEmbeddings.mockResolvedValue(ALL_EMBEDDED);

    const { directives, snapshot, scoringPath } = await adapt(FOUR_IDS);

    const reorder = directives.find((d) => d.type === 'reorder');
    expect(reorder).toBeDefined();
    expect(reorder!.scores!.map((s) => s.listing_id)).toEqual([
      'embedded-high',
      'embedded-low',
      'unembedded-a',
      'unembedded-b',
    ]);
    // Cosine is NOT clamped to [0, 1]: the negative score reaches the wire as computed.
    expect(reorder!.scores!.map((s) => s.score)).toEqual([
      expect.closeTo(0.3, 10),
      expect.closeTo(0.25, 10),
      expect.closeTo(0.1, 10),
      expect.closeTo(-0.2, 10),
    ]);
    expect(snapshot).not.toHaveProperty('reorder_withheld');
    expect(scoringPath).toBe('cosine');
  });

  it('text directives are unaffected: a withheld batch serves the same text as a ranked one', async () => {
    mockFetchListingEmbeddings.mockResolvedValue(ALL_EMBEDDED);
    const ranked = await adapt(FOUR_IDS);
    mockFetchListingEmbeddings.mockResolvedValue(MIXED);
    const withheld = await adapt(FOUR_IDS);

    const text = (ds: Directive[]) => ds.filter((d) => d.type !== 'reorder');
    expect(text(ranked.directives).length).toBeGreaterThan(0);
    expect(text(withheld.directives)).toEqual(text(ranked.directives));
    expect(withheld.directives.some((d) => d.type === 'reorder')).toBe(false);
  });

  it('archetype embedding missing → every listing is un-scorable → no reorder', async () => {
    mockFetchArchetypeEmbedding.mockResolvedValue(null);
    mockFetchListingEmbeddings.mockResolvedValue(ALL_EMBEDDED);

    const { directives, snapshot, scoringPath } = await adapt(FOUR_IDS);

    expect(directives.some((d) => d.type === 'reorder')).toBe(false);
    expect(snapshot.reorder_withheld).toBe('embeddings_missing');
    expect(scoringPath).toBe('djb2_fallback');
  });

  it('one listing with a dimension-mismatched embedding → no reorder', async () => {
    mockFetchListingEmbeddings.mockResolvedValue(
      new Map([...ALL_EMBEDDED, ['unembedded-b', [0.1, 0.2, 0.3]]]),
    );

    const { directives, snapshot } = await adapt(FOUR_IDS);

    expect(directives.some((d) => d.type === 'reorder')).toBe(false);
    expect(snapshot.reorder_withheld).toBe('embeddings_missing');
  });

  it('batch over LISTING_EMBEDDING_BATCH_LIMIT (never attempted) → no reorder, own reason code', async () => {
    const manyIds = Array.from({ length: 21 }, (_, i) => `listing-${String(i)}`);

    const { directives, snapshot, scoringPath } = await adapt(manyIds);

    expect(mockFetchArchetypeEmbedding).not.toHaveBeenCalled();
    expect(directives.some((d) => d.type === 'reorder')).toBe(false);
    expect(snapshot.reorder_withheld).toBe('embeddings_not_attempted');
    expect(scoringPath).toBe('djb2_guard');
  });

  it('a request with no listing_ids records no reason code (nothing was withheld)', async () => {
    const { snapshot, scoringPath } = await adapt([]);

    expect(snapshot).not.toHaveProperty('reorder_withheld');
    expect(scoringPath).toBe('not_applicable');
  });
});
