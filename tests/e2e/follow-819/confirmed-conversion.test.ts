// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason ac5-conversion-poll.test.ts pins this)

/**
 * FOLLOW-1203 — AC(5) grades a SERVER-CONFIRMED conversion (CEO decision #4 of 2026-09-13; ESC-084
 * rulings of 2026-10-13).
 *
 * THE VERDICT, STATED ONCE. AC(5) is GREEN only when this run's adapted session holds a signed
 * `inquiry.completed` / `live.signup` received at or after its first decision. A run whose only
 * conversion is browser-emitted (unsigned) is RED — `thisRunConversions=0` +
 * `thisRunConversionLoss=only_unsigned_conversion` — because that event is in no lift numerator.
 * The `cta.clicked` stays the hop before the conversion: `main()` asks the host backend to confirm
 * only after the click's row landed, so a missing click still reds the run with its own loss kind
 * (`ac5-conversion-poll.test.ts`, unchanged).
 *
 * THREE THINGS ARE PINNED HERE:
 *   1. the fixture host backend's signature is the one the REAL ingest `authenticateRequest()`
 *      accepts as `signed: true`, and its event passes the REAL `EventSchema` — so the emitter and
 *      the Worker cannot drift apart on the scheme;
 *   2. the emitter's HTTP behaviour: unconfigured is a 503 (never a silent 200), a 5xx is re-sent
 *      with a FRESH nonce and the same `event_id`, a 4xx is an answer and is not re-sent;
 *   3. the verdict's loss kinds, row by row.
 *
 * Collected by `tests/e2e/vitest.config.ts`; needs no substrate.
 *
 * @module tests/e2e/follow-819/confirmed-conversion.test
 */

import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { EventSchema } from '@estalara/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// Built with `.repeat()` so no long token literal lands in the diff (gitleaks).
const HMAC_SECRET_HEX = 'e7'.repeat(32);
const SERVER_KEY = 'test-server-key';
const TENANT_ID = '00000000-0000-0000-0000-0000000000e2';
const SID = 'c0ffee00-0000-4000-8000-00000000f1203';
const HARNESS = new URL('./differentiator-e2e.mjs', import.meta.url);

interface SignedRequest {
  headers: Record<string, string>;
  body: string;
  event: Record<string, unknown>;
}
interface Emitter {
  ingestUrl: string;
  apiKey: string;
  hmacSecretHex: string;
}
interface ThisRun {
  determinable: boolean;
  reason: string | null;
  treatmentArmDecisions: number;
  conversions: number;
  ctaClicks?: number;
  signedConversions?: number;
  unsignedConversions?: number;
}
interface Loss {
  lossKind: string;
  cause: string;
}

/** The slice of `apps/ingest/src/auth.ts` `authenticateRequest()`'s contract these cases read. */
interface IngestAuthResult {
  ok: boolean;
  signed?: boolean;
  tenant_id?: string;
  reason?: string;
}
let authenticateRequest: (
  input: {
    apiKey: string | undefined;
    signatureHeader: string | undefined;
    timestampHeader: string | undefined;
    nonceHeader: string | undefined;
    body: string;
  },
  deps: { kv: unknown; replayKv: unknown },
) => Promise<IngestAuthResult>;

let buildSignedConversionRequest: (args: {
  apiKey: string;
  hmacSecretHex: string;
  sessionId: string;
  type?: string;
  listingId?: string | null;
  now?: number;
  nonce?: string;
  eventId?: string;
}) => SignedRequest;
let readConversionEmitterEnv: (env: Record<string, string | undefined>) => Emitter | null;
let createFixtureListingDetailsServer: (options: {
  conversionEmitter?: Emitter | null;
  fetchImpl?: typeof fetch;
}) => Server;
let evaluateThisRunConversion: (
  thisRun: ThisRun,
  loss: Loss | null,
) => { converted: boolean; unmet: string[] };
let classifyConfirmedConversionLoss: (args: {
  request: Record<string, unknown>;
  thisRun: Partial<ThisRun>;
}) => Loss;
let evaluateConversionEmitterProbe: (probe: {
  status: number | null;
  body: unknown;
  networkError: string | null;
}) => { ok: boolean; reason: string };
let readRollupConversionCounts: (body: unknown) => Record<string, unknown>;

beforeAll(async () => {
  // The REAL ingest authenticator, loaded like the harness below (typed here, not imported, so
  // this file does not pull the Worker's ambient types into the e2e package).
  const ingestAuth = (await import('../../../apps/ingest/src/auth')) as Record<string, unknown>;
  authenticateRequest = ingestAuth.authenticateRequest as typeof authenticateRequest;

  const server =
    (await import('../../../scripts/dev/fixture-listing-details-server.mjs')) as Record<
      string,
      unknown
    >;
  buildSignedConversionRequest =
    server.buildSignedConversionRequest as typeof buildSignedConversionRequest;
  readConversionEmitterEnv = server.readConversionEmitterEnv as typeof readConversionEmitterEnv;
  createFixtureListingDetailsServer =
    server.createFixtureListingDetailsServer as typeof createFixtureListingDetailsServer;

  // The harness runs main() at import unless told not to — see the guard at its foot.
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const harness = (await import('./differentiator-e2e.mjs')) as Record<string, unknown>;
  evaluateThisRunConversion = harness.evaluateThisRunConversion as typeof evaluateThisRunConversion;
  classifyConfirmedConversionLoss =
    harness.classifyConfirmedConversionLoss as typeof classifyConfirmedConversionLoss;
  evaluateConversionEmitterProbe =
    harness.evaluateConversionEmitterProbe as typeof evaluateConversionEmitterProbe;
  readRollupConversionCounts =
    harness.readRollupConversionCounts as typeof readRollupConversionCounts;
});

// ─── 1. the signature is the one ingest accepts ───────────────────────────────────────────

/** Stateful KV stand-in holding the server key's record, and the nonce store. */
function kv(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    put: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

/** The two KV stores `authenticateRequest()` reads. Only get/put are stood in. */
function ingestDeps(): { kv: ReturnType<typeof kv>; replayKv: ReturnType<typeof kv> } {
  return {
    kv: kv({
      [`api_key:${SERVER_KEY}`]: JSON.stringify({
        tenant_id: TENANT_ID,
        scopes: ['write:events'],
        hmac_secret: HMAC_SECRET_HEX,
      }),
    }),
    replayKv: kv(),
  };
}

function authInput(req: SignedRequest, body = req.body) {
  return {
    apiKey: req.headers['X-Estalara-API-Key'],
    signatureHeader: req.headers['X-Estalara-Signature'],
    timestampHeader: req.headers['X-Estalara-Timestamp'],
    nonceHeader: req.headers['X-Estalara-Nonce'],
    body,
  };
}

/** The REAL ingest authenticator over the stand-in stores. */
function authenticate(
  req: SignedRequest,
  deps = ingestDeps(),
  body = req.body,
): Promise<IngestAuthResult> {
  return authenticateRequest(authInput(req, body), deps);
}

describe('FOLLOW-1203: the fixture host backend signs what the real ingest verifies', () => {
  it('authenticateRequest() accepts the request as signed: true, for the server key`s tenant', async () => {
    const req = buildSignedConversionRequest({
      apiKey: SERVER_KEY,
      hmacSecretHex: HMAC_SECRET_HEX,
      sessionId: SID,
    });
    const auth = await authenticate(req);
    expect(auth).toMatchObject({ ok: true, signed: true, tenant_id: TENANT_ID });
    // A server caller: no Origin header is built, so ingest takes the signed path, not the CORS one.
    expect(Object.keys(req.headers).map((h) => h.toLowerCase())).not.toContain('origin');
  });

  it('a body changed after signing is refused, and so is the same request sent twice', async () => {
    const req = buildSignedConversionRequest({
      apiKey: SERVER_KEY,
      hmacSecretHex: HMAC_SECRET_HEX,
      sessionId: SID,
    });
    const tampered = req.body.replace(SID, SID.replace('c0ffee', 'badbad'));
    expect(await authenticate(req, ingestDeps(), tampered)).toMatchObject({
      ok: false,
      reason: 'signature_mismatch',
    });

    const deps = ingestDeps();
    expect(await authenticate(req, deps)).toMatchObject({ ok: true });
    expect(await authenticate(req, deps)).toMatchObject({
      ok: false,
      reason: 'replayed_nonce',
    });
  });

  it.each(['inquiry.completed', 'live.signup'])(
    'the %s event it builds passes the real EventSchema',
    (type) => {
      const req = buildSignedConversionRequest({
        apiKey: SERVER_KEY,
        hmacSecretHex: HMAC_SECRET_HEX,
        sessionId: SID,
        type,
        listingId: '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c',
      });
      const parsed = EventSchema.safeParse(req.event);
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.flatten())).toBe(
        true,
      );
      expect(JSON.parse(req.body)).toEqual({ events: [req.event] });
    },
  );

  it('refuses to build anything that is not one of the two conversion events', () => {
    for (const type of ['cta.clicked', 'chat.contact_initiated']) {
      expect(() =>
        buildSignedConversionRequest({
          apiKey: SERVER_KEY,
          hmacSecretHex: HMAC_SECRET_HEX,
          sessionId: SID,
          type,
        }),
      ).toThrow(/not a conversion event type/);
    }
  });

  it('is unconfigured unless both the key and a hex secret are present', () => {
    expect(readConversionEmitterEnv({})).toBeNull();
    expect(readConversionEmitterEnv({ FIXTURE_SERVER_API_KEY: SERVER_KEY })).toBeNull();
    expect(
      readConversionEmitterEnv({
        FIXTURE_SERVER_API_KEY: SERVER_KEY,
        FIXTURE_SERVER_HMAC_SECRET: 'not-hex',
      }),
    ).toBeNull();
    expect(
      readConversionEmitterEnv({
        FIXTURE_SERVER_API_KEY: SERVER_KEY,
        FIXTURE_SERVER_HMAC_SECRET: HMAC_SECRET_HEX,
        INGEST_URL: 'http://localhost:8787/',
      }),
    ).toEqual({
      ingestUrl: 'http://localhost:8787',
      apiKey: SERVER_KEY,
      hmacSecretHex: HMAC_SECRET_HEX,
    });
  });
});

// ─── 2. the emitter endpoint ──────────────────────────────────────────────────────────────

const EMITTER: Emitter = {
  ingestUrl: 'http://ingest.test',
  apiKey: SERVER_KEY,
  hmacSecretHex: HMAC_SECRET_HEX,
};

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A stand-in for ingest answering the given statuses in order. */
function ingestAnswering(statuses: (number | 'network')[]): {
  fetchImpl: typeof fetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  let i = 0;
  const fetchImpl = ((url: string, init: RequestInit) => {
    sent.push({
      url,
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? init.body : '',
    });
    const status = statuses[i++] ?? 500;
    if (status === 'network') return Promise.reject(new Error('fetch failed'));
    const payload =
      status === 200 ? { accepted: 1, rejected: 0 } : { error: { code: 'unauthorized' } };
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

let running: Server | null = null;

async function listen(options: Parameters<typeof createFixtureListingDetailsServer>[0]) {
  const server = createFixtureListingDetailsServer(options);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  running = server;
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/fixture/confirmed-conversion`;
}

afterEach(async () => {
  if (running) await new Promise((resolve) => running!.close(resolve));
  running = null;
});

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('FOLLOW-1203: POST /fixture/confirmed-conversion', () => {
  it('unconfigured → 503 conversion_emitter_unconfigured on GET and POST, and nothing is sent', async () => {
    const { fetchImpl, sent } = ingestAnswering([200]);
    const url = await listen({ conversionEmitter: null, fetchImpl });
    for (const res of [await fetch(url), await post(url, { session_id: SID })]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: 'conversion_emitter_unconfigured' });
    }
    expect(sent).toHaveLength(0);
  });

  it('GET says it is configured without echoing the key or the secret', async () => {
    const url = await listen({
      conversionEmitter: EMITTER,
      fetchImpl: ingestAnswering([]).fetchImpl,
    });
    const text = await (await fetch(url)).text();
    expect(JSON.parse(text)).toEqual({
      configured: true,
      ingestUrl: 'http://ingest.test',
      signed: true,
    });
    expect(text).not.toContain(HMAC_SECRET_HEX);
    expect(text).not.toContain(SERVER_KEY);
  });

  it('sends ONE signed inquiry.completed for the session to ingest, with no Origin', async () => {
    const { fetchImpl, sent } = ingestAnswering([200]);
    const url = await listen({ conversionEmitter: EMITTER, fetchImpl });
    const res = await post(url, { session_id: SID });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, signed: true, session_id: SID });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('http://ingest.test/v1/events');
    expect(sent[0]!.headers['X-Estalara-API-Key']).toBe(SERVER_KEY);
    expect(sent[0]!.headers['X-Estalara-Signature']).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(Object.keys(sent[0]!.headers).map((h) => h.toLowerCase())).not.toContain('origin');
    const events = (JSON.parse(sent[0]!.body) as { events: Record<string, unknown>[] }).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'inquiry.completed', session_id: SID });
    // And that exact request is one the real ingest accepts as signed.
    const auth = await authenticate({
      headers: sent[0]!.headers,
      body: sent[0]!.body,
      event: {},
    });
    expect(auth).toMatchObject({ ok: true, signed: true });
  });

  it('a 503 (README §6.10) and a network failure are re-sent: same event, fresh nonce', async () => {
    const { fetchImpl, sent } = ingestAnswering([503, 'network', 200]);
    const url = await listen({ conversionEmitter: EMITTER, fetchImpl });
    const res = await post(url, { session_id: SID });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sends: { status: number | null }[] };
    expect(body.sends.map((s) => s.status)).toEqual([503, null, 200]);

    const ids = sent.map(
      (s) => (JSON.parse(s.body) as { events: { event_id: string }[] }).events[0]!.event_id,
    );
    expect(new Set(ids).size).toBe(1);
    expect(new Set(sent.map((s) => s.headers['X-Estalara-Nonce'])).size).toBe(3);
  }, 15_000);

  it('a 401 from ingest is an answer: 502 ingest_refused, not re-sent', async () => {
    const { fetchImpl, sent } = ingestAnswering([401, 200]);
    const url = await listen({ conversionEmitter: EMITTER, fetchImpl });
    const res = await post(url, { session_id: SID });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: 'ingest_refused',
      ingestStatus: 401,
    });
    expect(sent).toHaveLength(1);
  });

  it('refuses a malformed session id or a non-conversion type before signing anything', async () => {
    const { fetchImpl, sent } = ingestAnswering([200]);
    const url = await listen({ conversionEmitter: EMITTER, fetchImpl });
    expect((await post(url, { session_id: 'short' })).status).toBe(400);
    expect((await post(url, { session_id: SID, type: 'cta.clicked' })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

// ─── 3. the verdict ───────────────────────────────────────────────────────────────────────

describe('FOLLOW-1203: AC(5) — what this run`s conversion must be', () => {
  const clicked: ThisRun = {
    determinable: true,
    reason: null,
    treatmentArmDecisions: 2,
    conversions: 0,
    ctaClicks: 1,
    signedConversions: 0,
    unsignedConversions: 0,
  };
  const requestedOk = {
    requested: true,
    mode: 'signed_by_fixture_host_backend',
    ok: true,
    status: 200,
  };

  it('GREEN: a signed conversion received after the first decision', () => {
    const thisRun = { ...clicked, conversions: 1, signedConversions: 1 };
    expect(evaluateThisRunConversion(thisRun, null)).toEqual({ converted: true, unmet: [] });
  });

  it('RED: a browser-only (unsigned) conversion is no conversion — only_unsigned_conversion', () => {
    const thisRun = { ...clicked, unsignedConversions: 1 };
    const loss = classifyConfirmedConversionLoss({
      request: { requested: true, mode: 'redfirst_unsigned_browser', ok: true, status: 200 },
      thisRun,
    });
    expect(loss.lossKind).toBe('only_unsigned_conversion');
    expect(evaluateThisRunConversion(thisRun, loss)).toEqual({
      converted: false,
      unmet: ['thisRunConversions=0', 'thisRunConversionLoss=only_unsigned_conversion'],
    });
  });

  it('RED: a click alone is no conversion either', () => {
    const loss = classifyConfirmedConversionLoss({
      request: { requested: false, skipped: 'no_session_id' },
      thisRun: clicked,
    });
    expect(loss.lossKind).toBe('confirmed_conversion_not_requested');
    expect(evaluateThisRunConversion(clicked, loss).converted).toBe(false);
  });

  it('RED: a signed conversion from BEFORE the first decision is pre-exposure', () => {
    const thisRun = { ...clicked, signedConversions: 1 };
    const loss = classifyConfirmedConversionLoss({ request: requestedOk, thisRun });
    expect(loss.lossKind).toBe('signed_conversion_before_first_decision');
    expect(evaluateThisRunConversion(thisRun, loss).unmet).toEqual([
      'thisRunConversions=0',
      'thisRunConversionLoss=signed_conversion_before_first_decision',
    ]);
  });

  it('RED: the emitter failed, or it succeeded and the row never landed', () => {
    expect(
      classifyConfirmedConversionLoss({
        request: { requested: true, ok: false, status: 502, error: 'ingest_refused' },
        thisRun: clicked,
      }).lossKind,
    ).toBe('conversion_emitter_failed');
    expect(
      classifyConfirmedConversionLoss({ request: requestedOk, thisRun: clicked }).lossKind,
    ).toBe('signed_conversion_row_never_landed');
  });

  it('a held-out or undecided session is not a conversion however many signed rows it has', () => {
    expect(
      evaluateThisRunConversion({ ...clicked, treatmentArmDecisions: 0, conversions: 1 }, null),
    ).toEqual({ converted: false, unmet: ['thisRunTreatmentArmDecisions=0'] });
  });
});

describe('FOLLOW-1203: the preflight probe and the rollup`s own counts', () => {
  it('accepts only a configured, signing emitter', () => {
    const ok = { configured: true, signed: true, ingestUrl: 'http://localhost:8787' };
    expect(evaluateConversionEmitterProbe({ status: 200, body: ok, networkError: null }).ok).toBe(
      true,
    );
    for (const probe of [
      { status: 503, body: { error: 'conversion_emitter_unconfigured' }, networkError: null },
      // The pre-FOLLOW-1203 server (and the real Spring backend) answer this path 404.
      { status: 404, body: { error: 'not_served' }, networkError: null },
      { status: 200, body: { configured: true }, networkError: null },
      { status: null, body: null, networkError: 'TypeError: fetch failed' },
    ]) {
      expect(evaluateConversionEmitterProbe(probe).ok).toBe(false);
    }
  });

  it('reads the lift inputs off rollup.conversions, and says so when the plane has none', () => {
    expect(
      readRollupConversionCounts({
        rollup: {
          conversions: {
            adaptedN: 12,
            holdoutN: 9,
            adaptedConversions: 4,
            holdoutConversions: 9,
            preExposureConversions: 0,
            unsignedConversions: 1,
            ctaClickedSessions: 13,
          },
        },
      }),
    ).toEqual({
      adaptedN: 12,
      adaptedConversions: 4,
      holdoutN: 9,
      holdoutConversions: 9,
      preExposureConversions: 0,
      unsignedConversions: 1,
      ctaClickedSessions: 13,
    });
    expect(readRollupConversionCounts({ rollup: { ctaLift: 3 } })).toHaveProperty('error');
  });
});

describe('FOLLOW-1203: main() is wired to the confirmed conversion', () => {
  it('asks the host backend only after the click landed, and grades the signed source', async () => {
    const src = await readFile(HARNESS, 'utf8');
    const main = src.slice(src.indexOf('async function main()'));
    expect(main).toContain('await assertConversionEmitter()');
    expect(main).toContain('if (ac5Poll.landed === true && sessionId) {');
    expect(main).toContain('await requestConfirmedConversion(sessionId');
    expect(main).toContain("const signedSource = conversionSource === 'signed_events';");
    expect(main).toMatch(/adaptedArmConverted &&\s+!REDFIRST_UNSIGNED_CONVERSION/);
    // The holdout arm confirms its conversion through the same emitter.
    expect(src).toContain(
      'diag.confirmedConversion = await requestConfirmedConversion(holdoutSessionId',
    );
    // No harness SQL copy of the reader's join survives.
    expect(src).not.toContain('async function measureConversionCounts');
  });
});
