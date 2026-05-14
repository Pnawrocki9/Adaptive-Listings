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
