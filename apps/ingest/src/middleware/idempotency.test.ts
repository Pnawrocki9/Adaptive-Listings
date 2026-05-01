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
        headers: { 'Idempotency-Key': VALID_KEY },
      }),
      makeEnv(store),
    );
    // KV should now have an entry for this key
    expect(store.data.has(`idem:${VALID_KEY}`)).toBe(true);
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
        headers: { 'Idempotency-Key': VALID_KEY },
      }),
      env,
    );
    expect(first.status).toBe(200);
    expect(first.headers.get('Idempotency-Replay')).toBeNull();

    const firstBody = await first.json();

    // Second request — should hit cache
    const second = await app.fetch(
      new Request('http://test/test', {
        method: 'POST',
        headers: { 'Idempotency-Key': VALID_KEY },
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
    const body = await res.json();
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
    const body = await res.json();
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
        headers: { 'Idempotency-Key': VALID_KEY },
      }),
      env,
    );
    // Error response must NOT be cached
    expect(store.data.has(`idem:${VALID_KEY}`)).toBe(false);
  });
});

describe('idempotency middleware — concurrent requests (best-effort)', () => {
  it('both concurrent requests succeed; at least one caches its response', async () => {
    const store: KvStore = { data: new Map() };
    const app = buildApp(store);
    const env = makeEnv(store);

    // Fire two concurrent requests with the same key
    const [res1, res2] = await Promise.all([
      app.fetch(
        new Request('http://test/test', {
          method: 'POST',
          headers: { 'Idempotency-Key': VALID_KEY },
        }),
        env,
      ),
      app.fetch(
        new Request('http://test/test', {
          method: 'POST',
          headers: { 'Idempotency-Key': VALID_KEY },
        }),
        env,
      ),
    ]);

    // Both responses must be 2xx (no crash, no undefined)
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Cache should contain an entry after at least one request completed
    expect(store.data.has(`idem:${VALID_KEY}`)).toBe(true);
  });
});
