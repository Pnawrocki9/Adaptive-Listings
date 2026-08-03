/**
 * Tests for TICKET-AB-011 — getTenantSchema() DB lookup + Redis cache.
 *
 * Coverage:
 *   - Demo tenant → DEMO_SCHEMA (no DB/Redis call)
 *   - Redis cache hit → returns cached schema, no DB call
 *   - Redis cache miss → DB call → schema returned + cache populated
 *   - DB miss (null rows) → null returned
 *   - DB error → null returned (fail-open)
 *   - Redis read error → falls through to DB
 *   - Schema with index_schema.reorder_capable=false → returns {reorder_capable: false}
 *
 * @module apps/control-plane/src/lib/__tests__/tenant-schema.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock @estalara/db before import ───────────────────────────────────────────
vi.mock('@estalara/db', () => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockWhere = vi.fn();
  const mockOrderBy = vi.fn();
  const mockLimit = vi.fn();

  // Chain: db.select().from().where().orderBy().limit()
  mockLimit.mockResolvedValue([]);
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });

  const mockDb = { select: mockSelect };
  const createAdminClient = vi.fn().mockReturnValue(mockDb);

  return {
    createAdminClient,
    tenantSiteSchemas: { schema: 'schema', tenantId: 'tenant_id', updatedAt: 'updated_at' },
    // eq is used in the where clause — return a mock predicate
    eq: vi.fn((_col: unknown, _val: unknown) => 'eq-predicate'),
  };
});

import { getTenantSchema, invalidateTenantSchemaCache, DEMO_SCHEMA } from '../tenant-schema.js';
import { createAdminClient } from '@estalara/db';

const mockCreateAdminClient = vi.mocked(createAdminClient);

// Helper: set up the DB mock chain to return given rows
function mockDbRows(rows: { schema: unknown }[]) {
  const mockLimit = vi.fn().mockResolvedValue(rows);
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  mockCreateAdminClient.mockReturnValue({ select: mockSelect } as unknown as ReturnType<
    typeof createAdminClient
  >);
  return { mockSelect, mockFrom, mockWhere, mockOrderBy, mockLimit };
}

// Helper: Redis GET response
function stubRedisGet(value: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('/get/')) {
        return Promise.resolve(new Response(JSON.stringify({ result: value }), { status: 200 }));
      }
      // Redis SET (fire-and-forget) — always succeed
      return Promise.resolve(new Response('', { status: 200 }));
    }),
  );
}

// Helper: Redis GET returns non-ok (simulate error)
function stubRedisError() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('/get/')) {
        return Promise.resolve(new Response('', { status: 500 }));
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }),
  );
}

describe('getTenantSchema() — TICKET-AB-011', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.test.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // ── AC-4: Demo tenant always returns DEMO_SCHEMA ──────────────────────────

  it('AC-4: est_demo_tenant → DEMO_SCHEMA (no DB or Redis call)', async () => {
    const result = await getTenantSchema('est_demo_tenant');
    expect(result).toEqual(DEMO_SCHEMA);
    expect(result?.reorder_capable).toBe(true);
    expect(result?.container_selector).toBe('[data-estalara-listings-grid]');
    // DB should not have been called
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  // ── AC-2: Redis cache hit ─────────────────────────────────────────────────

  it('AC-2: Redis cache hit → returns cached schema, DB not called', async () => {
    const cachedSchema = {
      reorder_capable: true,
      container_selector: '[data-listings]',
      item_selector: '[data-listing]',
    };
    stubRedisGet(JSON.stringify(cachedSchema));

    const result = await getTenantSchema('tenant-abc-123');

    expect(result).toEqual(cachedSchema);
    // DB must NOT have been called
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('AC-2: Redis cache hit with null → returns null without DB call', async () => {
    stubRedisGet(JSON.stringify(null));

    const result = await getTenantSchema('tenant-no-schema');

    expect(result).toBeNull();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  // ── AC-1: Cache miss → DB lookup ─────────────────────────────────────────

  it('AC-1: cache miss → DB called, reorder_capable schema returned', async () => {
    stubRedisGet(null); // cache miss

    const schemaBlob = {
      index_schema: {
        reorder_capable: true,
        container_selector: '[data-estalara-listings-grid]',
        listing_card_selector: '[data-estalara-listing-id]',
      },
    };
    mockDbRows([{ schema: schemaBlob }]);

    const result = await getTenantSchema('tenant-real-001');

    expect(result).not.toBeNull();
    expect(result?.reorder_capable).toBe(true);
    expect(result?.container_selector).toBe('[data-estalara-listings-grid]');
    expect(mockCreateAdminClient).toHaveBeenCalledOnce();
  });

  it('AC-1: DB returns null schema → result is null', async () => {
    stubRedisGet(null);
    mockDbRows([]); // empty result set

    const result = await getTenantSchema('tenant-no-rows');

    expect(result).toBeNull();
    expect(mockCreateAdminClient).toHaveBeenCalledOnce();
  });

  // ── AC-3: Graceful null on error ──────────────────────────────────────────

  it('AC-3: DB throws → null returned, no rethrow', async () => {
    stubRedisGet(null);

    // Make DB throw
    mockCreateAdminClient.mockImplementation(() => {
      throw new Error('DB connection refused');
    });

    const result = await getTenantSchema('tenant-db-error');

    expect(result).toBeNull();
    // No exception should propagate
  });

  it('AC-3: Redis read fails → falls through to DB', async () => {
    stubRedisError(); // Redis GET returns 500

    const schemaBlob = {
      index_schema: {
        reorder_capable: false,
        container_selector: '',
        listing_card_selector: '.listing-card',
      },
    };
    mockDbRows([{ schema: schemaBlob }]);

    const result = await getTenantSchema('tenant-redis-error');

    // Should still return the DB result
    expect(result).not.toBeNull();
    expect(result?.reorder_capable).toBe(false);
    expect(mockCreateAdminClient).toHaveBeenCalledOnce();
  });

  // ── UPSTASH_REDIS_URL not configured ─────────────────────────────────────

  it('no UPSTASH_REDIS_URL → no Redis call, falls straight to DB', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');

    const schemaBlob = {
      index_schema: {
        reorder_capable: true,
        container_selector: '[data-grid]',
        listing_card_selector: '[data-card]',
      },
    };
    mockDbRows([{ schema: schemaBlob }]);

    const result = await getTenantSchema('tenant-no-redis');

    expect(result?.reorder_capable).toBe(true);
    expect(mockCreateAdminClient).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// slot_selectors extraction — FOLLOW-796 AC-4 (re-files RETRO-093 §4c TG-1)
//
// The extractor (tenant-schema.ts, the `detail_schema.slot_selectors` block) was shipped
// by FOLLOW-340 with no test at all. It projects `SelectorStrategy.primary` only, skips
// non-string / empty primaries, omits the field entirely when nothing survives, and is
// wrapped in a fail-safe catch. These tests pin that PRE-EXISTING behaviour — none of it
// is changed by FOLLOW-796.
//
// Boundary note (FOLLOW-796): the extractor deliberately keeps the DETECTION vocabulary
// keys verbatim (`cta_primary` stays `cta_primary` on the wire). The rename to the
// ADAPTATION vocabulary (`cta`) happens client-side in
// packages/sdk/src/core/annotate-slots.ts, which is the single choke-point for every
// producer (11 auto-detect techniques + the curated DB schema).
// ─────────────────────────────────────────────────────────────────────────────

describe('getTenantSchema() — detail_schema.slot_selectors extraction (FOLLOW-796 AC-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('UPSTASH_REDIS_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('projects SelectorStrategy.primary only (fallbacks/type are dropped)', async () => {
    mockDbRows([
      {
        schema: {
          index_schema: { reorder_capable: true },
          detail_schema: {
            slot_selectors: {
              headline: { primary: 'h1.listing-title', fallbacks: ['.title'], type: 'text' },
              cta_primary: { primary: 'a.btn-book', fallbacks: [], type: 'text' },
            },
          },
        },
      },
    ]);

    const result = await getTenantSchema('tenant-slots-001');

    expect(result?.slot_selectors).toEqual({
      headline: 'h1.listing-title',
      cta_primary: 'a.btn-book',
    });
  });

  it('keeps the detection-vocabulary keys verbatim — no server-side rename', async () => {
    mockDbRows([
      {
        schema: {
          index_schema: { reorder_capable: false },
          detail_schema: { slot_selectors: { cta_primary: { primary: 'a.btn-book' } } },
        },
      },
    ]);

    const result = await getTenantSchema('tenant-slots-verbatim');

    // The wire contract is the detail_schema namespace (documented on
    // AdaptationDirectives.slot_selectors). The SDK translates cta_primary → cta.
    expect(Object.keys(result?.slot_selectors ?? {})).toEqual(['cta_primary']);
    expect(result?.slot_selectors?.cta).toBeUndefined();
  });

  it('skips entries whose primary is not a string, or is an empty string', async () => {
    mockDbRows([
      {
        schema: {
          index_schema: { reorder_capable: true },
          detail_schema: {
            slot_selectors: {
              headline: { primary: 'h1' }, // valid → kept
              description: { primary: '' }, // empty → skipped
              cta_primary: { primary: 42 }, // non-string → skipped
              tagline: { primary: null }, // null → skipped
              features_list: { primary: { nested: 'x' } }, // object → skipped
            },
          },
        },
      },
    ]);

    const result = await getTenantSchema('tenant-slots-002');

    expect(result?.slot_selectors).toEqual({ headline: 'h1' });
  });

  it('skips entries whose strategy value is not an object', async () => {
    mockDbRows([
      {
        schema: {
          index_schema: { reorder_capable: true },
          detail_schema: {
            slot_selectors: {
              headline: 'h1.listing-title', // bare string, not a SelectorStrategy → skipped
              description: null, // → skipped
              cta_primary: { primary: 'a.btn' }, // valid → kept
            },
          },
        },
      },
    ]);

    const result = await getTenantSchema('tenant-slots-003');

    expect(result?.slot_selectors).toEqual({ cta_primary: 'a.btn' });
  });

  it('omits slot_selectors entirely when no entry survives the projection', async () => {
    mockDbRows([
      {
        schema: {
          index_schema: { reorder_capable: true },
          detail_schema: { slot_selectors: { headline: { primary: '' } } },
        },
      },
    ]);

    const result = await getTenantSchema('tenant-slots-004');

    expect(result).not.toBeNull();
    expect(result?.reorder_capable).toBe(true);
    expect('slot_selectors' in (result as object)).toBe(false);
  });

  it('omits slot_selectors when detail_schema (or its slot_selectors) is absent', async () => {
    mockDbRows([{ schema: { index_schema: { reorder_capable: true } } }]);

    const result = await getTenantSchema('tenant-slots-005');

    expect(result?.reorder_capable).toBe(true);
    expect(result?.slot_selectors).toBeUndefined();
  });

  it('fail-safe: a throwing detail_schema access leaves the rest of the schema intact', async () => {
    // Simulates any hostile/unexpected shape reaching the extractor block: the catch must
    // swallow it so a schema lookup is never blocked by slot-selector extraction.
    const hostile: Record<string, unknown> = { index_schema: { reorder_capable: true } };
    Object.defineProperty(hostile, 'detail_schema', {
      enumerable: true,
      get() {
        throw new Error('hostile detail_schema getter');
      },
    });
    mockDbRows([{ schema: hostile }]);

    const result = await getTenantSchema('tenant-slots-006');

    expect(result).not.toBeNull();
    expect(result?.reorder_capable).toBe(true);
    expect(result?.slot_selectors).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// invalidateTenantSchemaCache() — FOLLOW-018
// ─────────────────────────────────────────────────────────────────────────────

describe('invalidateTenantSchemaCache() — FOLLOW-018', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.test.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('calls Redis DEL for schema:{tenantId}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await invalidateTenantSchemaCache('test-tenant-uuid');

    // Should have issued exactly one fetch call
    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl] = fetchMock.mock.calls[0] as [string, unknown];
    // URL must reference the DEL endpoint and the encoded key
    expect(calledUrl).toContain('/del/');
    expect(calledUrl).toContain(encodeURIComponent('schema:test-tenant-uuid'));
  });

  it('swallows fetch errors and calls console.warn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Must not throw
    await expect(invalidateTenantSchemaCache('tenant-err')).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      '[tenant-schema] cache invalidation failed for',
      'tenant-err',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it('no-ops silently when UPSTASH_REDIS_URL is not set', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(invalidateTenantSchemaCache('tenant-no-redis')).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cache invalidation round-trip: getTenantSchema hits DB again after invalidation', async () => {
    const schemaBlob = {
      index_schema: {
        reorder_capable: true,
        container_selector: '[data-grid]',
        listing_card_selector: '[data-card]',
      },
    };

    // Track fetch calls in order: GET (cache miss) → SET (populate) → ...
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      const urlStr = String(url);
      callIndex++;

      if (urlStr.includes('/del/')) {
        // DEL command — success
        return Promise.resolve(new Response(JSON.stringify({ result: 1 }), { status: 200 }));
      }

      if (urlStr.includes('/get/')) {
        // First and third GET: cache miss (returns null).
        // On the second pass (after invalidation), the cache is also empty.
        return Promise.resolve(new Response(JSON.stringify({ result: null }), { status: 200 }));
      }

      // SET command — always succeed
      return Promise.resolve(new Response('', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    // First call: cache miss → DB lookup
    mockDbRows([{ schema: schemaBlob }]);
    const result1 = await getTenantSchema('tenant-roundtrip');
    expect(result1?.reorder_capable).toBe(true);
    expect(mockCreateAdminClient).toHaveBeenCalledTimes(1);

    // Invalidate the cache
    await invalidateTenantSchemaCache('tenant-roundtrip');

    // Verify DEL was issued
    const delCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/del/'));
    expect(delCall).toBeDefined();

    // Third getTenantSchema call: cache miss again → DB lookup again
    mockDbRows([{ schema: schemaBlob }]);
    const result2 = await getTenantSchema('tenant-roundtrip');
    expect(result2?.reorder_capable).toBe(true);
    // DB must have been called a second time (total: 2)
    expect(mockCreateAdminClient).toHaveBeenCalledTimes(2);

    // Suppress unused variable warning
    void callIndex;
  });
});
