/**
 * FOLLOW-845 — buyer-text sentinel over the REAL `@sentry/cloudflare` capture
 * path, driven through the REAL `POST /v1/events` route.
 *
 * ## Why this file exists separately from `index.test.ts`
 *
 * `index.test.ts` does `vi.mock('@sentry/cloudflare')`, so it can only observe
 * the ARGUMENTS `handlers/events.ts` hands to `captureException`. That is half
 * the surface. The other half is `logger.error`, which emits via `console.log`
 * (`packages/shared/src/observability/logger.ts:111`) — and `consoleIntegration()`
 * is the LAST entry of `getDefaultIntegrations` in
 * `@sentry/cloudflare@10.50.0` (`build/cjs/sdk.js:29`), applied by `init()`
 * whenever no `integrations` key is passed, which is what
 * `apps/ingest/src/observability.ts` does in production. A mocked SDK cannot see
 * that sink at all. This file builds a real `CloudflareClient` from the real
 * default integration list with a memory transport and asserts over the ENTIRE
 * serialised envelope set.
 *
 * ## The three claims, and why each is asserted in the direction it is
 *
 *   1. **Positive control (both sinks reach the wire).** Asserted first and
 *      deliberately: a test whose only assertion is "the sentinel is absent"
 *      passes just as happily when the harness captures nothing at all. This
 *      block proves the harness observes an exception value AND a
 *      `category: 'console'` breadcrumb produced by `console.log` specifically —
 *      not `console.error`, because `console.log` is the call the shared logger
 *      actually makes, and asserting the wrong level would leave the logger sink
 *      unproven. (FOLLOW-832: an assertion that could never fail sat in this
 *      repo for 23 hours, vouched for by six documents. The defence against that
 *      class is a control that FAILS if the plumbing is dead.)
 *   2. **The fix (the ClickHouse response body never reaches either sink).**
 *      Drives the real route with a stubbed `fetch` returning a REAL ClickHouse
 *      400 — captured from `clickhouse/clickhouse-server:25.8`, the version CI
 *      pins, inserting the real `toClickHouseRow` shape into the real `events`
 *      DDL (transcript in the FOLLOW-845 PR body). ClickHouse quotes the
 *      offending input verbatim, so that body contains the buyer's chat text.
 *      Asserts the sentinel is in NONE of the envelopes and — in the other
 *      direction, so the fix cannot degrade into "log nothing" — that both sinks
 *      still carry the status, the ClickHouse error code, its class and the
 *      query id an operator pivots on.
 *   3. **The accepted boundary (the transport-rejection message still reaches
 *      Sentry).** Asserted as SURVIVING, the same way
 *      `handlers/chat-nlp-sentry-capture-path.test.ts` records FOLLOW-838's
 *      accepted residual risk executably. That arm fires on a transport-layer
 *      rejection whose message the Workers runtime generates, no leg of which is
 *      derived from the rows being POSTed (credentials ride an `Authorization`
 *      header, not the URL), so it was assessed and left intact rather than
 *      redacted by reflex. If that assessment is ever revisited, this test is
 *      where the change surfaces — and `docs/compliance/dpia.md` §2.7.2 must be
 *      amended in the same PR.
 *
 * @module apps/ingest/src/clickhouse-sentry-capture-path
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Sentry from '@sentry/cloudflare';

import { createApp } from './router.js';
import type { Env } from './types.js';

/**
 * The sentinels below deliberately contain SPACES and stay short. `gitleaks`'
 * default `cloudflare-api-token` rule matches any 40-character run of
 * `[A-Za-z0-9_-]` above a Shannon-entropy floor, and long underscore-joined
 * screaming-snake-case names tripped it three times on PR #681 (the same trap
 * FOLLOW-832 hit). The offending names are NOT quoted here — doing so
 * re-triggers the rule on the very comment explaining it. A space is outside
 * that character class, so it breaks the run regardless of length, and a
 * sentinel with spaces in it is a better stand-in for typed chat anyway.
 */

/** Stands in for buyer-authored chat text quoted back by ClickHouse. */
const BUYER_SENTINEL = 'F845 buyer szukam domu dla Zosi';
/** Stands in for any string written to `console.log` (positive control). */
const CONTROL_SENTINEL = 'F845 control harness is live';
/** Stands in for a runtime-generated transport rejection message. */
const TRANSPORT_SENTINEL = 'F845 transport connection lost';

/** The query id ClickHouse assigns; the operator's pivot into `system.query_log`. */
const CH_QUERY_ID = '53a57251-0991-4c06-b502-80e17c93dda1';

/**
 * A REAL ClickHouse 400 body, captured from `clickhouse-server:25.8` while
 * INSERTing the `toClickHouseRow` shape into the real `events` DDL, with only
 * the buyer's message swapped for the sentinel. Written out in full rather than
 * abbreviated, because the point of the assertion is that this WHOLE thing is
 * never read: note that the buyer's text sits inside the first 500 characters,
 * i.e. inside the exact window the old `response.text().slice(0, 500)` copied.
 */
const CH_PARSE_ERROR_BODY =
  String.raw`Code: 27. DB::Exception: Cannot parse input: expected 'null' before: ', "payload": "{\"message_id\": \"m1\", \"role\": \"user\", \"text\": \"` +
  BUYER_SENTINEL +
  String.raw`\"}"}': (while reading the value of key archetype_hint): (at row 1)
: While executing ParallelParsingBlockInputFormat. (CANNOT_PARSE_INPUT_ASSERTION_FAILED) (version 25.8.29.51 (official build))`;

const CLICKHOUSE_URL = 'https://mock-clickhouse:8443';

const VALID_KEY_RECORD = JSON.stringify({
  tenant_id: 'tenant-uuid-1',
  scopes: ['write:events'],
});

/** A `chat.message.sent` event — the payload class that makes this leak matter. */
const chatEvent = {
  event_id: '01928f00-7000-7000-8000-123456789abc',
  tenant_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
  session_id: 'a'.repeat(40),
  ts: 1714180000000,
  region: 'eu' as const,
  // `chat.message.sent` is profiling-class (consent-gate.ts); without a lawful
  // basis the gate would drop it before ClickHouse and this test would assert
  // nothing.
  consent_state: 'legitimate-interest' as const,
  schema_version: 1 as const,
  type: 'chat.message.sent',
  payload: { message: BUYER_SENTINEL, char_count: BUYER_SENTINEL.length },
};

function mockKv(store: Record<string, string | null>): Env['KV_API_KEYS'] {
  return {
    get: (key: string): Promise<string | null> => Promise.resolve(store[key] ?? null),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ keys: [], list_complete: true } as never),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null } as never),
  } as unknown as Env['KV_API_KEYS'];
}

function mockRateLimiter(): Env['RATE_LIMITER'] {
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

function makeEnv(): Env {
  return {
    ENVIRONMENT: 'test',
    // The only outbound fetch in this test is the ClickHouse INSERT — Redpanda's dead
    // publish path was retired ADR-0022 stage C (FOLLOW-988).
    CLICKHOUSE_URL,
    CLICKHOUSE_DATABASE: 'default',
    KV_API_KEYS: mockKv({ 'api_key:k1': VALID_KEY_RECORD }),
    KV_IDEMPOTENCY: mockKv({}),
    RATE_LIMITER: mockRateLimiter(),
  };
}

/** `ExecutionContext`-shaped mock: the post-ACK ClickHouse write rides `waitUntil`. */
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

/** Replace `globalThis.fetch` for one drive; every call is a ClickHouse INSERT. */
function stubClickHouseFetch(respond: () => Promise<Response>): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('mock-clickhouse')) return respond();
    return Promise.resolve(new Response('', { status: 200 }));
  };
  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/**
 * Every envelope the transport was handed. Never indexed positionally — the SDK
 * emits envelopes this test did not ask for (sessions, client reports) and which
 * arrives first is not deterministic across machines. Search the set.
 */
const captured: unknown[] = [];

/** Minimal breadcrumb shape read out of the serialised event. */
interface CapturedBreadcrumb {
  category?: string;
  message?: string;
}

/** Minimal event shape read out of the envelope. */
interface CapturedEvent {
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: CapturedBreadcrumb[];
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/** Search ALL envelopes for the first `type: 'event'` item. Order-independent. */
function findEventPayload(envelopes: readonly unknown[]): CapturedEvent | undefined {
  for (const envelope of envelopes) {
    const [, items] = envelope as [unknown, [{ type?: string }, unknown][]];
    const eventItem = items.find((item) => item[0].type === 'event');
    if (eventItem) return eventItem[1] as CapturedEvent;
  }
  return undefined;
}

/** Envelope item types actually captured, for a failure message worth reading. */
function describeCaptured(envelopes: readonly unknown[]): string {
  const kinds = envelopes.map((envelope) => {
    const [, items] = envelope as [unknown, [{ type?: string }, unknown][]];
    return items.map((item) => item[0].type ?? '<no type>').join('+');
  });
  return `captured ${String(envelopes.length)} envelope(s): [${kinds.join(', ')}]`;
}

/** Console breadcrumbs on an event, whatever level produced them. */
function consoleCrumbs(event: CapturedEvent | undefined): CapturedBreadcrumb[] {
  return (event?.breadcrumbs ?? []).filter((b) => b.category === 'console');
}

/**
 * Run `act` with an empty breadcrumb buffer and return every envelope produced.
 *
 * The explicit `clearBreadcrumbs()` is load-bearing: without it each scenario's
 * console lines pile onto the NEXT scenario's event, which does not make a green
 * run wrong (the sentinels differ) but makes a red run point at another block's
 * output. `withIsolationScope` alone does not fix it — the Workers runtime
 * installs an AsyncLocalStorage context strategy per request and vitest/node
 * does not, so the forked scope is not the one holding the breadcrumbs.
 */
async function captureDuring(act: () => Promise<void>): Promise<unknown[]> {
  captured.length = 0;
  Sentry.getIsolationScope().clearBreadcrumbs();
  await Sentry.withIsolationScope(async () => {
    await act();
  });
  await Sentry.flush(2000);
  return [...captured];
}

/** Drive the real route once and drain the post-ACK ClickHouse promise. */
async function postChatEvent(): Promise<Response> {
  const app = createApp();
  const { ctx, drain } = mockExecutionCtx();
  const res = await app.fetch(
    new Request('http://test/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
      body: JSON.stringify({ events: [chatEvent] }),
    }),
    makeEnv(),
    ctx as never,
  );
  await drain();
  return res;
}

beforeAll(() => {
  // `@sentry/cloudflare` does not export `init` (only `withSentry`, which needs
  // a Workers `ExportedHandler` + `env`), so the client is built directly from
  // the SAME `getDefaultIntegrations` list `init` would use. Deliberately NOT
  // hand-picking integrations: the claim under test is what the DEFAULTS do,
  // which is what `observability.ts` runs in production.
  const base = {
    dsn: 'https://publickey@o0.ingest.sentry.io/0',
    environment: 'test',
    // The stack parser is irrelevant here (no frames are asserted) and the real
    // one is not exported; an empty parser keeps the client constructible.
    stackParser: () => [],
    transport: () => ({
      send: (envelope: unknown) => {
        captured.push(envelope);
        return Promise.resolve({});
      },
      flush: () => Promise.resolve(true),
    }),
  };
  const client = new Sentry.CloudflareClient({
    ...base,
    integrations: Sentry.getDefaultIntegrations(base),
  });
  Sentry.setCurrentClient(client);
  client.init();
});

afterAll(async () => {
  await Sentry.close(2000);
});

describe('FOLLOW-845 — the ClickHouse error body reaches no Sentry sink', () => {
  it('control: console.log AND captureException both reach the wire (harness is live)', async () => {
    const envelopes = await captureDuring(() => {
      // `console.log`, NOT `console.error`: this is the call the shared logger
      // makes, so it is the one whose coupling to Sentry has to be proven.
      console.log(`[control] ${CONTROL_SENTINEL}`);
      Sentry.captureException(new Error(`[control] ${CONTROL_SENTINEL}`));
      return Promise.resolve();
    });

    const event = findEventPayload(envelopes);
    expect(event, `no type:'event' item — ${describeCaptured(envelopes)}`).toBeDefined();
    // Sink A — the exception value.
    expect(event?.exception?.values?.[0]?.value).toContain(CONTROL_SENTINEL);
    // Sink B — the console line, carried by the DEFAULT `consoleIntegration()`.
    expect(consoleCrumbs(event).length).toBeGreaterThan(0);
    expect(consoleCrumbs(event).some((b) => (b.message ?? '').includes(CONTROL_SENTINEL))).toBe(
      true,
    );
  });

  it('the fixture itself leaks — the captured ClickHouse body quotes the buyer text in its first 500 chars', () => {
    // Guards the guard: if a future edit trims this fixture down to something
    // that no longer contains the sentinel, the absence assertion below would
    // still pass while proving nothing. That is the FOLLOW-832 failure mode.
    expect(CH_PARSE_ERROR_BODY.slice(0, 500)).toContain(BUYER_SENTINEL);
  });

  it('drops the ClickHouse 400 body from every sink while keeping status, code, class and query id', async () => {
    // ONE drive, both directions asserted on the same captured set. Splitting it
    // in two is wrong: `dedupeIntegration()` is also a default
    // (`build/cjs/sdk.js:18`), so a second identical exception is dropped by the
    // client and the second test would observe zero envelopes.
    const stub = stubClickHouseFetch(() =>
      Promise.resolve(
        new Response(CH_PARSE_ERROR_BODY, {
          status: 400,
          headers: {
            'Content-Type': 'text/plain; charset=UTF-8',
            'X-ClickHouse-Exception-Code': '27',
            'X-ClickHouse-Query-Id': CH_QUERY_ID,
          },
        }),
      ),
    );
    try {
      const envelopes = await captureDuring(async () => {
        const res = await postChatEvent();
        // The SDK still gets its ACK — ClickHouse is post-ACK (FOLLOW-459).
        expect(res.status).toBe(200);
      });

      // Whole-structure assertion over EVERY envelope: exception value, message,
      // breadcrumbs, `extra`, `tags` — anywhere a future edit could route it.
      expect(JSON.stringify(envelopes)).not.toContain(BUYER_SENTINEL);

      // Non-vacuous in the other direction: the fix must not degrade into
      // "capture nothing". Both sinks still carry what an operator triages on.
      const event = findEventPayload(envelopes);
      expect(event, `no type:'event' item — ${describeCaptured(envelopes)}`).toBeDefined();
      expect(event?.exception?.values?.[0]?.value).toBe(
        'clickhouse_push_failed_post_ack: clickhouse_status_400:ch_code_27:row_rejected',
      );
      expect(event?.tags?.kind).toBe('insert_failed');
      expect(event?.extra?.upstream_status).toBe(400);
      expect(event?.extra?.ch_error_code).toBe(27);
      expect(event?.extra?.ch_query_id).toBe(CH_QUERY_ID);
      // The logger sink too: the `console.log` line still names the failure, the
      // code and the query id — this is what a drift incident looks like now.
      const line = consoleCrumbs(event).find((b) =>
        (b.message ?? '').includes('clickhouse_push_failed_post_ack'),
      );
      expect(
        line,
        `no clickhouse_push_failed_post_ack console line — ${describeCaptured(envelopes)}`,
      ).toBeDefined();
      expect(line?.message).toContain('ch_code_27:row_rejected');
      expect(line?.message).toContain(CH_QUERY_ID);
    } finally {
      stub.restore();
    }
  });

  it('ACCEPTED BOUNDARY: the transport-rejection arm still carries the runtime error message', async () => {
    // Asserted as SURVIVING on purpose — see claim 3 in the module docstring.
    const stub = stubClickHouseFetch(() => Promise.reject(new Error(TRANSPORT_SENTINEL)));
    try {
      const envelopes = await captureDuring(async () => {
        await postChatEvent();
      });

      const event = findEventPayload(envelopes);
      expect(event, `no type:'event' item — ${describeCaptured(envelopes)}`).toBeDefined();
      expect(event?.tags?.kind).toBe('insert_failed');
      expect(JSON.stringify(envelopes)).toContain(TRANSPORT_SENTINEL);
      // But the buyer's message text is NOT in this arm either: nothing on this
      // path interpolates the rows being inserted.
      expect(JSON.stringify(envelopes)).not.toContain(BUYER_SENTINEL);
    } finally {
      stub.restore();
    }
    // `pushToClickHouse` retries a network failure 3x, sleeping 100ms then 500ms
    // between attempts — the generous timeout is headroom for a slow CI runner,
    // not the expected duration (~0.6s locally).
  }, 20_000);
});
