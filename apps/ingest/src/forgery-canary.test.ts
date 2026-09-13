/**
 * `forgery_canary` — the ingest half of FOLLOW-1201 AC(5) (audit SEC-1 / SEC-4, CEO decision #2).
 *
 * CLAIM (Rule AU): the deployed ingest Worker rejects every event a page visitor can forge with
 * only the page-visible API key from outside a browser, and rejects a captured signed request
 * when it is sent again. ASSERTION: real requests through `createApp().fetch` — the same Hono
 * app the Worker exports — with the real `authenticateRequest` and a stateful KV mock. GAP: the
 * KV mock is strongly consistent; production KV is eventually consistent, so a replay inside the
 * propagation window is NOT covered here (documented in `auth.ts`).
 *
 * Red-first (Rule AS §3): at the pre-fix commit case 1 returns 200 (the audit's own finding —
 * `index.test.ts` asserted that acceptance), case 2's FIRST send is refused with
 * `signature_mismatch` because the pre-fix HMAC covers the body only, and case 3 is accepted
 * because nothing reads a timestamp. The two positive controls pass before AND after, so a
 * Worker that simply refused everything could not turn this file green (Rule Q amendment 1 §5).
 *
 * Every case asserts the machine-readable `details.reason`, never just the status: a 401 for the
 * WRONG reason (e.g. `unknown_key` from a broken fixture) must not read as tamper-evidence.
 *
 * @module apps/ingest/src/forgery-canary.test
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { createApp } from './router.js';
import type { Env } from './types.js';

// Hex secret built with `.repeat()` so no 40+ char token literal lands in the diff (gitleaks).
const HMAC_SECRET_HEX = 'ab'.repeat(32);
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const SIGNED_KEY_RECORD = JSON.stringify({
  tenant_id: TENANT_ID,
  scopes: ['write:events'],
  hmac_secret: HMAC_SECRET_HEX,
});

/** Stateful KV mock — `put` is remembered so the nonce store can detect a second sighting. */
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

function makeEnv(): Env {
  return {
    ENVIRONMENT: 'production',
    CLICKHOUSE_URL: '', // no-cred guard → no sink call; the canary is about the auth boundary.
    CLICKHOUSE_DATABASE: 'default',
    KV_API_KEYS: statefulKv({ 'api_key:k-signed': SIGNED_KEY_RECORD }),
    KV_IDEMPOTENCY: statefulKv(),
    RATE_LIMITER: allowAllRateLimiter(),
  };
}

const conversionEvent = {
  event_id: '01928f00-7000-7000-8000-123456789abc',
  tenant_id: '00000000-0000-0000-0000-000000000000',
  session_id: 'f'.repeat(40),
  ts: Date.now(),
  region: 'eu' as const,
  consent_state: 'consented' as const,
  schema_version: 1 as const,
  type: 'cta.clicked',
  payload: { cta_id: 'book-viewing', cta_label: 'Book a Viewing' },
};

/**
 * Signs exactly what a legitimate server-side producer signs: the timestamp, the nonce and the
 * raw body, newline-joined, HMAC-SHA-256 keyed on the tenant's `hmac_secret` (hex-decoded).
 * Re-implemented here rather than imported so the CONTRACT is pinned, not the implementation.
 */
async function signServerRequest(
  timestampMs: number,
  nonce: string,
  body: string,
): Promise<Record<string, string>> {
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
  const message = `${String(timestampMs)}\n${nonce}\n${body}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)),
  );
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
  return {
    'X-Estalara-Signature': `hmac-sha256:${hex}`,
    'X-Estalara-Timestamp': String(timestampMs),
    'X-Estalara-Nonce': nonce,
  };
}

interface ErrorEnvelope {
  error: { code: string; details?: { reason?: string } };
}

/** Same single-cast helper `index.test.ts` uses — the lint autofix strips an inline `as`. */
async function readJson<T>(res: Response): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- assert caller's expected shape
  return (await res.json()) as T;
}

function post(env: Env, headers: Record<string, string>, body: string): Promise<Response> {
  return createApp().fetch(
    new Request('http://test/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k-signed', ...headers },
      body,
    }),
    env,
  );
}

describe('forgery_canary — ingest boundary [FOLLOW-1201 AC(5)]', () => {
  const body = JSON.stringify({ events: [conversionEvent] });

  it('case 1: a forged conversion event with no browser Origin and no signature is REJECTED', async () => {
    // This is the curl any page visitor can run with the page-visible key. Pre-fix: 200.
    const res = await post(makeEnv(), {}, body);
    expect(res.status).toBe(401);
    const json = await readJson<ErrorEnvelope>(res);
    expect(json.error.code).toBe('unauthorized');
    expect(json.error.details?.reason).toBe('unsigned_server_caller');
  });

  it('case 2: a captured signed request sent a second time is REJECTED as a replay', async () => {
    const env = makeEnv();
    const headers = await signServerRequest(Date.now(), 'n'.repeat(24), body);

    // Positive control INSIDE the case: the first sighting is a legitimate server producer.
    // Pre-fix this send is refused with `signature_mismatch` (body-only HMAC) — which is what
    // makes the case red-first rather than vacuous.
    const first = await post(env, headers, body);
    expect(first.status, await first.clone().text()).toBe(200);

    const replay = await post(env, headers, body);
    expect(replay.status).toBe(401);
    const json = await readJson<ErrorEnvelope>(replay);
    expect(json.error.details?.reason).toBe('replayed_nonce');
  });

  it('case 3: a signed request whose timestamp is outside the skew window is REJECTED', async () => {
    const tenMinutesAgo = Date.now() - 10 * 60_000;
    const headers = await signServerRequest(tenMinutesAgo, 'o'.repeat(24), body);
    const res = await post(makeEnv(), headers, body);
    expect(res.status).toBe(401);
    const json = await readJson<ErrorEnvelope>(res);
    expect(json.error.details?.reason).toBe('stale_timestamp');
  });

  it('positive control: browser-origin SDK traffic (Origin present, unsigned) still ingests', async () => {
    const res = await post(makeEnv(), { Origin: 'https://app.estalara.com' }, body);
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('positive control: a fresh signed server request with a NEW nonce ingests', async () => {
    const env = makeEnv();
    const a = await post(env, await signServerRequest(Date.now(), 'p'.repeat(24), body), body);
    const b = await post(env, await signServerRequest(Date.now(), 'q'.repeat(24), body), body);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});
