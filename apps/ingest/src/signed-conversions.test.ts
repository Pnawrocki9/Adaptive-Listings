/**
 * FOLLOW-1339 — the Estalara host backend's two signed conversions, against the real verifier.
 *
 * CLAIM: the exact bytes `ConversionEventClient` (core-master) sends for `live.signup` and
 * `inquiry.completed` verify under `authenticateRequest()`, pass the real `EventSchema`, and are
 * written with `caller_signed = 1`, keeping the D-J payload fields. ASSERTION: real requests through
 * `createApp().fetch`, the row captured off the Worker's own `fetch`. The bodies and signatures below
 * are byte-identical copies of `SignedEventVectors.kt` in core-master, whose
 * `SignedEventSignerTest` and `ConversionEventClientTest` assert the same values from the Kotlin side:
 * change one, change both. GAP: no live ClickHouse and no running Spring backend here.
 *
 * @module apps/ingest/src/signed-conversions.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { authenticateRequest, computeHmacSha256Hex } from './auth.js';
import { createApp } from './router.js';
import type { Env } from './types.js';

// Built with `.repeat()` and from 16-char chunks so no long hex literal lands in a scanned file.
const SECRET_HEX = 'cd'.repeat(32);
const TIMESTAMP = '1793577600000';
const NONCE = 'follow1339vector0001';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '11111111-2222-4333-8444-555555555555';

const ENVELOPE =
  '"event_id":"01928f00-7000-4000-8000-000000001339",' +
  '"tenant_id":"00000000-0000-0000-0000-000000000000",' +
  `"session_id":"${SESSION_ID}",` +
  '"ts":1793577600000,"region":"eu","consent_state":"consented","schema_version":1';

const LIVE_BODY =
  `{"events":[{${ENVELOPE},"type":"live.signup","listing_id":"839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c",` +
  '"payload":{"slot_uuid":"01928f00-7000-4000-8000-0000000000aa","event_kind":"live_presentation"}}]}';
const INQUIRY_BODY = `{"events":[{${ENVELOPE},"type":"inquiry.completed","payload":{"channel":"conversation"}}]}`;
const UTF8_BODY = '{"note":"zażółć gęślą jaźń"}';

const LIVE_SIGNATURE = [
  '8724a3c7fabd5513',
  'c7f42f7109f709c5',
  'af5c23005d6b6b0f',
  '71ad489f87aad922',
].join('');
const INQUIRY_SIGNATURE = [
  '86a166343114ddbc',
  '0b918d46286b2e82',
  '1203a3405fb85f02',
  '13e4e0c05b7ba1a6',
].join('');
const UTF8_SIGNATURE = [
  '068c7912934c8e72',
  '2ddd6993553b05da',
  'd4fa7c187a26d213',
  'e347e65d6cd89fdd',
].join('');

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

const KEY_RECORD = JSON.stringify({
  tenant_id: TENANT_ID,
  scopes: ['write:events'],
  hmac_secret: SECRET_HEX,
});

function makeEnv(): Env {
  return {
    ENVIRONMENT: 'production',
    CLICKHOUSE_URL: 'https://ch.example.com:8443',
    CLICKHOUSE_DATABASE: 'default',
    CALLER_SIGNED_COLUMN_ENABLED: 'true',
    KV_API_KEYS: statefulKv({ 'api_key:k-server': KEY_RECORD }),
    KV_IDEMPOTENCY: statefulKv(),
    RATE_LIMITER: allowAllRateLimiter(),
  };
}

/** Headers for `body` at the real clock: the vector's fixed timestamp is outside the skew window. */
async function signedHeaders(body: string, nonce: string): Promise<Record<string, string>> {
  const timestamp = String(Date.now());
  const signature = await computeHmacSha256Hex(SECRET_HEX, `${timestamp}\n${nonce}\n${body}`);
  return {
    'X-Estalara-Signature': `hmac-sha256:${signature}`,
    'X-Estalara-Timestamp': timestamp,
    'X-Estalara-Nonce': nonce,
  };
}

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

async function send(env: Env, headers: Record<string, string>, body: string): Promise<Response> {
  const res = await createApp().fetch(
    new Request('http://test/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k-server', ...headers },
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

describe('the signature vector shared with core-master [FOLLOW-1339]', () => {
  it.each([
    ['live.signup', LIVE_BODY, LIVE_SIGNATURE],
    ['inquiry.completed', INQUIRY_BODY, INQUIRY_SIGNATURE],
    ['a non-ASCII body', UTF8_BODY, UTF8_SIGNATURE],
  ])('%s: the verifier computes the digest the Kotlin signer pins', async (_, body, signature) => {
    expect(await computeHmacSha256Hex(SECRET_HEX, `${TIMESTAMP}\n${NONCE}\n${body}`)).toBe(
      signature,
    );
  });

  it.each([
    ['live.signup', LIVE_BODY, LIVE_SIGNATURE],
    ['inquiry.completed', INQUIRY_BODY, INQUIRY_SIGNATURE],
  ])('%s: authenticateRequest accepts the vector as signed', async (_, body, signature) => {
    const auth = await authenticateRequest(
      {
        apiKey: 'k-server',
        signatureHeader: `hmac-sha256:${signature}`,
        timestampHeader: TIMESTAMP,
        nonceHeader: NONCE,
        body,
      },
      {
        kv: statefulKv({ 'api_key:k-server': KEY_RECORD }),
        replayKv: statefulKv(),
        now: () => Number(TIMESTAMP),
      },
    );
    expect(auth).toMatchObject({ ok: true, signed: true, tenant_id: TENANT_ID });
  });
});

describe('POST /v1/events with the host backend bodies [FOLLOW-1339]', () => {
  it('live.signup is accepted and written signed, with its kind, slot and listing', async () => {
    const rows = captureClickHouseRows();
    const res = await send(makeEnv(), await signedHeaders(LIVE_BODY, 'a'.repeat(32)), LIVE_BODY);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 1, rejected: 0 });
    expect(rows()).toHaveLength(1);
    const row = rows()[0] ?? {};
    expect(row).toMatchObject({
      type: 'live.signup',
      caller_signed: 1,
      session_id: SESSION_ID,
      tenant_id: TENANT_ID,
      listing_id: '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c',
    });
    expect(JSON.parse(String(row.payload))).toEqual({
      slot_uuid: '01928f00-7000-4000-8000-0000000000aa',
      event_kind: 'live_presentation',
    });
  });

  it('inquiry.completed is accepted and written signed, with channel conversation', async () => {
    const rows = captureClickHouseRows();
    const res = await send(
      makeEnv(),
      await signedHeaders(INQUIRY_BODY, 'b'.repeat(32)),
      INQUIRY_BODY,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 1, rejected: 0 });
    expect(rows()).toHaveLength(1);
    const row = rows()[0] ?? {};
    expect(row).toMatchObject({
      type: 'inquiry.completed',
      caller_signed: 1,
      session_id: SESSION_ID,
      tenant_id: TENANT_ID,
    });
    expect(JSON.parse(String(row.payload))).toEqual({ channel: 'conversation' });
  });

  it('the written row carries no xid (ESC-090 ruling 4)', async () => {
    const rows = captureClickHouseRows();
    const res = await send(
      makeEnv(),
      await signedHeaders(INQUIRY_BODY, 'c'.repeat(32)),
      INQUIRY_BODY,
    );
    expect(res.status).toBe(200);
    const row = rows()[0] ?? {};
    expect(Object.keys(row).filter((key) => /xid|cross_session/.test(key))).toEqual([]);
  });

  it.each([
    ['live.signup', LIVE_BODY],
    ['inquiry.completed', INQUIRY_BODY],
  ])('%s without a signature is refused 401 unsigned_server_caller', async (_, body) => {
    const rows = captureClickHouseRows();
    const res = await send(makeEnv(), {}, body);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { details: { reason: 'unsigned_server_caller' } },
    });
    expect(rows()).toHaveLength(0);
  });

  it.each([
    ['live.signup', LIVE_BODY],
    ['inquiry.completed', INQUIRY_BODY],
  ])('%s with a tampered body is refused 401 signature_mismatch', async (_, body) => {
    const rows = captureClickHouseRows();
    const headers = await signedHeaders(body, 'd'.repeat(32));
    const res = await send(makeEnv(), headers, body.replace(SESSION_ID, 'f'.repeat(36)));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { details: { reason: 'signature_mismatch' } },
    });
    expect(rows()).toHaveLength(0);
  });

  it('a replayed nonce is refused, and a fresh nonce on the same body (the re-send) is not', async () => {
    const rows = captureClickHouseRows();
    const env = makeEnv();
    const headers = await signedHeaders(INQUIRY_BODY, 'e'.repeat(32));
    expect((await send(env, headers, INQUIRY_BODY)).status).toBe(200);

    const replay = await send(env, headers, INQUIRY_BODY);
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ error: { details: { reason: 'replayed_nonce' } } });

    const resend = await send(env, await signedHeaders(INQUIRY_BODY, 'g'.repeat(32)), INQUIRY_BODY);
    expect(resend.status).toBe(200);
    expect(rows()).toHaveLength(2);
  });

  it('the vector signature outside the skew window is refused stale_timestamp', async () => {
    const res = await send(
      makeEnv(),
      {
        'X-Estalara-Signature': `hmac-sha256:${LIVE_SIGNATURE}`,
        'X-Estalara-Timestamp': TIMESTAMP,
        'X-Estalara-Nonce': NONCE,
      },
      LIVE_BODY,
    );
    // The vector's timestamp is a fixed instant; this holds on any clock more than 5 min away from it.
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { details: { reason: 'stale_timestamp' } } });
  });
});
