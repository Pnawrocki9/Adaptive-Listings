/**
 * Unit tests for the `RateLimiter` Durable Object. We instantiate the class with a mock
 * `DurableObjectState` whose storage is a plain `Map` — DO storage is just key → JSON in
 * production, so this is a faithful behavior model for the read-modify-write loop.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { RateLimiter } from './rate-limiter.js';
import type { RateLimiterEnv } from './rate-limiter.js';

interface StoredMap {
  store: Map<string, unknown>;
  state: unknown;
}

function makeMockState(): StoredMap {
  const store = new Map<string, unknown>();
  const state = {
    storage: {
      get: <T>(key: string): Promise<T | undefined> => Promise.resolve(store.get(key) as T),
      put: (key: string, value: unknown): Promise<void> => {
        store.set(key, value);
        return Promise.resolve();
      },
      delete: (key: string): Promise<boolean> => Promise.resolve(store.delete(key)),
    },
  };
  return { store, state };
}

function makeLimiter(env: RateLimiterEnv = {}): {
  limiter: RateLimiter;
  store: Map<string, unknown>;
} {
  const { state, store } = makeMockState();
  // The constructor signature requires `DurableObjectState`; we widen via `unknown` cast since
  // our mock implements only what the class actually uses (`storage.get` / `storage.put`).
  const limiter = new RateLimiter(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- mock only implements the subset of DurableObjectState used by the class
    state as unknown as ConstructorParameters<typeof RateLimiter>[0],
    env,
  );
  return { limiter, store };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RateLimiter.incrementAndCheck', () => {
  it('allows a single request well under the limit', async () => {
    const { limiter } = makeLimiter({ RATE_LIMIT_PER_MIN: '1000' });
    const result = await limiter.incrementAndCheck(10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(990);
    expect(result.limit).toBe(1000);
  });

  it('allows a request that hits the limit exactly', async () => {
    const { limiter } = makeLimiter({ RATE_LIMIT_PER_MIN: '100' });
    const result = await limiter.incrementAndCheck(100);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('rejects a request that would exceed the limit', async () => {
    const { limiter } = makeLimiter({ RATE_LIMIT_PER_MIN: '100' });
    const first = await limiter.incrementAndCheck(80);
    expect(first.allowed).toBe(true);
    const second = await limiter.incrementAndCheck(30); // 80 + 30 > 100
    expect(second.allowed).toBe(false);
    expect(second.remaining).toBe(20);
    expect(second.reset_at).toBeGreaterThan(Date.now());
  });

  it('rejects a partial-batch overflow as a whole (no partial accept)', async () => {
    const { limiter } = makeLimiter({ RATE_LIMIT_PER_MIN: '1000' });
    await limiter.incrementAndCheck(800);
    // 1500-event batch with 200 tokens remaining → reject ALL 1500 (not 200 of them).
    const result = await limiter.incrementAndCheck(1500);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(200);
    // Subsequent small request still works (the rejected 1500-batch was not persisted).
    const small = await limiter.incrementAndCheck(150);
    expect(small.allowed).toBe(true);
    expect(small.remaining).toBe(50);
  });

  it('frees capacity after the 60-second window slides past', async () => {
    const { limiter } = makeLimiter({ RATE_LIMIT_PER_MIN: '100' });
    await limiter.incrementAndCheck(100);
    const blocked = await limiter.incrementAndCheck(1);
    expect(blocked.allowed).toBe(false);

    // Advance 61 seconds — the original 100-event entry is now outside the window.
    vi.advanceTimersByTime(61_000);

    const after = await limiter.incrementAndCheck(50);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(50);
  });

  it('counts entries that overlap the window edge correctly', async () => {
    const { limiter } = makeLimiter({ RATE_LIMIT_PER_MIN: '100' });
    await limiter.incrementAndCheck(40); // t = 0
    vi.advanceTimersByTime(30_000);
    await limiter.incrementAndCheck(40); // t = 30s, total = 80
    vi.advanceTimersByTime(20_000); // t = 50s — both entries still in window
    const blocked = await limiter.incrementAndCheck(30); // would be 110 > 100
    expect(blocked.allowed).toBe(false);
    vi.advanceTimersByTime(15_000); // t = 65s — first entry (t=0) drops out, used = 40
    const after = await limiter.incrementAndCheck(30);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(30);
  });

  it('uses the default limit when RATE_LIMIT_PER_MIN is unset', async () => {
    const { limiter } = makeLimiter();
    const result = await limiter.incrementAndCheck(1);
    expect(result.limit).toBe(50_000);
    expect(result.remaining).toBe(49_999);
  });

  it('falls back to default limit when RATE_LIMIT_PER_MIN is malformed', async () => {
    const { limiter } = makeLimiter({ RATE_LIMIT_PER_MIN: 'not-a-number' });
    const result = await limiter.incrementAndCheck(0);
    expect(result.limit).toBe(50_000);
  });

  it('reset_at points to the oldest in-window entry + 60s when blocked', async () => {
    const { limiter } = makeLimiter({ RATE_LIMIT_PER_MIN: '100' });
    const t0 = Date.now();
    await limiter.incrementAndCheck(80);
    vi.advanceTimersByTime(10_000);
    const blocked = await limiter.incrementAndCheck(50);
    expect(blocked.allowed).toBe(false);
    // Oldest entry was at t0; reset_at = t0 + 60_000.
    expect(blocked.reset_at).toBe(t0 + 60_000);
  });
});

describe('RateLimiter.fetch', () => {
  it('routes POST /check to incrementAndCheck and returns JSON', async () => {
    const { limiter } = makeLimiter({ RATE_LIMIT_PER_MIN: '500' });
    const res = await limiter.fetch(
      new Request('https://internal/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 100 }),
      }),
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- assert known shape
    const body = (await res.json()) as { allowed: boolean; remaining: number; limit: number };
    expect(body.allowed).toBe(true);
    expect(body.remaining).toBe(400);
    expect(body.limit).toBe(500);
  });

  it('returns 404 for non-/check paths', async () => {
    const { limiter } = makeLimiter();
    const res = await limiter.fetch(new Request('https://internal/nope', { method: 'POST' }));
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-POST methods', async () => {
    const { limiter } = makeLimiter();
    const res = await limiter.fetch(new Request('https://internal/check'));
    expect(res.status).toBe(404);
  });

  it('returns 400 on invalid JSON body', async () => {
    const { limiter } = makeLimiter();
    const res = await limiter.fetch(
      new Request('https://internal/check', {
        method: 'POST',
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on missing or non-numeric count', async () => {
    const { limiter } = makeLimiter();
    const res = await limiter.fetch(
      new Request('https://internal/check', {
        method: 'POST',
        body: JSON.stringify({ count: 'lots' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on negative count', async () => {
    const { limiter } = makeLimiter();
    const res = await limiter.fetch(
      new Request('https://internal/check', {
        method: 'POST',
        body: JSON.stringify({ count: -5 }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
