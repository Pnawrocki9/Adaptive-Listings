/**
 * Integration tests for the ingest Worker. We exercise the Hono app by calling `app.fetch`
 * directly; the bindings are mocked so tests stay in plain Node (no `wrangler dev`, no
 * `@cloudflare/vitest-pool-workers`).
 */

import { describe, expect, it, vi } from 'vitest';

// FOLLOW-459: mocked so the post-ACK ClickHouse-failure test can assert
// `Sentry.captureException` was called, without needing a real Sentry init
// (matches the pattern in handlers/__tests__/intent-snapshot.test.ts).
// FOLLOW-559: consent-gate rejections emit `Sentry.captureMessage` (structured counter), so the
// mock must expose it alongside `captureException`.
vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

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
    // CLICKHOUSE_URL empty → no-cred guard fires, so no outbound sink call happens by
    // default (the event-bus path was retired ADR-0022 stage C, FOLLOW-988). CH-specific
    // paths are exercised in clickhouse-producer.test.ts. FOLLOW-459's ACK-latency test
    // overrides this via `clickhouseUrl` to exercise the post-ACK write path.
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { Origin: 'https://app.estalara.com', 'X-Estalara-API-Key': 'k1' },
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
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://app.estalara.com',
          'X-Estalara-API-Key': 'k1',
        },
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
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://app.estalara.com',
          'X-Estalara-API-Key': 'k1',
        },
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
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://app.estalara.com',
          'X-Estalara-API-Key': 'k1',
        },
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
          Origin: 'https://app.estalara.com',
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
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        clickhouseUrl: 'https://mock-clickhouse:8443',
      });
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://app.estalara.com',
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
      // ClickHouse INSERT fires (fire-and-forget, no waitUntil ctx in this call shape — see
      // makeEnv's own comment). The event-bus gate here was retired ADR-0022 stage C.
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
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://app.estalara.com',
            'X-Estalara-API-Key': 'k1',
          },
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

  it('skips the sink when every event is rejected', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        clickhouseUrl: 'https://mock-clickhouse:8443',
      });
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://app.estalara.com',
            'X-Estalara-API-Key': 'k1',
          },
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

// ─── FOLLOW-931 / RETRO-264 LG-4 — a Spanish visitor's consent decision must SURVIVE ingest ──
// The bug this pins: `ConsentGrantedPayloadSchema.language` was a hand-written `z.enum(['en',
// 'pl'])` while the banner shipped `en`, `pl` AND `es`. `EventSchema.safeParse` therefore
// rejected `{ language: 'es' }` per-event, the batch still returned 200, and the visitor's
// decision — which our own `es` disclosure text promises we record — was discarded in silence.
// Asserted at the INGEST boundary, through the real `EventSchema`, because that is where the
// event actually died; a payload-schema unit test alone would not have proven the drop.
describe('POST /v1/events — consent audit events in every banner locale (FOLLOW-931)', () => {
  const authHeaders = {
    'Content-Type': 'application/json',
    Origin: 'https://app.estalara.com',
    'X-Estalara-API-Key': 'k1',
  };

  for (const language of ['en', 'pl', 'es'] as const) {
    it(`accepts consent.granted and consent.denied in '${language}'`, async () => {
      const stub = stubFetch('ok');
      try {
        const app = createApp();
        const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
        const events = (
          [
            ['consent.granted', '01928f00-7000-7000-8000-123456789001'],
            ['consent.denied', '01928f00-7000-7000-8000-123456789002'],
          ] as const
        ).map(([type, eventId]) => ({
          ...validEvent,
          event_id: eventId,
          type,
          payload: { language, method: 'banner' as const },
        }));
        const res = await app.fetch(
          new Request('http://test/v1/events', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ events }),
          }),
          env,
        );
        expect(res.status).toBe(200);
        const body = await readJson<{ accepted: number; rejected: number }>(res);
        expect(body.rejected, `'${language}' consent decisions were dropped at ingest`).toBe(0);
        expect(body.accepted).toBe(2);
      } finally {
        stub.restore();
      }
    });
  }

  it('a schema rejection now emits a Sentry signal, flagged when it carries a consent event', async () => {
    const stub = stubFetch('ok');
    try {
      vi.mocked(Sentry.captureMessage).mockClear();
      const app = createApp();
      const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD } });
      // `de` is outside the canonical language tuple — still correctly rejected.
      const events = [
        { ...validEvent, type: 'consent.denied', payload: { language: 'de', method: 'banner' } },
      ];
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ events }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      expect((await readJson<{ rejected: number }>(res)).rejected).toBe(1);
      // Rule K.2 — the drop is observable. Before FOLLOW-931 this path fired nothing at all,
      // which is precisely why the `es` defect survived undetected.
      expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
        'schema_rejected',
        expect.objectContaining({
          level: 'warning',
          tags: expect.objectContaining({ gate: 'schema', has_consent_event: 'true' }),
        }),
      );
    } finally {
      stub.restore();
    }
  });
});

// ─── FOLLOW-559 / audit A3-F-08 — server-side consent gate at the storage boundary ───────────
// End-to-end proof that the gate runs INSIDE the events handler (not just as a pure unit): a
// profiling event with consent_state=none is rejected per-event and never reaches the sink,
// while audit/operational events in the SAME batch still ingest (§H.9 non-regression). Sink call
// counting exercises ClickHouse (`clickhouseUrl` below) — the event-bus gate here was retired
// ADR-0022 stage C, FOLLOW-988.
describe('POST /v1/events — consent gate (FOLLOW-559)', () => {
  const authHeaders = {
    'Content-Type': 'application/json',
    Origin: 'https://app.estalara.com',
    'X-Estalara-API-Key': 'k1',
  };
  const CH_URL = 'https://mock-clickhouse:8443';

  it('rejects a profiling event with consent_state=none and skips the sink', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD }, clickhouseUrl: CH_URL });
      const profilingNone = { ...validEvent, consent_state: 'none' as const };
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ events: [profilingNone] }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      const body = await readJson<{
        accepted: number;
        rejected: number;
        errors: { index: number; errors: { code: string; consent_class: string } }[];
      }>(res);
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(1);
      expect(body.errors[0]?.errors.code).toBe('consent_not_granted');
      expect(body.errors[0]?.errors.consent_class).toBe('profiling');
      // Never pushed to the sink (every event rejected → sink skipped).
      expect(stub.callCount()).toBe(0);
      // Structured Sentry counter fired.
      expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
        'consent_gate_rejected',
        expect.objectContaining({
          level: 'warning',
          tags: expect.objectContaining({ gate: 'consent', code: 'consent_not_granted' }),
        }),
      );
    } finally {
      stub.restore();
    }
  });

  it('§H.9: consent.denied audit event ingests even with consent_state=none', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD }, clickhouseUrl: CH_URL });
      const consentDenied = {
        ...validEvent,
        consent_state: 'none' as const,
        type: 'consent.denied',
        payload: { language: 'en', method: 'banner' },
      };
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ events: [consentDenied] }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      const body = await readJson<{ accepted: number; rejected: number }>(res);
      expect(body.accepted).toBe(1);
      expect(body.rejected).toBe(0);
      expect(stub.callCount()).toBe(1);
    } finally {
      stub.restore();
    }
  });

  it('§H.9: mixed batch — audit event survives while sibling profiling(none) is dropped', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD }, clickhouseUrl: CH_URL });
      const consentGranted = {
        ...validEvent,
        consent_state: 'none' as const,
        type: 'consent.granted',
        payload: { language: 'en', method: 'banner' },
      };
      const profilingNone = { ...validEvent, consent_state: 'none' as const };
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ events: [consentGranted, profilingNone] }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      const body = await readJson<{ accepted: number; rejected: number }>(res);
      // Audit event survives (1 accepted); profiling(none) is dropped (1 rejected). A whole-batch
      // 4xx would have lost the consent.granted audit event — the exact §H.9 regression this guards.
      expect(body.accepted).toBe(1);
      expect(body.rejected).toBe(1);
      expect(stub.callCount()).toBe(1);
    } finally {
      stub.restore();
    }
  });

  it('§H.9: profiling event WITH consent (legitimate-interest) still ingests for opted-out users', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD }, clickhouseUrl: CH_URL });
      // An opted-out user still carries a valid consent_state (§H.8 registration consent) — the
      // stream must keep flowing. `validEvent` already uses consent_state='legitimate-interest'.
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      const body = await readJson<{ accepted: number; rejected: number }>(res);
      expect(body.accepted).toBe(1);
      expect(body.rejected).toBe(0);
      expect(stub.callCount()).toBe(1);
    } finally {
      stub.restore();
    }
  });
});

// ─── FOLLOW-1294 / ESC-082 — a stale `session.quality.snapshot` is rejected per event ───
// DQS was removed (CEO decision D4) and ESC-082 (option 1) removed the type from the shared
// `EventSchema`: a stale cached SDK bundle that still sends it gets that ONE event back in
// `rejected[]` (the existing schema-rejection path — no new error code, no accept-and-drop
// branch) while the rest of its batch is persisted. We intercept the ClickHouse INSERT (the only
// sink, ADR-0022 stage C) and read the types of every persisted NDJSON row.
describe('POST /v1/events — session.quality.snapshot rejected per event (FOLLOW-1294, ESC-082)', () => {
  const authHeaders = {
    'Content-Type': 'application/json',
    Origin: 'https://app.estalara.com',
    'X-Estalara-API-Key': 'k1',
  };
  const CH_URL = 'https://mock-clickhouse:8443';

  /** Stub `fetch` to capture the event types of every ClickHouse INSERT row (200 ACK). */
  function stubFetchCaptureClickHouseTypes(): {
    restore: () => void;
    persistedTypes: () => string[];
  } {
    const original = globalThis.fetch;
    const types: string[] = [];
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('mock-clickhouse') && typeof init?.body === 'string') {
        for (const line of init.body.split('\n')) {
          if (!line) continue;
          const row = JSON.parse(line) as { type?: string };
          if (typeof row.type === 'string') types.push(row.type);
        }
      }
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    };
    return {
      restore: () => {
        globalThis.fetch = original;
      },
      persistedTypes: () => types,
    };
  }

  const staleSnapshot = {
    ...validEvent,
    event_id: '01928f00-7000-7000-8000-123456789abd',
    type: 'session.quality.snapshot',
    payload: {
      session_id: 'a'.repeat(64),
      prediction_stability_score: 0.8,
      convergence_time_events: 5,
      signal_density_per_min: 3,
      final_archetype: 'family_buyer',
      final_confidence: 0.72,
      total_events: 10,
    },
  };

  it('rejects the snapshot in rejected[] and persists the rest of the batch', async () => {
    const stub = stubFetchCaptureClickHouseTypes();
    try {
      const app = createApp();
      const env = makeEnv({ kvStore: { 'api_key:k1': VALID_KEY_RECORD }, clickhouseUrl: CH_URL });
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ events: [validEvent, staleSnapshot] }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      const body = await readJson<{
        accepted: number;
        rejected: number;
        errors?: { index: number }[];
      }>(res);
      expect(body.accepted).toBe(1);
      expect(body.rejected).toBe(1);
      // The rejected entry points at the snapshot (index 1), not at the valid event.
      expect(body.errors?.map((e) => e.index)).toEqual([1]);
      // The valid event of the same batch reached the sink; the snapshot did not.
      expect(stub.persistedTypes()).toEqual(['page.view']);
    } finally {
      stub.restore();
    }
  });
});

// ─── FOLLOW-459 — ACK returns before the ClickHouse insert settles ────────────
//
// Makes ClickHouse slow/failing independently by matching on its mock URL. The event bus's
// synchronous-ACK gate (which this file used to distinguish it from) is gone — ADR-0022 stage C,
// FOLLOW-988 — so ClickHouse is the only sink left to distinguish anything by.
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
    // Any other URL resolves instantly — defensive catch-all, nothing in this handler calls
    // fetch on a non-ClickHouse host anymore.
    return Promise.resolve(new Response('', { status: 200 }));
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
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://app.estalara.com',
            'X-Estalara-API-Key': 'k1',
          },
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
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://app.estalara.com',
            'X-Estalara-API-Key': 'k1',
          },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
        ctx as never,
      );

      // The client still gets the ACK — ClickHouse's outcome is no longer on the critical
      // path (RETRY-CONTRACT CHANGE, events.ts).
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
  }, 20_000); // backoff 100+500+2500 ms = ~3.1s of real waits
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
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://app.estalara.com',
            'X-Estalara-API-Key': 'k1',
          },
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
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://app.estalara.com',
            'X-Estalara-API-Key': 'k1',
          },
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
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://app.estalara.com',
            'X-Estalara-API-Key': 'k1',
          },
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
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://app.estalara.com',
            'X-Estalara-API-Key': 'k1',
          },
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
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://app.estalara.com',
          'X-Estalara-API-Key': 'k1',
        },
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
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://app.estalara.com',
              'X-Estalara-API-Key': 'k1',
            },
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
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://app.estalara.com',
              'X-Estalara-API-Key': 'k1',
            },
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
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://app.estalara.com',
            'X-Estalara-API-Key': 'k1',
          },
          body: batchOf100,
        }),
        cappedEnv,
      );
      expect(overflow.status).toBe(429);
    } finally {
      stub.restore();
    }
  });

  it('rate-limit check happens before per-event Zod validation (no sink call when 429)', async () => {
    const stub = stubFetch('ok');
    try {
      const app = createApp();
      const env = makeEnv({
        kvStore: { 'api_key:k1': VALID_KEY_RECORD },
        rateLimit: 'deny',
        clickhouseUrl: 'https://mock-clickhouse:8443',
      });
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://app.estalara.com',
            'X-Estalara-API-Key': 'k1',
          },
          body: JSON.stringify({ events: [validEvent, validEvent] }),
        }),
        env,
      );
      expect(res.status).toBe(429);
      // The sink must NOT have been hit when the request was rate-limited.
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

  // FOLLOW-1333: the preflight no longer reflects an arbitrary origin (FOLLOW-642 did, because a
  // per-tenant list could only be read at the POST). One constant list answers both.
  it('OPTIONS preflight from an unlisted origin carries no Allow-Origin', async () => {
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
    expect(res.status).toBe(204);
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

  // FOLLOW-642 / FOLLOW-1333: a disallowed origin is REJECTED 403 at the POST (before any side
  // effect), and the Allow-Origin header is omitted.
  it('POST from a disallowed origin is rejected 403 and omits Access-Control-Allow-Origin', async () => {
    const app = createApp();
    const env = makeEnv({
      kvStore: { 'api_key:k1': VALID_KEY_RECORD },
      clickhouseUrl: 'https://mock-clickhouse:8443',
    });
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
      expect(res.status).toBe(403);
      const body = await readJson<{ error: { code: string } }>(res);
      expect(body.error.code).toBe('forbidden_origin');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      // No ingest side effect fired: the origin gate returns before the sink write.
      expect(stub.callCount()).toBe(0);
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

  // FOLLOW-1333: in production the preflight answers no Allow-Origin for localhost; the POST is
  // refused as well ('POST from localhost:5173 is BLOCKED in production env' below).
  it('OPTIONS preflight from localhost:5173 carries no Allow-Origin in production env', async () => {
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
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('OPTIONS preflight from localhost:3000 carries no Allow-Origin in production env', async () => {
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
    expect(res.status).toBe(204);
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

  it('POST from localhost:5173 is BLOCKED (403, no Allow-Origin) in production env', async () => {
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
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      stub.restore();
    }
  });
});

// ─── FOLLOW-1333 — one constant origin list; the KV record's origin field is ignored ──────────
//
// Before FOLLOW-1333 the gate read `allowed_origins` from the KV api-key record (absent =
// inherit, `[]` = deny every browser, `[...]` = exactly those) behind a first-party tenant-id
// guard. A record written then may still carry the field; these tests pin that the Worker no
// longer reads it — in either direction.
describe('CORS — FOLLOW-1333 constant origin list (KV allowed_origins ignored)', () => {
  const LEGACY_EXPLICIT_RECORD = JSON.stringify({
    tenant_id: 'tenant-1',
    scopes: ['write:events'],
    allowed_origins: ['https://listings.clientx.com'],
  });
  const LEGACY_DENY_ALL_RECORD = JSON.stringify({
    tenant_id: 'tenant-1',
    scopes: ['write:events'],
    allowed_origins: [],
  });

  async function post(
    record: string,
    origin: string,
    environment: string,
  ): Promise<{ res: Response; sinkCalls: number }> {
    const stub = stubFetch('ok');
    try {
      const env = makeEnv({
        kvStore: { 'api_key:kx': record },
        environment,
        clickhouseUrl: 'https://mock-clickhouse:8443',
      });
      const res = await createApp().fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'application/json',
            'X-Estalara-API-Key': 'kx',
          },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
      );
      return { res, sinkCalls: stub.callCount() };
    } finally {
      stub.restore();
    }
  }

  it.each(['https://app.estalara.com', 'https://admin.estalara.com'])(
    'production: %s is accepted (200 + Allow-Origin)',
    async (origin) => {
      const { res } = await post(VALID_KEY_RECORD, origin, 'production');
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    },
  );

  it('production: an origin listed only in the legacy KV field is refused 403, nothing written', async () => {
    vi.mocked(Sentry.captureMessage).mockClear();
    const { res, sinkCalls } = await post(
      LEGACY_EXPLICIT_RECORD,
      'https://listings.clientx.com',
      'production',
    );
    expect(res.status).toBe(403);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden_origin');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(sinkCalls).toBe(0);
    // Rule K.2: the refusal stays observable.
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
      'origin_gate_rejected',
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('production: a legacy explicit list no longer locks out Estalara’s own origin', async () => {
    const { res } = await post(LEGACY_EXPLICIT_RECORD, 'https://app.estalara.com', 'production');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.estalara.com');
  });

  it('production: a legacy deny-all ([]) record no longer refuses a listed origin', async () => {
    const { res } = await post(LEGACY_DENY_ALL_RECORD, 'https://app.estalara.com', 'production');
    expect(res.status).toBe(200);
  });

  it('production: localhost is refused 403 even when the legacy KV field lists it', async () => {
    const record = JSON.stringify({
      tenant_id: 'tenant-1',
      scopes: ['write:events'],
      allowed_origins: ['http://localhost:5173'],
    });
    const { res, sinkCalls } = await post(record, 'http://localhost:5173', 'production');
    expect(res.status).toBe(403);
    expect(sinkCalls).toBe(0);
  });

  it.each(['development', 'test', 'staging'])(
    '%s: http://localhost:5173 (fixture page + local Estalara app) is accepted',
    async (environment) => {
      const { res } = await post(VALID_KEY_RECORD, 'http://localhost:5173', environment);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    },
  );

  it.each([
    'https://evil.example.com',
    'http://localhost:9200',
    'https://app.estalara.com.evil.example',
    'null',
  ])('development: %s is refused 403 with no Allow-Origin', async (origin) => {
    const { res, sinkCalls } = await post(VALID_KEY_RECORD, origin, 'development');
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(sinkCalls).toBe(0);
  });

  it('a server-side caller (no Origin) with no signature is still refused as unsigned', async () => {
    const stub = stubFetch('ok');
    try {
      const res = await createApp().fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'kx' },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        makeEnv({ kvStore: { 'api_key:kx': LEGACY_DENY_ALL_RECORD }, environment: 'production' }),
      );
      expect(res.status).toBe(401);
      const body = await readJson<{ error: { details?: { reason?: string } } }>(res);
      expect(body.error.details?.reason).toBe('unsigned_server_caller');
    } finally {
      stub.restore();
    }
  });
});

describe('CORS — FOLLOW-1252 error responses keep the Allow-Origin', () => {
  const TENANT_KEY_RECORD = VALID_KEY_RECORD;

  function post(env: Env): Promise<Response> {
    return Promise.resolve(
      createApp().fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: {
            Origin: 'https://app.estalara.com',
            'Content-Type': 'application/json',
            'X-Estalara-API-Key': 'kx',
          },
          body: JSON.stringify({ events: [validEvent] }),
        }),
        env,
      ),
    );
  }

  it('an unhandled throw after the gate (rate-limiter DO unreachable) is a 500 WITH Allow-Origin', async () => {
    const env = makeEnv({
      kvStore: { 'api_key:kx': TENANT_KEY_RECORD },
      environment: 'production',
    });
    env.RATE_LIMITER = {
      idFromName: () => ({ toString: () => 'mock-id' }),
      get: () => ({ fetch: () => Promise.reject(new Error('do_unreachable_test')) }),
    } as unknown as Env['RATE_LIMITER'];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await post(env);
      expect(res.status).toBe(500);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.estalara.com');
      expect(res.headers.get('access-control-expose-headers')).toContain('Retry-After');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('a 429 carries Allow-Origin, so the SDK can read the status and Retry-After', async () => {
    const env = makeEnv({
      kvStore: { 'api_key:kx': TENANT_KEY_RECORD },
      environment: 'production',
      rateLimit: 'deny',
    });
    const res = await post(env);
    expect(res.status).toBe(429);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.estalara.com');
  });
});
