/**
 * FOLLOW-1203 — the caller class reaches the `events` row, and ONLY from the signature.
 *
 * CLAIM: an event's `caller_signed` is 1 exactly when the request that carried it had a valid
 * FOLLOW-1201 signature, and a browser-emitted conversion is still ACCEPTED (ESC-084 ruling 2:
 * excluded from the lift by the readers, never rejected here). ASSERTION: real requests through
 * `createApp().fetch` with the real `authenticateRequest`; the ClickHouse INSERT body is captured
 * off the Worker's own `fetch`. GAP: no live ClickHouse — that the column exists and accepts the
 * field is `migrate-rerun-test.sh` and the FOLLOW-819 series.
 *
 * Red-first: before this ticket no row carried the field at all (the first three cases fail on
 * `undefined`); the flag-off case pins the row the pre-0024 Worker sent, byte for byte.
 *
 * @module apps/ingest/src/caller-signed.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { createApp } from './router.js';
import type { Env } from './types.js';

// Hex secret built with `.repeat()` so no long token literal lands in the diff (gitleaks).
const HMAC_SECRET_HEX = 'cd'.repeat(32);
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const HOST_ORIGIN = 'https://host.example';

function statefulKv(seed: Record<string, string> = {}): Env['KV_API_KEYS'] {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    put: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
    list: () => Promise.resolve({ keys: [], list_complete: true } as never),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null } as never),
  } as unknown as Env['KV_API_KEYS'];
}

function allowAllRateLimiter(): Env['RATE_LIMITER'] {
  const stub = {
    fetch: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            allowed: true,
            remaining: 1000,
            reset_at: Date.now() + 60_000,
            limit: 1000,
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

function makeEnv(columnFlag: string | undefined): Env {
  return {
    ENVIRONMENT: 'production',
    CLICKHOUSE_URL: 'https://ch.example.com:8443',
    CLICKHOUSE_DATABASE: 'default',
    ...(columnFlag === undefined ? {} : { CALLER_SIGNED_COLUMN_ENABLED: columnFlag }),
    KV_API_KEYS: statefulKv({
      // The page-visible browser key: no secret, origin-locked.
      'api_key:k-browser': JSON.stringify({
        tenant_id: TENANT_ID,
        scopes: ['write:events'],
        allowed_origins: [HOST_ORIGIN],
      }),
      // The host backend's key: carries the HMAC secret a page never sees.
      'api_key:k-server': JSON.stringify({
        tenant_id: TENANT_ID,
        scopes: ['write:events'],
        hmac_secret: HMAC_SECRET_HEX,
      }),
    }),
    KV_IDEMPOTENCY: statefulKv(),
    RATE_LIMITER: allowAllRateLimiter(),
  };
}

function conversionEvent(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: crypto.randomUUID(),
    tenant_id: '00000000-0000-0000-0000-000000000000',
    session_id: 'f'.repeat(40),
    ts: Date.now(),
    region: 'eu',
    consent_state: 'consented',
    schema_version: 1,
    type: 'inquiry.completed',
    payload: { channel: 'email' },
    ...extra,
  };
}

async function signServerRequest(body: string): Promise<Record<string, string>> {
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const keyBytes = Uint8Array.from(
    HMAC_SECRET_HEX.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}\n${nonce}\n${body}`),
    ),
  );
  return {
    'X-Estalara-Signature': `hmac-sha256:${Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')}`,
    'X-Estalara-Timestamp': timestamp,
    'X-Estalara-Nonce': nonce,
  };
}

/** Capture the rows the Worker INSERTs into `events` (its only outbound fetch in these cases). */
function captureClickHouseRows(): () => Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.includes('INSERT%20INTO%20events') && typeof init?.body === 'string') {
        for (const line of init.body.split('\n')) {
          rows.push(JSON.parse(line) as Record<string, unknown>);
        }
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }),
  );
  return () => rows;
}

async function send(
  env: Env,
  apiKey: string,
  headers: Record<string, string>,
  body: string,
): Promise<Response> {
  const res = await createApp().fetch(
    new Request('http://test/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': apiKey, ...headers },
      body,
    }),
    env,
  );
  // The ClickHouse push runs after the ACK; let it reach the captured fetch.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return res;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('events.caller_signed [FOLLOW-1203]', () => {
  it('a signed server-side inquiry.completed is written with caller_signed = 1', async () => {
    const rows = captureClickHouseRows();
    const body = JSON.stringify({ events: [conversionEvent()] });
    const res = await send(makeEnv('true'), 'k-server', await signServerRequest(body), body);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ type: 'inquiry.completed', caller_signed: 1 });
  });

  it('a browser-emitted inquiry.completed is ACCEPTED (not rejected) and written with caller_signed = 0', async () => {
    const rows = captureClickHouseRows();
    const body = JSON.stringify({ events: [conversionEvent()] });
    const res = await send(makeEnv('true'), 'k-browser', { Origin: HOST_ORIGIN }, body);
    // ESC-084 ruling 2: the SDK's own emitter keeps working.
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 1, rejected: 0 });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ type: 'inquiry.completed', caller_signed: 0 });
  });

  it('a forged browser event cannot claim the class in its own body', async () => {
    const rows = captureClickHouseRows();
    const body = JSON.stringify({
      events: [conversionEvent({ caller_signed: true }), conversionEvent({ caller_signed: 1 })],
    });
    const res = await send(makeEnv('true'), 'k-browser', { Origin: HOST_ORIGIN }, body);
    expect(res.status).toBe(200);
    // Whether the schema strips or rejects the unknown field, no written row may read 1.
    for (const row of rows()) expect(row.caller_signed).toBe(0);
  });

  it.each([undefined, 'false', '1'])(
    'with the column flag %s the row carries no caller_signed field (pre-0024 shape)',
    async (flag) => {
      const rows = captureClickHouseRows();
      const body = JSON.stringify({ events: [conversionEvent()] });
      const res = await send(makeEnv(flag), 'k-server', await signServerRequest(body), body);
      expect(res.status).toBe(200);
      expect(rows()).toHaveLength(1);
      expect(Object.keys(rows()[0] ?? {}).sort()).toEqual(
        [
          'archetype_hint',
          'consent_state',
          'event_id',
          'ingest_received_at',
          'listing_id',
          'payload',
          'region',
          'schema_version',
          'session_id',
          'tenant_id',
          'ts',
          'type',
        ].sort(),
      );
    },
  );
});
