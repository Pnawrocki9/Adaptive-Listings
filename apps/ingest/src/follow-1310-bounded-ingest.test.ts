/**
 * FOLLOW-1310 — bounded, recoverable ingest (Codex F-06 / F-15 / F-18 / F-31) at the HTTP surface.
 *
 * Each block names the defect it pins and was run RED against the pre-fix handler first:
 *
 *  - F-06: one event whose `ts` ClickHouse `DateTime64(3)` cannot hold made the producer throw
 *    while building the NDJSON body, so the whole ACKed batch was lost (never fetched, never
 *    re-queued). Now that event alone is rejected with a typed reason and the rest persist.
 *  - F-15: an event whose single-record retry message could not fit a Cloudflare Queue message was
 *    ACKed anyway, so a ClickHouse outage would have lost it for good. Now it is refused up front.
 *  - F-18: a cached idempotent ACK was served BEFORE auth and the origin gate ran, so a revoked key
 *    or a foreign origin still received a 200. Now the replay runs after every admission gate.
 *  - F-31: a key record with no scopes authorised writes. Now the ingest scope contract is enforced
 *    before any side effect (legacy `read:events` browser keys keep working — no rename).
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { createApp } from './router.js';
import type { Env } from './types.js';

// ─── Harness ────────────────────────────────────────────────────────────────────────────────

function statefulKv(initial: Record<string, string> = {}): Env['KV_API_KEYS'] {
  const store = new Map(Object.entries(initial));
  return {
    get(key: string, type?: string): Promise<unknown> {
      const raw = store.get(key) ?? null;
      if (raw === null) return Promise.resolve(null);
      return Promise.resolve(type === 'json' ? (JSON.parse(raw) as unknown) : raw);
    },
    put(key: string, value: string): Promise<void> {
      store.set(key, value);
      return Promise.resolve();
    },
    delete(key: string): Promise<void> {
      store.delete(key);
      return Promise.resolve();
    },
    list: () => Promise.resolve({ keys: [], list_complete: true } as never),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null } as never),
  } as unknown as Env['KV_API_KEYS'];
}

function allowRateLimiter(): Env['RATE_LIMITER'] {
  const stub = {
    fetch: (): Promise<Response> =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            allowed: true,
            remaining: 49_999,
            reset_at: Date.now() + 60_000,
            limit: 50_000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
  };
  return {
    idFromName: () => ({ toString: () => 'mock-id' }),
    get: () => stub,
  } as unknown as Env['RATE_LIMITER'];
}

function recordingQueue(): { queue: Env['EVENTS_RETRY_QUEUE']; sent: unknown[] } {
  const sent: unknown[] = [];
  const queue = {
    send: (m: unknown) => {
      sent.push(m);
      return Promise.resolve();
    },
    sendBatch: () => Promise.resolve(),
  } as unknown as Env['EVENTS_RETRY_QUEUE'];
  return { queue, sent };
}

function execCtx(): { ctx: unknown; drain: () => Promise<void> } {
  const tasks: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => {
        tasks.push(p);
      },
      passThroughOnException: () => undefined,
    },
    drain: async () => {
      // A drained task may itself schedule more work (retry enqueue); settle until quiet.
      for (let seen = -1; seen !== tasks.length; ) {
        seen = tasks.length;
        await Promise.allSettled(tasks);
      }
    },
  };
}

interface FetchCall {
  url: string;
  body: string;
}

function stubFetch(respond: (url: string) => Response): {
  calls: FetchCall[];
  restore: () => void;
} {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
    return Promise.resolve(respond(url));
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const KEY = 'k-follow-1310';
const TENANT = 'tenant-uuid-1';
const WRITE_RECORD = JSON.stringify({ tenant_id: TENANT, scopes: ['write:events'] });

function makeEnv(
  opts: {
    keys?: Record<string, string>;
    idempotency?: Env['KV_IDEMPOTENCY'];
    clickhouse?: boolean;
    queue?: Env['EVENTS_RETRY_QUEUE'];
    supabase?: boolean;
  } = {},
): Env {
  return {
    ENVIRONMENT: 'test',
    CLICKHOUSE_URL: opts.clickhouse ? 'https://mock-clickhouse:8443' : '',
    CLICKHOUSE_DATABASE: 'default',
    KV_API_KEYS: statefulKv(opts.keys ?? { [`api_key:${KEY}`]: WRITE_RECORD }),
    KV_IDEMPOTENCY: opts.idempotency ?? statefulKv(),
    RATE_LIMITER: allowRateLimiter(),
    ...(opts.queue ? { EVENTS_RETRY_QUEUE: opts.queue } : {}),
    ...(opts.supabase
      ? { SUPABASE_URL: 'https://mock-supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' }
      : {}),
  };
}

let seq = 0;
function pageView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    event_id: `01928f00-7000-7000-8000-${String(seq).padStart(12, '0')}`,
    tenant_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
    session_id: 'a'.repeat(40),
    ts: 1714180000000,
    region: 'eu',
    consent_state: 'legitimate-interest',
    schema_version: 1,
    type: 'page.view',
    payload: {
      url: 'https://example.com/listing/1',
      viewport: { width: 1440, height: 900 },
      device_class: 'desktop',
    },
    ...overrides,
  };
}

function post(
  body: unknown,
  headers: Record<string, string> = {},
  apiKey: string | null = KEY,
): Request {
  return new Request('http://test/v1/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://app.estalara.com',
      ...(apiKey ? { 'X-Estalara-API-Key': apiKey } : {}),
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Parse a JSON response as a known shape (same helper shape as `index.test.ts`). */
async function readJson<T>(res: Response): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- assert caller's expected shape
  return (await res.json()) as T;
}

interface AckBody {
  accepted: number;
  rejected: number;
  batch_id: string;
  errors?: { index: number; errors: { code?: string } }[];
}

// ─── F-06 — per-event rejection, not batch loss ─────────────────────────────────────────────

describe('F-06: one bad timestamp no longer loses the acknowledged batch', () => {
  it('rejects ONLY the out-of-range event (typed reason) and persists the other two', async () => {
    const fetchStub = stubFetch(
      () => new Response('', { status: 200, headers: { 'X-ClickHouse-Summary': '{}' } }),
    );
    const { ctx, drain } = execCtx();
    try {
      const app = createApp();
      const env = makeEnv({ clickhouse: true });
      // 1e16 ms is past JS's Date range (8.64e15): `new Date(1e16).toISOString()` throws.
      const res = await app.fetch(
        post({ events: [pageView(), pageView({ ts: 1e16 }), pageView()] }),
        env,
        ctx as never,
      );
      expect(res.status).toBe(200);
      const body = await readJson<AckBody>(res);
      expect(body.accepted).toBe(2);
      expect(body.rejected).toBe(1);
      expect(body.errors).toEqual([
        { index: 1, errors: expect.objectContaining({ code: 'ts_out_of_range' }) },
      ]);

      await drain();
      const chInserts = fetchStub.calls.filter((c) => c.url.includes('mock-clickhouse'));
      expect(chInserts).toHaveLength(1);
      expect(chInserts[0]?.body.split('\n')).toHaveLength(2);
    } finally {
      fetchStub.restore();
    }
  });

  it('rejects a ts beyond ClickHouse DateTime64 (year 2300) even though JS can encode it', async () => {
    const app = createApp();
    const res = await app.fetch(
      post({ events: [pageView({ ts: Date.UTC(2300, 0, 1) }), pageView()] }),
      makeEnv(),
    );
    const body = await readJson<AckBody>(res);
    expect(body.accepted).toBe(1);
    expect(body.errors?.[0]?.errors.code).toBe('ts_out_of_range');
  });
});

// ─── F-15 — an ACKed event must always fit its retry message ───────────────────────────────

describe('F-15: an event too large for its retry message is refused, never ACKed-then-lost', () => {
  it('rejects the oversize event with event_too_large and accepts its neighbour', async () => {
    const app = createApp();
    // The envelope `listing_id` is an unbounded string; 140 KB on one event is a legal body
    // (< 1 MB) that cannot fit one 128 KB queue message.
    const res = await app.fetch(
      post({ events: [pageView(), pageView({ listing_id: 'x'.repeat(140_000) })] }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = await readJson<AckBody>(res);
    expect(body.accepted).toBe(1);
    expect(body.errors).toEqual([
      { index: 1, errors: expect.objectContaining({ code: 'event_too_large' }) },
    ]);
  });

  it('a failed intent.snapshot Supabase write is re-queued as a replayable side-write message', async () => {
    const fetchStub = stubFetch((url) =>
      url.includes('mock-supabase')
        ? new Response('', { status: 503 })
        : new Response('', { status: 200, headers: { 'X-ClickHouse-Summary': '{}' } }),
    );
    const { ctx, drain } = execCtx();
    const { queue, sent } = recordingQueue();
    try {
      const app = createApp();
      const env = makeEnv({ clickhouse: true, supabase: true, queue });
      const snapshot = pageView({
        type: 'intent.snapshot',
        consent_state: 'consented',
        payload: {
          archetype: 'family_buyer',
          confidence: 0.74,
          signal_count: 10,
          probabilities: { family_buyer: 0.74, neutral: 0.26 },
          quiz_completed: false,
          quiz_leaf: null,
          chat_turns: 3,
        },
      });
      const res = await app.fetch(post({ events: [snapshot] }), env, ctx as never);
      expect(res.status).toBe(200);
      expect((await readJson<AckBody>(res)).accepted).toBe(1);
      await drain();

      const sideWrites = sent.filter(
        (m) => (m as { kind?: string }).kind === 'intent_snapshot',
      ) as { schema_version: number; sink: string; snapshot: { session_id: string } }[];
      expect(sideWrites).toHaveLength(1);
      expect(sideWrites[0]).toMatchObject({ schema_version: 2, sink: 'supabase' });
      expect(sideWrites[0]?.snapshot.session_id).toBe('a'.repeat(40));
    } finally {
      fetchStub.restore();
    }
  });
});

// ─── F-18 — cached ACK replay is re-authorised ──────────────────────────────────────────────

const IDEM = 'idem-follow-1310-0000000000000000000000';

describe('F-18: an idempotent replay re-checks current auth and origin', () => {
  it('a legitimate replay still returns the cached ACK (Idempotency-Replay: true)', async () => {
    const app = createApp();
    const env = makeEnv();
    const batch = { events: [pageView()] };
    const first = await app.fetch(post(batch, { 'Idempotency-Key': IDEM }), env);
    const firstBody = await readJson<AckBody>(first);
    const second = await app.fetch(post(batch, { 'Idempotency-Key': IDEM }), env);
    expect(second.status).toBe(200);
    expect(second.headers.get('Idempotency-Replay')).toBe('true');
    expect((await readJson<AckBody>(second)).batch_id).toBe(firstBody.batch_id);
  });

  it('a revoked key gets 401 on replay, not the cached 200', async () => {
    const app = createApp();
    const idem = statefulKv();
    const batch = { events: [pageView()] };
    const ok = await app.fetch(
      post(batch, { 'Idempotency-Key': IDEM }),
      makeEnv({ idempotency: idem }),
    );
    expect(ok.status).toBe(200);
    // Same idempotency store, key record gone (revoked).
    const replay = await app.fetch(
      post(batch, { 'Idempotency-Key': IDEM }),
      makeEnv({ idempotency: idem, keys: {} }),
    );
    expect(replay.status).toBe(401);
    expect(replay.headers.get('Idempotency-Replay')).toBeNull();
  });

  it('a foreign Origin gets 403 on replay, not the cached 200', async () => {
    const app = createApp();
    const env = makeEnv();
    const batch = { events: [pageView()] };
    await app.fetch(post(batch, { 'Idempotency-Key': IDEM }), env);
    const replay = await app.fetch(
      post(batch, { 'Idempotency-Key': IDEM, Origin: 'https://evil.example' }),
      env,
    );
    expect(replay.status).toBe(403);
  });

  it('the same Idempotency-Key with a DIFFERENT body is refused, not answered with the old ACK', async () => {
    const app = createApp();
    const env = makeEnv();
    await app.fetch(post({ events: [pageView()] }, { 'Idempotency-Key': IDEM }), env);
    const reuse = await app.fetch(
      post({ events: [pageView(), pageView()] }, { 'Idempotency-Key': IDEM }),
      env,
    );
    expect(reuse.status).toBe(422);
    const body = await readJson<{ error: { code: string } }>(reuse);
    expect(body.error.code).toBe('idempotency_key_reused');
  });
});

// ─── F-31 — the scope contract is enforced ─────────────────────────────────────────────────

describe('F-31: API-key scopes are enforced before any side effect', () => {
  it('a record with EMPTY scopes is refused with 403 insufficient_scope', async () => {
    const fetchStub = stubFetch(() => new Response('', { status: 200 }));
    try {
      const app = createApp();
      const env = makeEnv({
        clickhouse: true,
        keys: { [`api_key:${KEY}`]: JSON.stringify({ tenant_id: TENANT, scopes: [] }) },
      });
      const res = await app.fetch(post({ events: [pageView()] }), env);
      expect(res.status).toBe(403);
      const body = await readJson<{ error: { code: string } }>(res);
      expect(body.error.code).toBe('insufficient_scope');
      expect(fetchStub.calls).toHaveLength(0);
    } finally {
      fetchStub.restore();
    }
  });

  it('a record whose scopes field is not a string array is refused as an invalid key record', async () => {
    const app = createApp();
    const res = await app.fetch(
      post({ events: [pageView()] }),
      makeEnv({ keys: { [`api_key:${KEY}`]: JSON.stringify({ tenant_id: TENANT }) } }),
    );
    expect(res.status).toBe(401);
    const body = await readJson<{ error: { details?: { reason: string } } }>(res);
    expect(body.error.details?.reason).toBe('invalid_key_record');
  });

  it('a legacy browser key carrying only read:events keeps ingesting (no rename, no break)', async () => {
    const app = createApp();
    const res = await app.fetch(
      post({ events: [pageView()] }),
      makeEnv({
        keys: {
          [`api_key:${KEY}`]: JSON.stringify({ tenant_id: TENANT, scopes: ['read:events'] }),
        },
      }),
    );
    expect(res.status).toBe(200);
    expect((await readJson<AckBody>(res)).accepted).toBe(1);
  });

  it('the current issuance shapes (public read+write, server write) are admitted', async () => {
    const app = createApp();
    const res = await app.fetch(
      post({ events: [pageView()] }),
      makeEnv({
        keys: {
          [`api_key:${KEY}`]: JSON.stringify({
            tenant_id: TENANT,
            scopes: ['read:events', 'write:events'],
          }),
        },
      }),
    );
    expect(res.status).toBe(200);
  });
});
