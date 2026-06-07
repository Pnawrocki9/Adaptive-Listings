/**
 * Unit tests for description-cache.ts — TICKET-DESC-001 / FOLLOW-203.
 *
 * Coverage:
 *   - descriptionKey() builds the correct key format
 *   - getCachedDescription() returns null on cache miss
 *   - getCachedDescription() returns parsed DescriptionCacheValue on cache hit
 *   - getCachedDescription() returns null on malformed JSON
 *   - getCachedDescription() returns null when UPSTASH_REDIS_URL is unset
 *   - setCachedDescription() calls the pipeline endpoint with SET and NO EX argument
 *   - invalidateDescriptionCache() SCANs and DELs matched keys
 *   - invalidateDescriptionCache() is a no-op when SCAN returns 0 keys
 *   - invalidateDescriptionCache() is a no-op when UPSTASH_REDIS_URL is unset
 *
 * FOLLOW-203: TTL_TIER2_SECONDS / TTL_TIER3_SECONDS removed. setCachedDescription
 * no longer accepts a TTL parameter; Redis SET is issued without EX.
 *
 * @module apps/control-plane/src/lib/__tests__/description-cache.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  descriptionKey,
  getCachedDescription,
  setCachedDescription,
  invalidateDescriptionCache,
} from '../description-cache.js';

// ─── descriptionKey() ─────────────────────────────────────────────────────────

describe('descriptionKey()', () => {
  it('builds the correct key format', () => {
    const key = descriptionKey(
      '550e8400-e29b-41d4-a716-446655440000',
      'prop-123',
      'yield_hunter',
      'en',
    );
    expect(key).toBe('desc:550e8400-e29b-41d4-a716-446655440000:prop-123:yield_hunter:en');
  });

  it('handles locale variants', () => {
    const key = descriptionKey('tenant-id', 'listing-id', 'family_buyer', 'pl');
    expect(key).toBe('desc:tenant-id:listing-id:family_buyer:pl');
  });
});

// ─── getCachedDescription() ───────────────────────────────────────────────────

describe('getCachedDescription()', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.test.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns null when UPSTASH_REDIS_URL is not set', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');
    const result = await getCachedDescription('desc:tenant:listing:arch:en');
    expect(result).toBeNull();
  });

  it('returns null on cache miss (Redis returns null result)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: null }), { status: 200 })),
    );
    const result = await getCachedDescription('desc:tenant:listing:arch:en');
    expect(result).toBeNull();
  });

  it('returns null when Redis returns non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    const result = await getCachedDescription('desc:tenant:listing:arch:en');
    expect(result).toBeNull();
  });

  it('returns parsed DescriptionCacheValue on valid cache hit', async () => {
    const cacheValue = {
      text: 'This income-producing property is built for investors who measure success in yield.',
      generated_at: '2026-05-14T12:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ result: JSON.stringify(cacheValue) }), { status: 200 }),
        ),
    );

    const result = await getCachedDescription('desc:tenant:listing:arch:en');

    expect(result).not.toBeNull();
    expect(result?.text).toBe(cacheValue.text);
    expect(result?.generated_at).toBe(cacheValue.generated_at);
  });

  it('returns null on malformed JSON in cache value', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ result: 'not-valid-json{' }), { status: 200 }),
        ),
    );
    const result = await getCachedDescription('desc:tenant:listing:arch:en');
    expect(result).toBeNull();
  });

  it('returns null on cache value with missing required fields', async () => {
    const invalidValue = { text: 'some text' }; // missing generated_at
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ result: JSON.stringify(invalidValue) }), { status: 200 }),
        ),
    );
    const result = await getCachedDescription('desc:tenant:listing:arch:en');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const result = await getCachedDescription('desc:tenant:listing:arch:en');
    expect(result).toBeNull();
  });
});

// ─── setCachedDescription() ───────────────────────────────────────────────────

describe('setCachedDescription()', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.test.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('calls the pipeline endpoint with SET command and NO EX argument (FOLLOW-203 AC3)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const value = {
      text: 'AI-generated description text.',
      generated_at: '2026-05-14T12:00:00.000Z',
    };
    await setCachedDescription('desc:tenant:listing:arch:en', value);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/pipeline');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string) as unknown[][];
    expect(body).toHaveLength(1);
    expect(body[0]?.[0]).toBe('SET');
    expect(body[0]?.[1]).toBe('desc:tenant:listing:arch:en');
    // Value should be JSON-stringified DescriptionCacheValue
    const storedValue = JSON.parse(body[0]?.[2] as string) as Record<string, unknown>;
    expect(storedValue.text).toBe(value.text);
    expect(storedValue.generated_at).toBe(value.generated_at);
    // AC3: no EX argument — key persists until eviction
    expect(body[0]).toHaveLength(3);
    expect(body[0]).not.toContain('EX');
  });

  it('is a no-op when UPSTASH_REDIS_URL is not set', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await setCachedDescription('desc:tenant:listing:arch:en', {
      text: 'text',
      generated_at: '2026-05-14T12:00:00.000Z',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── invalidateDescriptionCache() ────────────────────────────────────────────

describe('invalidateDescriptionCache()', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.test.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('is a no-op when UPSTASH_REDIS_URL is not set', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await invalidateDescriptionCache('tenant-id', 'listing-id');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls DEL with all matched keys when SCAN returns 3 keys', async () => {
    const scannedKeys = [
      'desc:tenant-id:listing-id:yield_hunter:en',
      'desc:tenant-id:listing-id:family_buyer:en',
      'desc:tenant-id:listing-id:yield_hunter:pl',
    ];

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/scan/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ result: ['0', scannedKeys] }), { status: 200 }),
        );
      }
      // DEL pipeline call
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    vi.stubGlobal('fetch', mockFetch);

    await invalidateDescriptionCache('tenant-id', 'listing-id');

    // Should have called fetch at least twice: once for SCAN, once for DEL
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Find the DEL call (POST to /pipeline)
    const delCall = mockFetch.mock.calls.find((call: unknown[]) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === 'POST';
    }) as unknown[] | undefined;
    expect(delCall).toBeDefined();

    const delInit = delCall?.[1] as RequestInit | undefined;
    const delBody = JSON.parse(delInit?.body as string) as unknown[][];
    expect(delBody).toHaveLength(1);
    expect(delBody[0]?.[0]).toBe('DEL');
    expect(delBody[0]).toContain(scannedKeys[0]);
    expect(delBody[0]).toContain(scannedKeys[1]);
    expect(delBody[0]).toContain(scannedKeys[2]);
  });

  it('does not call DEL when SCAN returns 0 keys', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/scan/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ result: ['0', []] }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    vi.stubGlobal('fetch', mockFetch);

    await invalidateDescriptionCache('tenant-id', 'empty-listing');

    const postCalls = mockFetch.mock.calls.filter((call: unknown[]) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === 'POST';
    });
    expect(postCalls).toHaveLength(0);
  });

  it('is idempotent — calling twice with same args does not error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ result: ['0', []] }), { status: 200 })),
    );

    await invalidateDescriptionCache('tenant-id', 'listing-id');
    await invalidateDescriptionCache('tenant-id', 'listing-id');
  });
});
