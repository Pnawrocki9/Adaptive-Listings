/**
 * FOLLOW-513 — proves the `queue()` handler exported from the REAL `index.ts` default export
 * runs with a BOUND Sentry client, closing the exact blind spot that shipped the bug: every other
 * test in this app either calls `handleEventsRetryQueue(...)` directly
 * (`handlers/events-retry-consumer.test.ts`) or exercises `createApp().fetch(...)` directly
 * (`index.test.ts`) — neither goes through the Worker's actual `export default { fetch, queue }`
 * wiring in `index.ts`, so neither would have caught `queue` bypassing `withSentry`.
 *
 * Unlike the other ingest test files, `@sentry/cloudflare` is NOT mocked here — the whole point is
 * to exercise the REAL `Sentry.withSentry`/`Sentry.init` binding behavior and observe a real
 * captured event reach the transport, which a no-op/unbound client could never do.
 *
 * @module apps/ingest/src/index-queue-sentry.test
 */

import { describe, expect, it, vi } from 'vitest';

// `@microlabs/otel-cf-workers` (imported by `./index.js` for the OTel `instrument()` wrapper)
// imports the `DurableObject` class from the `cloudflare:workers` built-in module at its own
// top level, for its (unused-by-us) DO-instrumentation helper. That module only exists inside
// the real Cloudflare Workers runtime; plain Node/vitest can't resolve the `cloudflare:` protocol.
// Stubbing it here is what actually lets this test be the first one to import the REAL
// `index.ts` default export at all (every other ingest test avoids `index.ts` entirely).
vi.mock('cloudflare:workers', () => ({
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- unused placeholder, see above
  DurableObject: function DurableObjectStub(): void {},
}));

import worker from './index.js';
import type { Env } from './types.js';

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

/** A fake, well-formed Sentry DSN pointed at a host this test's `fetch` stub intercepts. */
const FAKE_SENTRY_DSN = 'https://testpublickey@fake-ingest.example.com/1';

function makeEnv(): Env {
  return {
    ENVIRONMENT: 'test',
    CLICKHOUSE_URL: '',
    CLICKHOUSE_DATABASE: 'default',
    SENTRY_DSN_INGEST: FAKE_SENTRY_DSN,
    KV_API_KEYS: {} as never,
    KV_IDEMPOTENCY: {} as never,
    RATE_LIMITER: {} as never,
  };
}

function makeMalformedMessage(): {
  id: string;
  timestamp: Date;
  body: unknown;
  attempts: number;
  ack: () => void;
  retry: () => void;
} {
  return {
    id: 'msg-real-wiring',
    timestamp: new Date(),
    body: { not: 'a valid retry message' },
    attempts: 1,
    ack: () => undefined,
    retry: () => undefined,
  };
}

/**
 * Stubs `globalThis.fetch` to intercept ONLY calls to the fake Sentry ingest host, capturing each
 * request body as text. Any other URL (there should be none in this test — ClickHouse is never
 * reached because the message fails schema validation before `pushToClickHouse` is called) resolves
 * with a generic 200 so nothing hangs.
 */
function stubFetchCapturingSentryEnvelopes(): {
  restore: () => void;
  bodies: () => string[];
} {
  const original = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('fake-ingest.example.com')) {
      const body = typeof init?.body === 'string' ? init.body : '';
      bodies.push(body);
      return Promise.resolve(
        new Response('{"id":"00000000000000000000000000000000"}', { status: 200 }),
      );
    }
    return Promise.resolve(new Response('', { status: 200 }));
  };
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    bodies: () => bodies,
  };
}

describe('queue() via the real index.ts default export — Sentry client binding (FOLLOW-513)', () => {
  it('is present as a function on the real default export (queue is not lost/undefined)', () => {
    expect(typeof worker.queue).toBe('function');
  });

  it('delivers a real captured event to the Sentry transport when the queue handler runs through the real default-export wiring', async () => {
    const stub = stubFetchCapturingSentryEnvelopes();
    const { ctx, drain } = mockExecutionCtx();
    try {
      const env = makeEnv();
      const batch = { queue: 'estalara-events-retry', messages: [makeMalformedMessage()] };

      await worker.queue(batch as never, env, ctx as never);

      // `wrapQueueHandler` (inside @sentry/cloudflare) only sends the buffered envelope to the
      // transport when the client is flushed — that happens via `ctx.waitUntil(flushAndDispose(...))`
      // in its `finally` block, so we must drain `waitUntil` before asserting on the wire traffic.
      await drain();

      // A no-op/unbound Sentry client (the pre-fix behavior) would never produce a transport call
      // at all — this assertion can only pass if `Sentry.init` actually ran and bound a client
      // before `handleEventsRetryQueue`'s `Sentry.captureException` call.
      const bodies = stub.bodies();
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies.some((b) => b.includes('events_retry_message_malformed'))).toBe(true);
    } finally {
      stub.restore();
    }
  });
});
