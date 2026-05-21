/**
 * Tests for TICKET-AB-011 — getTenantSchema() Redis cache + API fallback.
 *
 * Coverage:
 *   - Demo tenant → DEMO_SCHEMA, no network calls
 *   - Redis cache hit → cached schema returned, no API call
 *   - Redis cache miss → API call made → schema returned + cache populated
 *   - API call returns null → null returned
 *   - API call fails → null returned (fail-open)
 *   - No UPSTASH_REDIS_URL → falls straight to API
 *   - No SCHEMA_API_URL → null returned (no DB available)
 *   - buildReorderDirective + getTenantSchema integration
 *
 * @module apps/decision-api/src/lib/__tests__/reorder.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getTenantSchema, buildReorderDirective } from '../reorder.js';
import type { TenantSchemaEnv } from '../reorder.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCHEMA_API_URL = 'https://api.estalara.test/api/internal/schema';
const REDIS_URL = 'https://redis.test.upstash.io';

const SAMPLE_SCHEMA = {
  reorder_capable: true,
  container_selector: '[data-listings-grid]',
  item_selector: '[data-listing-card]',
};

function makeEnv(overrides: Partial<TenantSchemaEnv> = {}): TenantSchemaEnv {
  return {
    UPSTASH_REDIS_URL: REDIS_URL,
    UPSTASH_REDIS_TOKEN: 'test-token',
    SCHEMA_API_URL,
    SCHEMA_API_TOKEN: 'internal-secret',
    ...overrides,
  };
}

/**
 * Stub global fetch to simulate Redis GET + SET and Schema API calls.
 * Returns spy so tests can assert call count.
 */
function stubFetch(redisValue: string | null, apiResponse: unknown): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((url: unknown) => {
    const urlStr = String(url);
    if (urlStr.includes(REDIS_URL) && urlStr.includes('/get/')) {
      return Promise.resolve(new Response(JSON.stringify({ result: redisValue }), { status: 200 }));
    }
    if (urlStr.includes(REDIS_URL) && urlStr.includes('/set/')) {
      // Fire-and-forget SET
      return Promise.resolve(new Response('', { status: 200 }));
    }
    if (urlStr.includes(SCHEMA_API_URL)) {
      return Promise.resolve(new Response(JSON.stringify(apiResponse), { status: 200 }));
    }
    return Promise.resolve(new Response('', { status: 404 }));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getTenantSchema() — TICKET-AB-011 decision-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── AC-4: Demo tenant ────────────────────────────────────────────────────

  it('AC-4: est_demo_tenant → DEMO_SCHEMA, no fetch calls', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);

    const result = await getTenantSchema('est_demo_tenant', makeEnv());

    expect(result?.reorder_capable).toBe(true);
    expect(result?.container_selector).toBe('[data-estalara-listings-grid]');
    expect(spy).not.toHaveBeenCalled();
  });

  // ── AC-2: Redis cache hit ────────────────────────────────────────────────

  it('AC-2: Redis cache hit → schema returned, schema API NOT called', async () => {
    const spy = stubFetch(JSON.stringify(SAMPLE_SCHEMA), null);

    const result = await getTenantSchema('tenant-abc', makeEnv());

    expect(result).toEqual(SAMPLE_SCHEMA);
    // Verify fetch was called for Redis GET only (not the schema API)
    const apiCalls = spy.mock.calls.filter((args) => String(args[0]).includes(SCHEMA_API_URL));
    expect(apiCalls).toHaveLength(0);
  });

  it('AC-2: Redis cache hit with null → returns null without schema API call', async () => {
    const spy = stubFetch(JSON.stringify(null), SAMPLE_SCHEMA);

    const result = await getTenantSchema('tenant-null-cache', makeEnv());

    expect(result).toBeNull();
    const apiCalls = spy.mock.calls.filter((args) => String(args[0]).includes(SCHEMA_API_URL));
    expect(apiCalls).toHaveLength(0);
  });

  // ── AC-1: Cache miss → API call ─────────────────────────────────────────

  it('AC-1: Redis cache miss → schema API called → schema returned', async () => {
    const spy = stubFetch(null, SAMPLE_SCHEMA);

    const result = await getTenantSchema('tenant-cache-miss', makeEnv());

    expect(result).toEqual(SAMPLE_SCHEMA);
    // Verify schema API was called
    const apiCalls = spy.mock.calls.filter((args) => String(args[0]).includes(SCHEMA_API_URL));
    expect(apiCalls).toHaveLength(1);
  });

  it('AC-1: cache miss → API returns null → null returned', async () => {
    const spy = stubFetch(null, null);

    const result = await getTenantSchema('tenant-api-null', makeEnv());

    expect(result).toBeNull();
    const apiCalls = spy.mock.calls.filter((args) => String(args[0]).includes(SCHEMA_API_URL));
    expect(apiCalls).toHaveLength(1);
  });

  // ── AC-3: Graceful null on error ─────────────────────────────────────────

  it('AC-3: API call fails → null returned (fail-open)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes(REDIS_URL) && urlStr.includes('/get/')) {
          return Promise.resolve(new Response(JSON.stringify({ result: null }), { status: 200 }));
        }
        // Schema API throws
        return Promise.reject(new Error('network error'));
      }),
    );

    const result = await getTenantSchema('tenant-api-error', makeEnv());

    expect(result).toBeNull();
  });

  it('AC-3: Redis throws → falls through to API', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes(REDIS_URL) && urlStr.includes('/get/')) {
          return Promise.reject(new Error('redis connection refused'));
        }
        if (urlStr.includes(SCHEMA_API_URL)) {
          callCount++;
          return Promise.resolve(new Response(JSON.stringify(SAMPLE_SCHEMA), { status: 200 }));
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );

    const result = await getTenantSchema('tenant-redis-throws', makeEnv());

    expect(result).toEqual(SAMPLE_SCHEMA);
    expect(callCount).toBe(1);
  });

  // ── No env configuration ────────────────────────────────────────────────

  it('no UPSTASH_REDIS_URL → falls straight to API', async () => {
    const spy = stubFetch(null, SAMPLE_SCHEMA);

    // Build env without UPSTASH_REDIS_URL (omit the key, not set to undefined)
    const envNoRedis: TenantSchemaEnv = {
      UPSTASH_REDIS_TOKEN: 'test-token',
      SCHEMA_API_URL,
      SCHEMA_API_TOKEN: 'internal-secret',
    };
    const result = await getTenantSchema('tenant-no-redis', envNoRedis);

    expect(result).toEqual(SAMPLE_SCHEMA);
    // No Redis GET call — only schema API
    const redisCalls = spy.mock.calls.filter((args) => String(args[0]).includes(REDIS_URL));
    expect(redisCalls).toHaveLength(0);
  });

  it('no SCHEMA_API_URL → null returned when cache misses', async () => {
    const spy = stubFetch(null, null);

    // Build env without SCHEMA_API_URL (omit the key, not set to undefined)
    const envNoApi: TenantSchemaEnv = {
      UPSTASH_REDIS_URL: REDIS_URL,
      UPSTASH_REDIS_TOKEN: 'test-token',
      SCHEMA_API_TOKEN: 'internal-secret',
    };
    const result = await getTenantSchema('tenant-no-api', envNoApi);

    expect(result).toBeNull();
    const apiCalls = spy.mock.calls.filter((args) => String(args[0]).includes(SCHEMA_API_URL));
    expect(apiCalls).toHaveLength(0);
  });

  // ── Cache population ─────────────────────────────────────────────────────

  it('AC-2: after cache miss + API hit, Redis SET is called (fire-and-forget)', async () => {
    const spy = stubFetch(null, SAMPLE_SCHEMA);

    await getTenantSchema('tenant-cache-populate', makeEnv());
    // Allow fire-and-forget to settle
    await Promise.resolve();

    const redisSets = spy.mock.calls.filter((args) => String(args[0]).includes('/set/'));
    expect(redisSets.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── buildReorderDirective tests ──────────────────────────────────────────────

describe('buildReorderDirective()', () => {
  it('reorder_capable=false → null', () => {
    const result = buildReorderDirective({ reorder_capable: false }, ['a', 'b'], 'investor', 0.9);
    expect(result).toBeNull();
  });

  it('missing container_selector → null', () => {
    const result = buildReorderDirective({ reorder_capable: true }, ['a', 'b'], 'investor', 0.9);
    expect(result).toBeNull();
  });

  it('reorder_capable=true + container_selector → valid ReorderDirective', () => {
    const result = buildReorderDirective(
      { reorder_capable: true, container_selector: '[data-grid]', item_selector: '[data-card]' },
      ['listing-a', 'listing-b', 'listing-c'],
      'family',
      0.85,
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe('reorder');
    expect(result!.container_selector).toBe('[data-grid]');
    expect(result!.item_selector).toBe('[data-card]');
    expect(result!.score_function).toBe('archetype_affinity');
    expect(result!.scores).toHaveLength(3);
    expect(result!.archetype).toBe('family');
    expect(result!.confidence).toBe(0.85);
  });

  it('scores are sorted descending', () => {
    const result = buildReorderDirective(
      { reorder_capable: true, container_selector: '[grid]' },
      ['alpha', 'beta', 'gamma', 'delta'],
      'neutral',
      0.5,
    );
    const scores = result!.scores.map((s) => s.score);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]!).toBeGreaterThanOrEqual(scores[i + 1]!);
    }
  });

  it('default item_selector used when not provided', () => {
    const result = buildReorderDirective(
      { reorder_capable: true, container_selector: '[grid]' },
      ['x'],
      'investor',
      0.9,
    );
    expect(result!.item_selector).toBe('[data-estalara-listing-id]');
  });
});

// ─── FOLLOW-019: affinity scoring (cosine + djb2 fallback) ────────────────────

describe('buildReorderDirective() — FOLLOW-019 affinity scoring', () => {
  const SCHEMA = {
    reorder_capable: true,
    container_selector: '[grid]',
    item_selector: '[card]',
  };

  /**
   * Compute the djb2 deterministic score externally so we can assert equality
   * with the fallback path (same algorithm as deterministicScore in reorder.ts).
   */
  function djb2(archetype: string, listingId: string): number {
    const key = `${archetype}:${listingId}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    return (hash % 10000) / 10000;
  }

  /**
   * Compute cosine externally — mirrors computeCosineSimilarity in reorder.ts.
   */
  function cosine(a: number[], b: number[]): number {
    let dot = 0;
    let mA = 0;
    let mB = 0;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dot += ai * bi;
      mA += ai * ai;
      mB += bi * bi;
    }
    return dot / (Math.sqrt(mA) * Math.sqrt(mB));
  }

  it('AC-3: uses cosine similarity when both embeddings present', () => {
    const archetypeEmb = [1, 0, 0];
    const listingEmbs = new Map<string, number[] | null>([
      ['a', [1, 0, 0]], // cosine = 1.0
      ['b', [0, 1, 0]], // cosine = 0.0
      ['c', [-1, 0, 0]], // cosine = -1.0
    ]);

    const result = buildReorderDirective(
      SCHEMA,
      ['a', 'b', 'c'],
      'investor',
      0.9,
      archetypeEmb,
      listingEmbs,
    );

    expect(result).not.toBeNull();
    const byId = Object.fromEntries(result!.scores.map((s) => [s.listing_id, s.score]));
    expect(byId.a).toBeCloseTo(1.0, 10);
    expect(byId.b).toBeCloseTo(0.0, 10);
    expect(byId.c).toBeCloseTo(-1.0, 10);

    // Top-ranked must be 'a' (highest cosine).
    expect(result!.scores[0]!.listing_id).toBe('a');
    expect(result!.scores[result!.scores.length - 1]!.listing_id).toBe('c');
  });

  it('AC-4: falls back to djb2 when listing embedding is null', () => {
    const archetypeEmb = [1, 0, 0];
    const listingEmbs = new Map<string, number[] | null>([['a', null]]);

    const result = buildReorderDirective(SCHEMA, ['a'], 'investor', 0.9, archetypeEmb, listingEmbs);

    expect(result!.scores[0]!.score).toBeCloseTo(djb2('investor', 'a'), 10);
  });

  it('AC-4: falls back to djb2 when archetype embedding is null', () => {
    const listingEmbs = new Map<string, number[] | null>([['a', [1, 0, 0]]]);

    const result = buildReorderDirective(SCHEMA, ['a'], 'investor', 0.9, null, listingEmbs);

    expect(result!.scores[0]!.score).toBeCloseTo(djb2('investor', 'a'), 10);
  });

  it('AC-4: falls back to djb2 when embedding map missing for a listing', () => {
    const archetypeEmb = [1, 0, 0];
    // Map present but does not contain entry for 'b'.
    const listingEmbs = new Map<string, number[] | null>([['a', [1, 0, 0]]]);

    const result = buildReorderDirective(
      SCHEMA,
      ['a', 'b'],
      'investor',
      0.9,
      archetypeEmb,
      listingEmbs,
    );

    const byId = Object.fromEntries(result!.scores.map((s) => [s.listing_id, s.score]));
    expect(byId.a).toBeCloseTo(1.0, 10); // cosine
    expect(byId.b).toBeCloseTo(djb2('investor', 'b'), 10); // djb2
  });

  it('AC-4: falls back to djb2 on dimension mismatch (no throw)', () => {
    const archetypeEmb = [1, 0, 0];
    const listingEmbs = new Map<string, number[] | null>([['a', [1, 0]]]);

    const result = buildReorderDirective(SCHEMA, ['a'], 'investor', 0.9, archetypeEmb, listingEmbs);

    expect(result!.scores[0]!.score).toBeCloseTo(djb2('investor', 'a'), 10);
  });

  it('djb2 fallback is deterministic across calls', () => {
    const r1 = buildReorderDirective(SCHEMA, ['x', 'y'], 'family', 0.8);
    const r2 = buildReorderDirective(SCHEMA, ['x', 'y'], 'family', 0.8);
    expect(r1!.scores).toEqual(r2!.scores);
  });

  it('AC-5: graceful degradation — empty embedding map → all djb2 scores, no throw', () => {
    const result = buildReorderDirective(SCHEMA, ['a', 'b', 'c'], 'neutral', 0.7, null, new Map());

    expect(result).not.toBeNull();
    expect(result!.scores).toHaveLength(3);
    // All scores match djb2 (since both embeddings effectively null).
    for (const { listing_id, score } of result!.scores) {
      expect(score).toBeCloseTo(djb2('neutral', listing_id), 10);
    }
  });

  it('cosine values can exceed djb2 0–1 range — sort still correct', () => {
    const archetypeEmb = [0.5, 0.5, 0.5];
    const listingEmbs = new Map<string, number[] | null>([
      // identical (cosine = 1.0)
      ['high', [0.5, 0.5, 0.5]],
      // orthogonal (cosine = 0.0)
      ['mid', [0.5, -0.5, 0]],
    ]);

    const result = buildReorderDirective(
      SCHEMA,
      ['high', 'mid'],
      'investor',
      0.9,
      archetypeEmb,
      listingEmbs,
    );

    expect(result!.scores[0]!.listing_id).toBe('high');
    expect(result!.scores[0]!.score).toBeGreaterThan(result!.scores[1]!.score);
  });

  it('signature is backwards compatible — old 4-arg calls still work', () => {
    // No embedding args → djb2 for everything.
    const result = buildReorderDirective(SCHEMA, ['a', 'b'], 'investor', 0.9);
    expect(result).not.toBeNull();
    expect(result!.scores).toHaveLength(2);
    for (const { listing_id, score } of result!.scores) {
      expect(score).toBeCloseTo(djb2('investor', listing_id), 10);
    }
    // Suppress unused-var warning in this test file.
    void cosine;
  });
});
