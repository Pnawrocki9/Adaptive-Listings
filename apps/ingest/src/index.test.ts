/**
 * Integration tests for the ingest Worker. We exercise the Hono app by calling `app.fetch`
 * directly; the bindings are mocked so tests stay in plain Node (no `wrangler dev`, no
 * `@cloudflare/vitest-pool-workers`).
 */

import { describe, expect, it, vi } from 'vitest';

// FOLLOW-459: mocked so the post-ACK ClickHouse-failure test can assert
// `Sentry.captureException` was called, without needing a real Sentry init
// (matches the pattern in handlers/__tests__/intent-snapshot.test.ts).
vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn() }));

import * as Sentry from '@sentry/cloudflare';

import { createApp } from './router.js';
import type { Env } from './types.js';

interface MockKvOptions {
  /** Map of `api_key:<token>` → JSON string (or `null` if not present). */
  store?: Record<string, string | null>;
  /** When `true`, every `get()` rejects (simulates KV outage). */
  fail?: boolean;
}

function mockKv(options: MockKvOptions = {}): Env['KV_API_KEYS'] {
  const store = options.store ?? {};
  return {
    get(key: string): Promise<string | null> {
      if (options.fail) return Promise.reject(new Error('kv_failure_test'));
      return Promise.resolve(store[key] ?? null);
    },
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ keys: [], list_complete: true } as never),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null } as never),
  } as unknown as Env['KV_API_KEYS'];
}

interface MakeEnvOptions {
  kvStore?: Record<string, string | null>;
  kvFail?: boolean;
  /** `'allow'` (default) — every check passes. `'deny'` — every check fails (429).
   *  `{ allowFirstNEvents: N }` — accept until cumulative event count crosses N. */
  rateLimit?: 'allow' | 'deny' | { allowFirstNEvents: number };
  /** Override the ENVIRONMENT binding (default: 'test'). Pass 'production' to exercise
   *  the production CORS allow-list (no localhost origins). */
  environment?: string;
  /** Override CLICKHOUSE_URL (default: '' — no-cred guard, CH producer skipped).
   *  FOLLOW-459: set to a mock URL to exercise the post-ACK ClickHouse write path. */
  clickhouseUrl?: string;
  /** Provide a mock EVENTS_RETRY_QUEUE binding (FOLLOW-482). Absent by default — matches an
   *  environment that hasn't provisioned the queue (the "not configured" guard in events.ts). */
  eventsRetryQueue?: Env['EVENTS_RETRY_QUEUE'];
}

interface RateCheckResponse {
  allowed: boolean;
  remaining: number;
  reset_at: number;
  limit: number;
}

function mockRateLimiter(
  mode: 'allow' | 'deny' | { allowFirstNEvents: number },
): Env['RATE_LIMITER'] {
  let used = 0;
  const cap = typeof mode === 'object' ? mode.allowFirstNEvents : 0;
  const stub = {
    fetch: (_url: string, init?: { body?: BodyInit }): Promise<Response> => {
      const raw = typeof init?.body === 'string' ? init.body : '{}';
      const parsed = JSON.parse(raw) as { count: number };
      const count = parsed.count;
      const now = Date.now();
      let body: RateCheckResponse;
      if (mode === 'allow') {
        body = { allowed: true, remaining: 49_999, reset_at: now + 60_000, limit: 50_000 };
      } else if (mode === 'deny') {
        body = { allowed: false, remaining: 0, reset_at: now + 30_000, limit: 50_000 };
      } else if (used + count > cap) {
        body = { allowed: false, remaining: cap - used, reset_at: now + 60_000, limit: cap };
      } else {
        used += count;
        body = { allowed: true, remaining: cap - used, reset_at: now + 60_000, limit: cap };
      }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    },
  };
  return {
    idFromName: (_name: string) => ({ toString: () => 'mock-id' }),
    get: (_id: unknown) => stub,
  } as unknown as Env['RATE_LIMITER'];
}

function makeEnv(options: MakeEnvOptions = {}): Env {
  return {
    ENVIRONMENT: options.environment ?? 'test',
    REDPANDA_REST_URL: 'http://mock-redpanda',
    REDPANDA_TOPIC_EVENTS: 'events',
    // CLICKHOUSE_URL empty → no-cred guard fires; existing handler tests stay
    // pinned to the Redpanda path. CH-specific paths are exercised in
    // clickhouse-producer.test.ts. FOLLOW-459's ACK-latency test overrides this
    // via `clickhouseUrl` to exercise the post-ACK write path.
    CLICKHOUSE_URL: options.clickhouseUrl ?? '',
    CLICKHOUSE_DATABASE: 'default',
    KV_API_KEYS: mockKv({
      store: options.kvStore ?? {},
      fail: options.kvFail ?? false,
    }),
    KV_IDEMPOTENCY: mockKv(),
    RATE_LIMITER: mockRateLimiter(options.rateLimit ?? 'allow'),
    ...(options.eventsRetryQueue !== undefined
      ? { EVENTS_RETRY_QUEUE: options.eventsRetryQueue }
      : {}),
  };
}

/** Mock `EVENTS_RETRY_QUEUE` binding (FOLLOW-482) — records every `.send()` call. */
function mockEventsRetryQueue(): {
  queue: Env['EVENTS_RETRY_QUEUE'];
  sent: () => unknown[];
} {
  const messages: unknown[] = [];
  const queue = {
    send: (message: unknown) => {
      messages.push(message);
      return Promise.resolve();
    },
    sendBatch: () => Promise.resolve(),
    metrics: () => Promise.resolve({ backlogCount: 0, backlogBytes: 0 }),
  } as unknown as Env['EVENTS_RETRY_QUEUE'];
  return { queue, sent: () => messages };
}

/** A `.send()` that always rejects — simulates the retry queue itself being unavailable. */
function failingEventsRetryQueue(): Env['EVENTS_RETRY_QUEUE'] {
  return {
    send: () => Promise.reject(new Error('queue_send_failed_test')),
    sendBatch: () => Promise.reject(new Error('queue_send_failed_test')),
    metrics: () => Promise.resolve({ backlogCount: 0, backlogBytes: 0 }),
  };
}

/**
 * Parse a Response body as a known JSON shape. Single-source-of-truth for the `as T` cast that
 * tests need.
 */
async function readJson<T>(res: Response): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- assert caller's expected shape
  return (await res.json()) as T;
}

/**
 * Stub global `fetch` for the duration of a single test. Returns the original after the test.
 */
function stubFetch(behavior: 'ok' | 'error_5xx' | 'error_4xx' | 'network_failure'): {
  restore: () => void;
  callCount: () => number;
} {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (..._args: Parameters<typeof fetch>): Promise<Response> => {
    calls++;
    if (behavior === 'network_failure') return Promise.reject(new Error('network_failure_test'));
    if (behavior === 'error_5xx') return Promise.resolve(new Response('boom', { status: 503 }));
    if (behavior === 'error_4xx') return Promise.resolve(new Response('bad', { status: 400 }));
    return Promise.resolve(
      new Response(JSON.stringify({ offsets: [{ partition: 0, offset: 0 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.kafka.v2+json' },
      }),
    );
  };
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    callCount: () => calls,
  };
}

const validEvent = {
  event_id: '01928f00-7000-7000-8000-123456789abc',
  tenant_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
  session_id: 'a'.repeat(40),
  ts: 1714180000000,
  region: 'eu' as const,
  consent_state: 'legitimate-interest' as const,
  schema_version: 1 as const,
  type: 'page.view',
  payload: {
    url: 'https://example.com/listing/1',
    viewport: { width: 1440, height: 900 },
    device_class: 'desktop' as const,
  },
};

const VALID_KEY_RECORD = JSON.stringify({
  tenant_id: 'tenant-uuid-1',
  scopes: ['write:events'],
});

describe('GET /health', () => {
  it('returns 200 with service metadata', async () => {
    const app = createApp();
    const env = makeEnv();
    const res = await app.fetch(new Request('http://test/health'), env);
    expect(res.status).toBe(200);
    const body = await readJson<{ status: string; service: string; environment: string }>(res);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('estalara-ingest');
    expect(body.environment).toBe('test');
  });
});

describe('security headers', () => {
  it('includes required security headers on all responses', async () => {
    const app = createApp();
    const env = makeEnv();
    const res = await app.fetch(new Request('http://test/health'), env);
    expect(res.headers.get('strict-transport-security')).toContain('max-age=63072000');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).not.toBeNull();
  });
});

describe('POST /v1/events — auth', () => {
  it('rejects with 401 when API key is missing', async () => {
    const app = createApp();
    const env = makeEnv();
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [validEvent] }),
      }),
      env,
    );
    expect(res.status).toBe(401);
    const body = await readJson<{ error: { code: string; details?: { reason: string } } }>(res);
    expect(body.error.code).toBe('unauthorized');
    expect(body.error.details?.reason).toBe('missing_key');
  });

  it('rejects with 401 when API key is unknown', async () => {
    const app = createApp();
    const env = makeEnv({ kvStore: {} });
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Estalara-API-Key': 'never-issued',
        },
        body: JSON.stringify({ events: [validEvent] }),
      }),
      env,
    );
    expect(res.status).toBe(401);
    const body = await readJson<{ error: { code: string; details?: { reason: string } } }>(res);
    expect(body.error.code).toBe('unauthorized');
    expect(body.error.details?.reason).toBe('unknown_key');
  });

  it('returns 401 when KV lookup fails', async () => {
    const app = createApp();
    const env = makeEnv({ kvFail: true });
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Estalara-API-Key': 'any',
        },
        body: JSON.stringify({ events: [validEvent] }),
      }),
      env,
    );
    expect(res.status).toBe(401);
    const body = await readJson<{ error: { code: string; details?: { reason: string } } }>(res);
    expect(body.error.code).toBe('unauthorized');
    expect(body.error.details?.reason).toBe('kv_error');
  });
});

describe('POST /v1/events — body shape', () => {
  it('returns 400 when body is not JSON', async () => {
    const app = createApp();
    const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'POST',
        headers: { 'X-Estalara-API-Key': 'k1' },
        body: 'not-json',
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 400 when events field missing', async () => {
    const app = createApp();
    const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
        body: JSON.stringify({ no_events: 'here' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when events is empty', async () => {
    const app = createApp();
    const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
        body: JSON.stringify({ events: [] }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 413 when batch exceeds 1000 events', async () => {
    const app = createApp();
    const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
    const tooMany = Array.from({ length: 1001 }, () => validEvent);
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
        body: JSON.stringify({ events: tooMany }),
      }),
      env,
    );
    expect(res.status).toBe(413);
  });

  it('returns 413 when Content-Length is over 1MB', async () => {
    const app = createApp();
    const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Estalara-API-Key': 'k1',
          'Content-Length': '5000000',
        },
        body: JSON.stringify({ events: [validEvent] }),
      }),
      env,
    );
    expect(res.status).toBe(413);
  });
});

describe('POST /v1/events — happy path', () => {
  it('accepts a valid batch, enriches events, returns 200', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Estalara-API-Key': 'k1',
            'CF-IPCountry': 'GB',
          },
          body: JSON.stringify({ events: [validEvent, validEvent] }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      const body = await readJson<{ accepted: number; rejected: number; batch_id: string }>(res);
      expect(body.accepted).toBe(2);
      expect(body.rejected).toBe(0);
      expect(body.batch_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(stub.callCount()).toBe(1);
    } finally {
      stub.restore();
    }
  });

  it('reports rejected events individually with index + errors', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
      const malformed = { ...validEvent, type: 'totally-unknown-type' };
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: JSON.stringify({ events: [validEvent, malformed, validEvent] }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      const body = await readJson<{
        accepted: number;
        rejected: number;
        errors: { index: number }[];
      }>(res);
      expect(body.accepted).toBe(2);
      expect(body.rejected).toBe(1);
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0]?.index).toBe(1);
    } finally {
      stub.restore();
    }
  });

  it('skips Redpanda when every event is rejected', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: JSON.stringify({ events: [{ totally: 'wrong shape' }] }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      const body = await readJson<{ accepted: number; rejected: number }>(res);
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(1);
      expect(stub.callCount()).toBe(0);
    } finally {
      stub.restore();
    }
  });
});

describe('POST /v1/events — Redpanda failure', () => {
  it('returns 503 when Redpanda exhausts all retries', async () => {
    const stub = stubFetch('error_5xx');
    try {
      const app = createApp();
      const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
      );
      expect(res.status).toBe(503);
      const body = await readJson<{ error: { code: string; details?: { attempts: number } } }>(res);
      expect(body.error.code).toBe('redpanda_unavailable');
      expect(body.error.details?.attempts).toBe(3);
    } finally {
      stub.restore();
    }
  }, 20_000); // backoff 100+500+2500 ms = ~3.1s of real waits

  it('returns 503 with attempts=1 on terminal 4xx', async () => {
    const stub = stubFetch('error_4xx');
    try {
      const app = createApp();
      const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
      );
      expect(res.status).toBe(503);
      const body = await readJson<{ error: { details?: { attempts: number } } }>(res);
      expect(body.error.details?.attempts).toBe(1);
    } finally {
      stub.restore();
    }
  });
});

// ─── FOLLOW-459 — ACK returns before the ClickHouse insert settles ────────────
//
// Distinguishes Redpanda vs. ClickHouse by URL so ClickHouse can be made slow/failing
// independently of Redpanda (which stays instant, per the makeEnv default).
function stubFetchByHost(behavior: {
  clickhouse: 'ok' | 'slow_ok' | 'error_5xx';
  clickhouseDelayMs?: number;
}): {
  restore: () => void;
  clickhouseCallCount: () => number;
} {
  const original = globalThis.fetch;
  let chCalls = 0;
  globalThis.fetch = (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('mock-clickhouse')) {
      chCalls++;
      if (behavior.clickhouse === 'error_5xx') {
        return Promise.resolve(new Response('boom', { status: 503 }));
      }
      const respond = (): Response => new Response('', { status: 200 });
      if (behavior.clickhouse === 'slow_ok') {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(respond());
          }, behavior.clickhouseDelayMs ?? 300);
        });
      }
      return Promise.resolve(respond());
    }
    // Redpanda (or anything else) resolves instantly — same shape as `stubFetch('ok')`.
    return Promise.resolve(
      new Response(JSON.stringify({ offsets: [{ partition: 0, offset: 0 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.kafka.v2+json' },
      }),
    );
  };
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    clickhouseCallCount: () => chCalls,
  };
}

/** Minimal `ExecutionContext`-shaped mock that records `waitUntil()` promises for draining. */
function mockExecutionCtx(): {
  ctx: { waitUntil: (p: Promise<unknown>) => void; passThroughOnException: () => void };
  drain: () => Promise<void>;
} {
  const tasks: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => {
        tasks.push(p);
      },
      passThroughOnException: () => {
        // no-op — required by the ExecutionContext shape, unused by the handler.
      },
    },
    drain: () => Promise.all(tasks).then(() => undefined),
  };
}

describe('POST /v1/events — ClickHouse ACK latency (FOLLOW-459)', () => {
  it('returns the ACK well before a slow ClickHouse insert settles', async () => {
    const CH_DELAY_MS = 300;
    const stub = stubFetchByHost({ clickhouse: 'slow_ok', clickhouseDelayMs: CH_DELAY_MS });
    const { ctx, drain } = mockExecutionCtx();
    try {
      const app = createApp();
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        clickhouseUrl: 'https://mock-clickhouse:8443',
      });

      const start = performance.now();
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
        ctx as never,
      );
      const elapsedMs = performance.now() - start;

      expect(res.status).toBe(200);
      // The budget check: the ACK must not have waited for the artificially slow
      // ClickHouse insert (AC1/AC3 — the whole point of FOLLOW-459). A generous
      // half-of-the-artificial-delay margin keeps this robust on slow CI runners
      // while still failing hard if ClickHouse ever gets back onto the ACK path.
      expect(elapsedMs).toBeLessThan(CH_DELAY_MS / 2);

      // Let the fire-and-forget ClickHouse write actually finish before the test
      // exits, so it doesn't leak a dangling timer into the next test.
      await drain();
      expect(stub.clickhouseCallCount()).toBe(1);
    } finally {
      stub.restore();
    }
  });

  it('a terminal ClickHouse failure after the ACK is captured to Sentry, not surfaced to the client', async () => {
    const stub = stubFetchByHost({ clickhouse: 'error_5xx' });
    const { ctx, drain } = mockExecutionCtx();
    const captureSpy = vi.mocked(Sentry.captureException);
    captureSpy.mockClear();
    try {
      const app = createApp();
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        clickhouseUrl: 'https://mock-clickhouse:8443',
      });

      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
        ctx as never,
      );

      // The client still gets the ACK — Redpanda succeeded, and ClickHouse's
      // outcome is no longer on the critical path (RETRY-CONTRACT CHANGE, events.ts).
      expect(res.status).toBe(200);

      await drain();

      // Terminal ClickHouse failure (3 exhausted retries, each a 503) must be
      // observable — Rule K.2 — even though the client never sees it.
      expect(captureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('clickhouse_push_failed_post_ack'),
        }),
        expect.objectContaining({
          tags: expect.objectContaining({ area: 'events', sink: 'clickhouse' }),
        }),
      );
    } finally {
      stub.restore();
    }
  }, 20_000); // backoff 100+500+2500 ms = ~3.1s of real waits (same policy as Redpanda's)
});

// ─── FOLLOW-482 / ADR-0017 — durable retry queue on terminal ClickHouse failure ────
describe('POST /v1/events — durable retry queue on terminal ClickHouse failure (FOLLOW-482)', () => {
  it('enqueues the failed batch to EVENTS_RETRY_QUEUE in addition to the Sentry capture', async () => {
    const stub = stubFetchByHost({ clickhouse: 'error_5xx' });
    const { ctx, drain } = mockExecutionCtx();
    const { queue, sent } = mockEventsRetryQueue();
    try {
      const app = createApp();
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        clickhouseUrl: 'https://mock-clickhouse:8443',
        eventsRetryQueue: queue,
      });

      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
        ctx as never,
      );

      expect(res.status).toBe(200);
      await drain();

      expect(sent()).toHaveLength(1);
      const message = sent()[0] as {
        schema_version: number;
        tenant_id: string;
        records: unknown[];
      };
      expect(message.schema_version).toBe(1);
      expect(message.tenant_id).toBe('tenant-uuid-1');
      expect(message.records).toHaveLength(1);
    } finally {
      stub.restore();
    }
  }, 20_000);

  it('does NOT enqueue when ClickHouse succeeds', async () => {
    const stub = stubFetchByHost({ clickhouse: 'ok' });
    const { ctx, drain } = mockExecutionCtx();
    const { queue, sent } = mockEventsRetryQueue();
    try {
      const app = createApp();
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        clickhouseUrl: 'https://mock-clickhouse:8443',
        eventsRetryQueue: queue,
      });

      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
        ctx as never,
      );

      expect(res.status).toBe(200);
      await drain();
      expect(sent()).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });

  it('skips the enqueue with a warn log (not a throw) when EVENTS_RETRY_QUEUE is not configured', async () => {
    const stub = stubFetchByHost({ clickhouse: 'error_5xx' });
    const { ctx, drain } = mockExecutionCtx();
    try {
      const app = createApp();
      // No `eventsRetryQueue` override — matches an environment that hasn't provisioned
      // the queue binding yet.
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        clickhouseUrl: 'https://mock-clickhouse:8443',
      });

      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
        ctx as never,
      );

      expect(res.status).toBe(200);
      await drain();
      // No assertion beyond "did not throw" — the guard branch (events.ts) only logs.
    } finally {
      stub.restore();
    }
  }, 20_000);

  it('captures a distinct Sentry event when the retry-queue send itself fails', async () => {
    const stub = stubFetchByHost({ clickhouse: 'error_5xx' });
    const { ctx, drain } = mockExecutionCtx();
    const captureSpy = vi.mocked(Sentry.captureException);
    captureSpy.mockClear();
    try {
      const app = createApp();
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        clickhouseUrl: 'https://mock-clickhouse:8443',
        eventsRetryQueue: failingEventsRetryQueue(),
      });

      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
        ctx as never,
      );

      expect(res.status).toBe(200);
      await drain();

      expect(captureSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'queue_send_failed_test' }),
        expect.objectContaining({
          tags: expect.objectContaining({ kind: 'retry_enqueue_failed' }),
        }),
      );
    } finally {
      stub.restore();
    }
  }, 20_000);
});

describe('GET unmatched route', () => {
  it('returns 404 with structured body', async () => {
    const app = createApp();
    const env = makeEnv();
    const res = await app.fetch(new Request('http://test/nope'), env);
    expect(res.status).toBe(404);
    const body = await readJson<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('/nope');
  });
});

describe('POST /v1/events — rate limiting', () => {
  it('returns 429 with Retry-After when the rate limiter denies the batch', async () => {
    const app = createApp();
    const env = makeEnv({
      kvStore: { 'api_key:k1': VALID_KEY_RECORD },
      rateLimit: 'deny',
    });
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
        body: JSON.stringify({ events: [validEvent] }),
      }),
      env,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).not.toBeNull();
    const retryAfter = Number.parseInt(res.headers.get('Retry-After') ?? '0', 10);
    expect(retryAfter).toBeGreaterThan(0);
    const body = await readJson<{
      error: { code: string; details?: { limit: number; remaining: number; reset_at: number } };
    }>(res);
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.details?.limit).toBe(50_000);
    expect(body.error.details?.remaining).toBe(0);
    expect(body.error.details?.reset_at).toBeGreaterThan(Date.now() - 1000);
  });

  it('integration: 50 batches of 100 events under 10k cap succeed; 51st fails', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        rateLimit: { allowFirstNEvents: 10_000 },
      });
      const batchOf100 = JSON.stringify({ events: Array.from({ length: 100 }, () => validEvent) });

      // 50 sequential batches of 100 events = 5000 events used; well under 10k cap.
      for (let i = 0; i < 50; i++) {
        const res = await app.fetch(
          new Request('http://test/v1/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
            body: batchOf100,
          }),
          env,
        );
        expect(res.status, `batch ${String(i)} should succeed`).toBe(200);
      }

      // 51st batch of 100 events would total 5100 — still under 10k. Send a 5001-event batch
      // (single batch limit is 1000 — out of range; use a series instead). Simpler: use a 1000
      // batch then keep firing until we cross. Easier: jump straight to a batch that pushes us
      // over. We've used 5000; one more 1000-batch puts us at 6000. Fire 4 more 1000-batches to
      // hit 9000, then a 1001-budget-busting batch caps at 1000 (max batch). Use the cap-flip
      // path: switch to allowFirstNEvents: 5000 for clarity.
      const cappedEnv = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        rateLimit: { allowFirstNEvents: 5000 },
      });
      // Burn the 5000 cap with 50 batches of 100 events.
      for (let i = 0; i < 50; i++) {
        const res = await app.fetch(
          new Request('http://test/v1/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
            body: batchOf100,
          }),
          cappedEnv,
        );
        expect(res.status).toBe(200);
      }
      // 51st batch crosses the cap → 429.
      const overflow = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: batchOf100,
        }),
        cappedEnv,
      );
      expect(overflow.status).toBe(429);
    } finally {
      stub.restore();
    }
  });

  it('rate-limit check happens before per-event Zod validation (no Redpanda call when 429)', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        rateLimit: 'deny',
      });
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: JSON.stringify({ events: [validEvent, validEvent] }),
        }),
        env,
      );
      expect(res.status).toBe(429);
      // Redpanda must NOT have been hit when the request was rate-limited.
      expect(stub.callCount()).toBe(0);
    } finally {
      stub.restore();
    }
  });
});

// ─── ESC-016 — CORS allow-list for SDK browser callers ────────────────────────
describe('CORS — ESC-016 SDK browser callers', () => {
  it('OPTIONS preflight from app.estalara.com returns 204 with CORS headers', async () => {
    const app = createApp();
    const env = makeEnv();
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.estalara.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers':
            'content-type, x-estalara-api-key, x-estalara-signature',
        },
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.estalara.com');
    const allowMethods = res.headers.get('access-control-allow-methods') ?? '';
    expect(allowMethods).toContain('POST');
    expect(allowMethods).toContain('OPTIONS');
    const allowHeaders = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    expect(allowHeaders).toContain('content-type');
    expect(allowHeaders).toContain('x-estalara-api-key');
    expect(allowHeaders).toContain('x-estalara-signature');
    expect(allowHeaders).toContain('idempotency-key');
  });

  it('OPTIONS preflight from admin.estalara.com is also allowed', async () => {
    const app = createApp();
    const env = makeEnv();
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://admin.estalara.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://admin.estalara.com');
  });

  it('OPTIONS preflight from a disallowed origin omits the Allow-Origin header', async () => {
    const app = createApp();
    const env = makeEnv();
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      }),
      env,
    );
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('POST from app.estalara.com receives Access-Control-Allow-Origin on the actual response', async () => {
    const app = createApp();
    const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
    const stub = stubFetch('ok');
    try {
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: {
            Origin: 'https://app.estalara.com',
            'Content-Type': 'application/json',
            'X-Estalara-API-Key': 'k1',
          },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.estalara.com');
    } finally {
      stub.restore();
    }
  });

  it('POST from a disallowed origin omits Access-Control-Allow-Origin', async () => {
    const app = createApp();
    const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
    const stub = stubFetch('ok');
    try {
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: {
            Origin: 'https://evil.example.com',
            'Content-Type': 'application/json',
            'X-Estalara-API-Key': 'k1',
          },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
      );
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      stub.restore();
    }
  });
});

// ─── Dev-only localhost CORS (local E2E enablement) ───────────────────────────
//
// The browser SDK runs on http://localhost:5173 (Estalara-app SvelteKit) during
// local E2E testing and calls the Worker at http://localhost:8787. These tests
// verify that:
//   - In non-production envs (ENVIRONMENT !== 'production'), localhost origins are allowed.
//   - In the production env (ENVIRONMENT === 'production'), localhost origins are rejected —
//     the prod allow-list is unchanged.
//
// Gating mechanism: the CORS origin callback reads c.env.ENVIRONMENT at request time.
describe('CORS — dev-only localhost origins', () => {
  it('OPTIONS preflight from localhost:5173 is allowed in dev env', async () => {
    const app = createApp();
    const env = makeEnv({ environment: 'development' });
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type, x-estalara-api-key',
        },
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('OPTIONS preflight from localhost:3000 is allowed in dev env', async () => {
    const app = createApp();
    const env = makeEnv({ environment: 'development' });
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type, x-estalara-api-key',
        },
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('OPTIONS preflight from localhost:5173 is BLOCKED in production env', async () => {
    const app = createApp();
    const env = makeEnv({ environment: 'production' });
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
        },
      }),
      env,
    );
    // CORS middleware omits the header when the origin is not in the allow-list.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('OPTIONS preflight from localhost:3000 is BLOCKED in production env', async () => {
    const app = createApp();
    const env = makeEnv({ environment: 'production' });
    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
        },
      }),
      env,
    );
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('POST from localhost:5173 receives Access-Control-Allow-Origin in dev env', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        environment: 'development',
      });
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:5173',
            'Content-Type': 'application/json',
            'X-Estalara-API-Key': 'k1',
          },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    } finally {
      stub.restore();
    }
  });

  it('POST from localhost:5173 is BLOCKED (no Allow-Origin) in production env', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        environment: 'production',
      });
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:5173',
            'Content-Type': 'application/json',
            'X-Estalara-API-Key': 'k1',
          },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
      );
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      stub.restore();
    }
  });
});
