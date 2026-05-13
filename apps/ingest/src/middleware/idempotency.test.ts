/**
 * Unit tests for the idempotency middleware.
 *
 * Covers:
 * - Cache miss → request processed normally
 * - Cache hit → cached response returned with Idempotency-Replay: true
 * - Malformed key (too short, too long, non-ASCII) → 400 validation_failed
 * - No Idempotency-Key header → middleware is a no-op
 * - Concurrent requests with the same key (best-effort last-writer-wins)
 * - Non-2xx responses are NOT cached (errors are retriable)
 * - Tenant scoping: same Idempotency-Key + different API keys → different KV entries
 * - Tenant scoping: same Idempotency-Key + same API key → deduplicated (cache hit)
 * - No API key header → 'anon' prefix used (no collision with keyed tenants)
 */

import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { KVNamespace } from '@cloudflare/workers-types';

import {
  idempotency,
  isValidIdempotencyKey,
  IDEMPOTENCY_KEY_MIN_LEN,
  IDEMPOTENCY_KEY_MAX_LEN,
} from './idempotency.js';
import type { IdempotencyBindings } from './idempotency.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mirrors the private `shortHash` function in idempotency.ts so tests can
 * compute the expected KV key without exposing it as a public export.
 */
async function shortHash(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Returns the expected KV key for a given API key and idempotency key. */
async function expectedKvKey(apiKey: string, idempKey: string): Promise<string> {
  const prefix = apiKey ? await shortHash(apiKey) : 'anon';
  return `idem:${prefix}:${idempKey}`;
}

interface KvStore {
  data: Map<string, string>;
}

/** Build an in-memory KV mock. */
function buildKv(store: KvStore): KVNamespace {
  return {
    get: (key: string, type?: string): Promise<unknown> => {
      const raw = store.data.get(key) ?? null;
      if (raw === null) return Promise.resolve(null);
      if (type === 'json') return Promise.resolve(JSON.parse(raw) as unknown);
      return Promise.resolve(raw);
    },
    put: (key: string, value: string): Promise<void> => {
      store.data.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string): Promise<void> => {
      store.data.delete(key);
      return Promise.resolve();
    },
    list: () => Promise.resolve({ keys: [], list_complete: true } as never),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null } as never),
  } as unknown as KVNamespace;
}

interface TestEnv {
  Bindings: IdempotencyBindings;
}

function buildApp(_store: KvStore, handlerStatus = 200): Hono<TestEnv> {
  const app = new Hono<TestEnv>();
  app.use('/test', idempotency);
  app.post('/test', (c) =>
    c.json({ result: 'processed', ts: Date.now() }, handlerStatus as Parameters<typeof c.json>[1]),
  );
  return app;
}

/** Default API key used by tests that don't exercise tenant-scoping. */
const TEST_API_KEY = 'pk_live_testkey0000000000000000000000';

function makeEnv(store: KvStore): IdempotencyBindings {
  return { KV_IDEMPOTENCY: buildKv(store) };
}

const VALID_KEY = 'a'.repeat(IDEMPOTENCY_KEY_MIN_LEN); // 32 chars

// ---------------------------------------------------------------------------
// isValidIdempotencyKey unit tests
// ---------------------------------------------------------------------------

describe('isValidIdempotencyKey', () => {
  it('accepts a key of exactly min length', () => {
    expect(isValidIdempotencyKey('x'.repeat(IDEMPOTENCY_KEY_MIN_LEN))).toBe(true);
  });

  it('accepts a key of exactly max length', () => {
    expect(isValidIdempotencyKey('x'.repeat(IDEMPOTENCY_KEY_MAX_LEN))).toBe(true);
  });

  it('accepts a UUID-style key (36 chars)', () => {
    expect(isValidIdempotencyKey('01928f00-7000-7000-8000-123456789abc')).toBe(true);
  });

  it('rejects a key that is too short', () => {
    expect(isValidIdempotencyKey('x'.repeat(IDEMPOTENCY_KEY_MIN_LEN - 1))).toBe(false);
  });

  it('rejects a key that is too long', () => {
    expect(isValidIdempotencyKey('x'.repeat(IDEMPOTENCY_KEY_MAX_LEN + 1))).toBe(false);
  });

  it('rejects a key with a non-ASCII character', () => {
    // U+00E9 é — multi-byte, outside printable ASCII range
    expect(isValidIdempotencyKey('é'.repeat(IDEMPOTENCY_KEY_MIN_LEN))).toBe(false);
  });

  it('rejects a key containing a null byte', () => {
    expect(isValidIdempotencyKey('\x00'.repeat(IDEMPOTENCY_KEY_MIN_LEN))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Middleware behaviour
// ---------------------------------------------------------------------------

describe('idempotency middleware — cache miss', () => {
  it('processes the request and returns normal response on cache miss', async () => {
    const store: KvStore = { data: new Map() };
    const app = buildApp(store);
    const res = await app.fetch(
      new Request('http://test/test', { method: 'POST' }),
      makeEnv(store),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Idempotency-Replay')).toBeNull();
  });

  it('caches the response on cache miss (2xx)', async () => {
    const store: KvStore = { data: new Map() };
    const app = buildApp(store);
    await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': VALID_KEY, 'X-Estalara-API-Key': TEST_API_KEY },
      }),
      makeEnv(store),
    );
    // KV should now have a tenant-scoped entry for this key
    const expected = await expectedKvKey(TEST_API_KEY, VALID_KEY);
    expect(store.data.has(expected)).toBe(true);
  });
});

describe('idempotency middleware — cache hit', () => {
  it('returns cached response with Idempotency-Replay: true on second request', async () => {
    const store: KvStore = { data: new Map() };
    const app = buildApp(store);
    const env = makeEnv(store);

    // First request — populates cache
    const first = await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': VALID_KEY, 'X-Estalara-API-Key': TEST_API_KEY },
      }),
      env,
    );
    expect(first.status).toBe(200);
    expect(first.headers.get('Idempotency-Replay')).toBeNull();

    const firstBody = await first.json();

    // Second request — same key + same API key → should hit cache
    const second = await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': VALID_KEY, 'X-Estalara-API-Key': TEST_API_KEY },
      }),
      env,
    );
    expect(second.status).toBe(200);
    expect(second.headers.get('Idempotency-Replay')).toBe('true');
    const secondBody = await second.json();
    // Bodies must match (same cached response)
    expect(secondBody).toEqual(firstBody);
  });
});

describe('idempotency middleware — malformed key', () => {
  it('rejects a key that is too short with 400', async () => {
    const store: KvStore = { data: new Map() };
    const app = buildApp(store);
    const res = await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'short' },
      }),
      makeEnv(store),
    );
    expect(res.status).toBe(400);

    const body: { error: { code: string } } = await res.json();
    expect(body.error.code).toBe('validation_failed');
  });

  it('rejects a key that is too long with 400', async () => {
    const store: KvStore = { data: new Map() };
    const app = buildApp(store);
    const res = await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'x'.repeat(IDEMPOTENCY_KEY_MAX_LEN + 1) },
      }),
      makeEnv(store),
    );
    expect(res.status).toBe(400);

    const body: { error: { code: string } } = await res.json();
    expect(body.error.code).toBe('validation_failed');
  });

  it('rejects a key with non-printable ASCII with 400', async () => {
    const store: KvStore = { data: new Map() };
    const app = buildApp(store);
    // \x01 is not printable ASCII (< 0x20)
    const badKey = '\x01'.repeat(IDEMPOTENCY_KEY_MIN_LEN);
    const res = await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': badKey },
      }),
      makeEnv(store),
    );
    expect(res.status).toBe(400);
  });
});

describe('idempotency middleware — no header', () => {
  it('passes through without caching when Idempotency-Key is absent', async () => {
    const store: KvStore = { data: new Map() };
    const putSpy = vi.spyOn(store.data, 'set');
    const app = buildApp(store);
    const res = await app.fetch(
      new Request('http://test/test', { method: 'POST' }),
      makeEnv(store),
    );
    expect(res.status).toBe(200);
    // No KV writes should occur
    expect(putSpy).not.toHaveBeenCalled();
  });
});

describe('idempotency middleware — non-2xx responses not cached', () => {
  it('does not cache 400 error responses', async () => {
    const store: KvStore = { data: new Map() };
    // Handler returns 400
    const app = buildApp(store, 400);
    const env = makeEnv(store);

    await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': VALID_KEY, 'X-Estalara-API-Key': TEST_API_KEY },
      }),
      env,
    );
    // Error response must NOT be cached — KV store should remain empty
    expect(store.data.size).toBe(0);
  });
});

describe('idempotency middleware — concurrent requests (best-effort)', () => {
  it('both concurrent requests succeed; at least one caches its response', async () => {
    const store: KvStore = { data: new Map() };
    const app = buildApp(store);
    const env = makeEnv(store);

    // Fire two concurrent requests with the same key and same API key
    const [res1, res2] = await Promise.all([
      app.fetch(
        new Request('http://test/test', {
          method: 'POST',
          headers: { 'Idempotency-Key': VALID_KEY, 'X-Estalara-API-Key': TEST_API_KEY },
        }),
        env,
      ),
      app.fetch(
        new Request('http://test/test', {
          method: 'POST',
          headers: { 'Idempotency-Key': VALID_KEY, 'X-Estalara-API-Key': TEST_API_KEY },
        }),
        env,
      ),
    ]);

    // Both responses must be 2xx (no crash, no undefined)
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Cache should contain a tenant-scoped entry after at least one request completed
    const expected = await expectedKvKey(TEST_API_KEY, VALID_KEY);
    expect(store.data.has(expected)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tenant scoping
// ---------------------------------------------------------------------------

describe('idempotency middleware — tenant scoping', () => {
  it('different API keys with the same Idempotency-Key produce different KV entries', async () => {
    const store: KvStore = { data: new Map() };
    const app = buildApp(store);
    const env = makeEnv(store);

    const apiKeyA = 'pk_live_tenantA0000000000000000000000';
    const apiKeyB = 'pk_live_tenantB0000000000000000000000';

    // First tenant's request
    await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': VALID_KEY, 'X-Estalara-API-Key': apiKeyA },
      }),
      env,
    );

    // Second tenant's request — same Idempotency-Key, different API key
    await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': VALID_KEY, 'X-Estalara-API-Key': apiKeyB },
      }),
      env,
    );

    // Both tenants must have separate KV entries
    const keyA = await expectedKvKey(apiKeyA, VALID_KEY);
    const keyB = await expectedKvKey(apiKeyB, VALID_KEY);

    expect(keyA).not.toBe(keyB);
    expect(store.data.has(keyA)).toBe(true);
    expect(store.data.has(keyB)).toBe(true);
    // Each tenant's response is stored independently — no shared entry
    expect(store.data.size).toBe(2);
  });

  it('same API key + same Idempotency-Key returns deduplicated cache hit', async () => {
    const store: KvStore = { data: new Map() };
    const app = buildApp(store);
    const env = makeEnv(store);

    // First request — populates cache
    const first = await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': VALID_KEY, 'X-Estalara-API-Key': TEST_API_KEY },
      }),
      env,
    );
    const firstBody = await first.json();

    // Second request — same key + same API key → must be a cache hit
    const second = await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': VALID_KEY, 'X-Estalara-API-Key': TEST_API_KEY },
      }),
      env,
    );

    expect(second.headers.get('Idempotency-Replay')).toBe('true');
    const secondBody = await second.json();
    expect(secondBody).toEqual(firstBody);
    // Only one KV entry should exist
    expect(store.data.size).toBe(1);
  });

  it('request without API key uses anon prefix and does not collide with keyed tenant', async () => {
    const store: KvStore = { data: new Map() };
    const app = buildApp(store);
    const env = makeEnv(store);

    // Keyed tenant request
    await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': VALID_KEY, 'X-Estalara-API-Key': TEST_API_KEY },
      }),
      env,
    );

    // Anonymous request (no API key header) — same Idempotency-Key
    const anonRes = await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': VALID_KEY },
      }),
      env,
    );

    // Anonymous request must NOT receive the keyed tenant's cached response
    expect(anonRes.headers.get('Idempotency-Replay')).toBeNull();

    // Two separate KV entries must exist — one for the keyed tenant, one for anon
    const keyedEntry = await expectedKvKey(TEST_API_KEY, VALID_KEY);
    const anonEntry = await expectedKvKey('', VALID_KEY);

    expect(store.data.has(keyedEntry)).toBe(true);
    expect(store.data.has(anonEntry)).toBe(true);
    expect(store.data.size).toBe(2);
  });
});
