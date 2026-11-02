/**
 * @vitest-environment node
 *
 * `POST /api/adapt` — stage: RETURNING BUYER PROFILE (FOLLOW-1316, design review R5-R23, R36, R39-R44,
 * NC-1, NC-2, NC-5, NC-6, NC-8, NC-10, NC-12, NC-13, NC-14).
 *
 * Every assertion goes through the real route handler and the real store module; only the LLM
 * gateway, the Postgres-backed helpers and Redis's transport are replaced. Set
 * `BUYER_PROFILE_TEST_REDIS_URL` to run the same file against the localhost adapter and a real Redis.
 *
 * Every negative control is paired: the same xid is first restored, positively, in the same test, so
 * an empty store cannot pass it. `expectRestored` is that half.
 */
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assignHoldout } from '@estalara/shared';
import { createRedisTestDouble, type RedisTestDouble } from '@/lib/__tests__/redis-test-double';

const {
  mockCallLlmGateway,
  mockResolveAlEnablement,
  mockGetDemoOverride,
  mockCaptureException,
  mockCaptureMessage,
} = vi.hoisted(() => ({
  mockCallLlmGateway: vi.fn(),
  mockResolveAlEnablement: vi.fn(),
  mockGetDemoOverride: vi.fn(),
  mockCaptureException: vi.fn(),
  mockCaptureMessage: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: mockCaptureMessage,
}));
vi.mock('@/lib/llm-gateway', () => ({ callLlmGateway: mockCallLlmGateway }));
vi.mock('@/lib/al-enablement', () => ({ resolveAlEnablement: mockResolveAlEnablement }));
vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/tenant-schema', () => ({ getTenantSchema: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/demo-override-store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDemoOverride: mockGetDemoOverride,
}));

import { POST } from './route';

const TENANT = '00000000-0000-4000-8000-0000000000aa';
const OPS_KEY = 'buyer-profile-ops-key';
const DAY_MS = 24 * 60 * 60 * 1000;
const CH_URL = 'http://clickhouse.test';

let redis: RedisTestDouble;
let clickhouseCalls: { url: string; body: string }[];
const realFetch = globalThis.fetch;
const touchedKeys: string[] = [];

/** The store key the review's R17 prescribes, computed independently of the store module. */
function profileKey(xid: string): string {
  const key = `buyer_profile:${TENANT}:${createHash('sha256').update(xid).digest('hex')}`;
  touchedKeys.push(key);
  return key;
}

/** A session id of the route's accepted shape; each call is a new tab. */
function newSession(): string {
  return randomUUID().replaceAll('-', '');
}

function newXid(): string {
  const xid = randomUUID();
  profileKey(xid);
  return xid;
}

interface AdaptCall {
  xid?: unknown;
  xid_created_at?: unknown;
  consent_state?: unknown;
  archetype_hint?: string;
  confidence?: number;
  similarity?: number;
  archetype_source?: unknown;
  traits?: string[];
  session_id?: string;
  holdout_pct?: number;
  optOut?: boolean;
}

interface AdaptWire {
  archetype: string;
  confidence: number;
  source: string;
  directives: unknown[];
  holdout_group?: boolean;
  profile_restore?: string;
}

async function adapt(call: AdaptCall): Promise<AdaptWire> {
  const { optOut, session_id, holdout_pct, ...body } = call;
  const url = `http://localhost/api/adapt${optOut ? '?profiling_opt_out=1' : ''}`;
  const res = await POST(
    new NextRequest(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${OPS_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT,
        session_id: session_id ?? newSession(),
        page_type: 'listing_list',
        holdout_pct: holdout_pct ?? 0,
        ...body,
      }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as AdaptWire;
}

/** A consented first visit that resolves a quiz archetype, and the wait for its write. */
async function seedByQuiz(
  xid: string,
  overrides: Partial<AdaptCall> = {},
  createdAt = Date.now() - DAY_MS,
): Promise<void> {
  await adapt({
    xid,
    xid_created_at: createdAt,
    consent_state: 'consented',
    archetype_hint: 'yield_hunter',
    confidence: 0.86,
    similarity: 0.8,
    archetype_source: 'quiz',
    ...overrides,
  });
  await expectKeyWritten(xid);
}

async function expectKeyWritten(xid: string): Promise<void> {
  await vi.waitFor(
    async () => {
      expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(1);
    },
    { timeout: 10_000 },
  );
}

/** Let the after-response write, if any, finish; then look. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function expectRestored(
  xid: string,
  createdAt: number,
  archetype = 'yield_hunter',
): Promise<void> {
  const out = await adapt({ xid, xid_created_at: createdAt, consent_state: 'consented' });
  expect(out.archetype).toBe(archetype);
  expect(out.profile_restore).toBe('restored');
  expect(out.directives.length).toBeGreaterThan(0);
}

function commandsTouching(xid: string): string[] {
  const key = profileKey(xid);
  return redis.requests
    .filter((r) => r.body.includes(key) || r.url.includes(key))
    .map((r) => r.url);
}

function expectNeutral(out: AdaptWire): void {
  expect(out.archetype).toBe('neutral');
  expect(out.directives).toEqual([]);
  expect(out.profile_restore).toBeUndefined();
}

beforeEach(() => {
  redis = createRedisTestDouble(realFetch);
  clickhouseCalls = [];
  mockCallLlmGateway.mockReset();
  mockCallLlmGateway.mockImplementation((req: { archetypeId: string; confidence: number }) =>
    Promise.resolve({
      directives: [
        {
          type: 'text',
          slot: 'cta',
          value: 'copy',
          archetype: req.archetypeId,
          confidence: req.confidence,
        },
      ],
    }),
  );
  mockResolveAlEnablement.mockReset();
  mockResolveAlEnablement.mockResolvedValue({ off: false, reason: null });
  mockGetDemoOverride.mockReset();
  mockGetDemoOverride.mockResolvedValue({ enabled: false });
  mockCaptureException.mockReset();
  mockCaptureMessage.mockReset();
  vi.stubEnv('BUYER_PROFILE_ENABLED', 'true');
  vi.stubEnv('UPSTASH_REDIS_URL', redis.url);
  vi.stubEnv(
    'UPSTASH_REDIS_TOKEN',
    process.env.BUYER_PROFILE_TEST_REDIS_TOKEN ?? 'local-dev-token',
  );
  vi.stubEnv('ADAPT_API_KEY', OPS_KEY);
  vi.stubEnv('OPS_TENANT_ID', TENANT);
  vi.stubEnv('CLICKHOUSE_URL', CH_URL);
  vi.stubEnv('DEMO_MODE', '1');
  vi.stubEnv('DEMO_MODE_JWT_SECRET', 'x'.repeat(40));
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.startsWith(redis.url)) return redis.handle(url, init);
    if (url.startsWith(CH_URL)) {
      clickhouseCalls.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
      return Promise.resolve(new Response('', { status: 200 }));
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await redis.cleanup([...touchedKeys]);
  touchedKeys.length = 0;
});

describe('send and restore (the ticket AC)', () => {
  it('a second session with the same consented xid is served its profile, adapted, on its first call', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;

    await seedByQuiz(xid, {}, createdAt);
    const second = await adapt({ xid, xid_created_at: createdAt, consent_state: 'consented' });

    expect(second.archetype).toBe('yield_hunter');
    expect(second.confidence).toBe(0.86);
    expect(second.profile_restore).toBe('restored');
    expect(second.directives.length).toBeGreaterThan(0);
    expect(second.source).toMatch(/^llm_/);
    const lastCall = mockCallLlmGateway.mock.lastCall?.[0] as { archetypeId: string };
    expect(lastCall.archetypeId).toBe('yield_hunter');
  });

  it('a session with no xid gets neutral while the same store holds a profile', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);

    expectNeutral(await adapt({ consent_state: 'consented' }));
  });

  it('this session’s own qualifying signal wins and nothing is read', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    redis.requests.length = 0;

    const out = await adapt({
      xid,
      xid_created_at: createdAt,
      consent_state: 'consented',
      archetype_hint: 'family_buyer',
      confidence: 0.9,
    });

    expect(out.archetype).toBe('family_buyer');
    expect(out.profile_restore).toBeUndefined();
    await settle();
    // No archetype_source on that call: nothing is written, and no read was needed.
    expect(commandsTouching(xid)).toEqual([]);
  });

  it('a restored request ignores a similarity computed for another label and restores the traits', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, { traits: ['premium', 'has_children'] }, createdAt);

    const out = await adapt({
      xid,
      xid_created_at: createdAt,
      consent_state: 'consented',
      archetype_hint: 'neutral',
      confidence: 0.2,
      similarity: 0.99,
    });

    expect(out.archetype).toBe('yield_hunter');
    expect(out.source).toMatch(/^llm_/);
    const lastCall = mockCallLlmGateway.mock.lastCall?.[0] as { traits?: string[] };
    expect(lastCall.traits).toEqual(['premium']);
  });
});

describe('R5 — only canonical `consented` and a strict v4 honour the xid (NC-1, NC-2)', () => {
  it.each([
    ['absent', undefined],
    ['none', 'none'],
    ['session-only', 'session-only'],
    ['legitimate-interest', 'legitimate-interest'],
    ['granted', 'granted'],
    ['denied', 'denied'],
    ['unknown', 'unknown'],
  ])('consent_state %s: neutral, no store access', async (_label, consentState) => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
    redis.requests.length = 0;

    const out = await adapt({ xid, xid_created_at: createdAt, consent_state: consentState });

    expectNeutral(out);
    await settle();
    expect(commandsTouching(xid)).toEqual([]);
    expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(1);
    await expectRestored(xid, createdAt);
  });

  it('a non-consented session with a qualifying signal writes nothing', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await adapt({
      xid,
      xid_created_at: createdAt,
      consent_state: 'granted',
      archetype_hint: 'yield_hunter',
      confidence: 0.9,
      archetype_source: 'quiz',
    });
    await settle();
    expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(0);

    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['uuid v1', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'],
    ['upper case', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'],
    ['a number', 42],
    ['an array', ['x']],
    ['very long', 'a'.repeat(100_000)],
  ])('a malformed xid (%s) is ignored, never a 400', async (_label, badXid) => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
    redis.requests.length = 0;

    expectNeutral(
      await adapt({ xid: badXid, xid_created_at: createdAt, consent_state: 'consented' }),
    );
    expect(redis.requests.filter((r) => r.body.includes('buyer_profile'))).toEqual([]);
  });

  it.each([
    ['absent', undefined],
    ['a string', '2026-01-01'],
    ['negative', -5],
    ['a fraction', 1.5],
    ['zero', 0],
  ])('a malformed xid_created_at (%s) means the xid is ignored (R21)', async (_label, bad) => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
    redis.requests.length = 0;

    expectNeutral(await adapt({ xid, xid_created_at: bad, consent_state: 'consented' }));
    expect(commandsTouching(xid)).toEqual([]);
  });

  it('an xid older than its 90 days restores nothing, though the key still answers (R29)', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
    redis.requests.length = 0;

    expectNeutral(
      await adapt({ xid, xid_created_at: Date.now() - 91 * DAY_MS, consent_state: 'consented' }),
    );
    expect(commandsTouching(xid)).toEqual([]);
  });
});

describe('R8 — the server flag (NC-14)', () => {
  it.each([
    ['unset', ''],
    ['not exactly true', '1'],
  ])('flag %s: no read, no write, neutral, and the arm is keyed per session', async (_l, value) => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
    const before = await redis.raw(['GET', profileKey(xid)]);
    redis.requests.length = 0;
    clickhouseCalls.length = 0;

    vi.stubEnv('BUYER_PROFILE_ENABLED', value);
    expectNeutral(await adapt({ xid, xid_created_at: createdAt, consent_state: 'consented' }));
    await adapt({
      xid,
      xid_created_at: createdAt,
      consent_state: 'consented',
      archetype_hint: 'family_buyer',
      confidence: 0.9,
      archetype_source: 'quiz',
    });
    await settle();

    expect(commandsTouching(xid)).toEqual([]);
    expect(await redis.raw(['GET', profileKey(xid)])).toBe(before);
    const logged = clickhouseCalls.map(
      (c) => new URL(c.url).searchParams.get('param_p_features_snapshot') ?? '',
    );
    expect(logged.length).toBeGreaterThan(0);
    for (const row of logged) expect(row).toContain('"assignment_unit":"session"');

    vi.stubEnv('BUYER_PROFILE_ENABLED', 'true');
    await expectRestored(xid, createdAt);
  });
});

describe('R9-R14 — what is written', () => {
  it('stores exactly the five fields, with two-decimal confidence and the allow-listed traits', async () => {
    const xid = newXid();
    await seedByQuiz(xid, {
      archetype_hint: 'family_buyer',
      confidence: 0.86666,
      traits: ['has_children', 'premium', 'residency_goal', 'buying_from_abroad', 'will_let'],
    });

    const raw = JSON.parse(String(await redis.raw(['GET', profileKey(xid)]))) as unknown;
    expect(raw).toEqual({
      v: 1,
      archetype: 'family_buyer',
      confidence: 0.87,
      source: 'quiz',
      traits: ['premium', 'will_let'],
    });
  });

  it('a dropped trait still applies in the session that declared it (R12)', async () => {
    const xid = newXid();
    await seedByQuiz(xid, { traits: ['has_children'], archetype_hint: 'family_buyer' });

    const inSession = mockCallLlmGateway.mock.lastCall?.[0] as { traits?: string[] };
    expect(inSession.traits).toEqual(['has_children']);
    const raw = JSON.parse(String(await redis.raw(['GET', profileKey(xid)]))) as {
      traits?: string[];
    };
    expect(raw.traits ?? []).toEqual([]);
  });

  it.each(['neutral', 'diaspora_buyer', 'golden_visa_buyer'])(
    'non-persistable archetype %s writes nothing and is still served in session (R11)',
    async (archetype) => {
      const xid = newXid();
      const createdAt = Date.now() - DAY_MS;
      const out = await adapt({
        xid,
        xid_created_at: createdAt,
        consent_state: 'consented',
        archetype_hint: archetype,
        confidence: 0.9,
        archetype_source: 'quiz',
      });
      await settle();

      expect(out.archetype).toBe(archetype);
      expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(0);
    },
  );

  it('source is required: absent, unknown or chat-moved writes nothing, and the last write stands (R13, NC-13)', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    const before = await redis.raw(['GET', profileKey(xid)]);

    for (const source of [undefined, 'chat', 'nonsense', 7]) {
      await adapt({
        xid,
        xid_created_at: createdAt,
        consent_state: 'consented',
        archetype_hint: 'family_buyer',
        confidence: 0.9,
        ...(source !== undefined ? { archetype_source: source } : {}),
      });
    }
    await settle();

    expect(await redis.raw(['GET', profileKey(xid)])).toBe(before);
    await expectRestored(xid, createdAt);
  });

  it('a behaviour label in a session the server knows has chat dimensions writes nothing (R13)', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    const chatSession = newSession();
    const shadow = `shadow:${TENANT}:${chatSession}:chat_intent`;
    touchedKeys.push(shadow);
    await redis.raw([
      'SET',
      shadow,
      JSON.stringify({
        intent_dimensions: { purchase_purpose: 'investment' },
        data_source: 'model',
        detected_at: '2026-11-01T00:00:00Z',
      }),
      'EX',
      '60',
    ]);

    await adapt({
      xid,
      xid_created_at: createdAt,
      session_id: chatSession,
      consent_state: 'consented',
      archetype_hint: 'yield_hunter',
      confidence: 0.9,
      archetype_source: 'behavior',
    });
    await settle();
    expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(0);

    await seedByQuiz(xid, { archetype_source: 'behavior' }, createdAt);
    await expectRestored(xid, createdAt);
  });

  it('R14: each write precondition, paired with a write on the same xid', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    const write: AdaptCall = {
      xid,
      xid_created_at: createdAt,
      consent_state: 'consented',
      archetype_hint: 'yield_hunter',
      confidence: 0.86,
      archetype_source: 'quiz',
    };
    const expectNoKey = async (): Promise<void> => {
      await settle();
      expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(0);
    };

    // Opted out.
    await adapt({ ...write, optOut: true });
    await expectNoKey();

    // AL off.
    mockResolveAlEnablement.mockResolvedValueOnce({ off: true, reason: 'al_disabled' });
    await adapt(write);
    await expectNoKey();

    // Demo override active: the operator's archetype must not become the buyer's.
    mockGetDemoOverride.mockResolvedValueOnce({
      enabled: true,
      overrideArchetype: 'luxury_buyer',
      overrideModel: 'claude-haiku-4-5',
    });
    const demoOut = await adapt(write);
    expect(demoOut.archetype).toBe('luxury_buyer');
    await expectNoKey();

    // Holdout arm.
    await adapt({ ...write, holdout_pct: 1 });
    await expectNoKey();

    // At the threshold, and rounding to the threshold, is not above it.
    await adapt({ ...write, confidence: 0.6 });
    await adapt({ ...write, confidence: 0.604 });
    await expectNoKey();

    // The same xid, with none of those: written.
    await adapt(write);
    await expectKeyWritten(xid);
    await expectRestored(xid, createdAt);
  });

  it('demo override on a returning buyer: override served, nothing read (NC-13)', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
    redis.requests.length = 0;

    mockGetDemoOverride.mockResolvedValueOnce({
      enabled: true,
      overrideArchetype: 'luxury_buyer',
      overrideModel: 'claude-haiku-4-5',
    });
    const out = await adapt({ xid, xid_created_at: createdAt, consent_state: 'consented' });

    expect(out.archetype).toBe('luxury_buyer');
    expect(out.profile_restore).toBeUndefined();
    await settle();
    expect(commandsTouching(xid)).toEqual([]);
  });
});

describe('source ranking and a result that may not persist', () => {
  const signal = (
    xid: string,
    createdAt: number,
    archetype: string,
    source: 'quiz' | 'behavior',
  ): Promise<AdaptWire> =>
    adapt({
      xid,
      xid_created_at: createdAt,
      consent_state: 'consented',
      archetype_hint: archetype,
      confidence: 0.9,
      archetype_source: source,
    });
  const storedArchetype = async (xid: string): Promise<string | null> => {
    const raw = await redis.raw(['GET', profileKey(xid)]);
    return raw === null ? null : (JSON.parse(raw as string) as { archetype: string }).archetype;
  };
  const waitForStored = async (xid: string, archetype: string | null): Promise<void> => {
    await vi.waitFor(
      async () => {
        expect(await storedArchetype(xid)).toBe(archetype);
      },
      { timeout: 10_000 },
    );
  };

  it.each(['diaspora_buyer', 'golden_visa_buyer'])(
    'a quiz result of %s deletes the stored label, so it is not restored, and a later result writes',
    async (archetype) => {
      const xid = newXid();
      const createdAt = Date.now() - DAY_MS;
      await seedByQuiz(xid, {}, createdAt);
      await expectRestored(xid, createdAt);

      const out = await signal(xid, createdAt, archetype, 'quiz');
      expect(out.archetype).toBe(archetype);
      await waitForStored(xid, null);

      const next = await adapt({ xid, xid_created_at: createdAt, consent_state: 'consented' });
      expect(next.archetype).toBe('neutral');
      expect(next.profile_restore).toBe('miss');

      // Nothing was withdrawn, so no tombstone: the next allowed result is stored.
      await signal(xid, createdAt, 'family_buyer', 'quiz');
      await waitForStored(xid, 'family_buyer');
      await expectRestored(xid, createdAt, 'family_buyer');
    },
  );

  it('a behaviour label that may not persist leaves the stored label alone', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);

    await signal(xid, createdAt, 'diaspora_buyer', 'behavior');
    await settle();

    expect(await storedArchetype(xid)).toBe('yield_hunter');
    await expectRestored(xid, createdAt);
  });

  it('behavior never overwrites a stored quiz; quiz overwrites anything; behavior overwrites behavior', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);

    await signal(xid, createdAt, 'family_buyer', 'behavior');
    await settle();
    await settle();
    expect(await storedArchetype(xid)).toBe('yield_hunter');
    await expectRestored(xid, createdAt);

    const other = newXid();
    await seedByQuiz(other, { archetype_source: 'behavior' }, createdAt);
    await signal(other, createdAt, 'family_buyer', 'behavior');
    await waitForStored(other, 'family_buyer');
    await signal(other, createdAt, 'luxury_buyer', 'quiz');
    await waitForStored(other, 'luxury_buyer');
    await signal(other, createdAt, 'upsizer', 'behavior');
    await settle();
    await settle();
    expect(await storedArchetype(other)).toBe('luxury_buyer');
    await expectRestored(other, createdAt, 'luxury_buyer');
  });
});

describe('NC-13 — a demo override of neutral does not fall through to the store', () => {
  it('serves the override, reads nothing, and the profile restores once the override ends', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
    redis.requests.length = 0;

    mockGetDemoOverride.mockResolvedValueOnce({
      enabled: true,
      overrideArchetype: 'neutral',
      overrideModel: 'claude-haiku-4-5',
    });
    const out = await adapt({ xid, xid_created_at: createdAt, consent_state: 'consented' });

    expect(out.archetype).toBe('neutral');
    expect(out.profile_restore).toBeUndefined();
    expect(commandsTouching(xid)).toEqual([]);
    await expectRestored(xid, createdAt);
  });
});

describe('R21 — absolute expiry', () => {
  /** Remaining life of the key, in ms. */
  const pttl = async (xid: string): Promise<number> =>
    Number(await redis.raw(['PTTL', profileKey(xid)]));

  it('a day-89 write gets about one day', async () => {
    const xid = newXid();
    await seedByQuiz(xid, {}, Date.now() - 89 * DAY_MS);
    const left = await pttl(xid);
    expect(left).toBeGreaterThan(0.9 * DAY_MS);
    expect(left).toBeLessThanOrEqual(DAY_MS + 1000);
  });

  it('a created_at within the 5-minute skew allowance is capped at 90 days from now', async () => {
    const xid = newXid();
    await seedByQuiz(xid, {}, Date.now() + 4 * 60 * 1000);
    const left = await pttl(xid);
    expect(left).toBeGreaterThan(89.9 * DAY_MS);
    expect(left).toBeLessThanOrEqual(90 * DAY_MS + 1000);
  });

  it.each([
    ['6 minutes ahead', 6 * 60 * 1000],
    ['400 days ahead', 400 * DAY_MS],
  ])('a created_at %s means the xid is not honoured', async (_label, ahead) => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
    const before = await redis.raw(['GET', profileKey(xid)]);
    redis.requests.length = 0;

    const forged = Date.now() + ahead;
    expectNeutral(await adapt({ xid, xid_created_at: forged, consent_state: 'consented' }));
    await adapt({
      xid,
      xid_created_at: forged,
      consent_state: 'consented',
      archetype_hint: 'family_buyer',
      confidence: 0.9,
      archetype_source: 'quiz',
    });
    await settle();

    expect(commandsTouching(xid)).toEqual([]);
    expect(await redis.raw(['GET', profileKey(xid)])).toBe(before);
    await expectRestored(xid, createdAt);
  });

  it('a restore, an opt-out and an overwrite never extend it; a re-quiz overwrites without history (R44)', async () => {
    const xid = newXid();
    const createdAt = Date.now() - 30 * DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    const first = await pttl(xid);

    await expectRestored(xid, createdAt);
    expect(await pttl(xid)).toBeLessThanOrEqual(first);

    await adapt({ xid, xid_created_at: createdAt, consent_state: 'consented', optOut: true });
    expect(await pttl(xid)).toBeLessThanOrEqual(first);

    // An overwrite claiming a newer xid must not move the expiry either.
    await adapt({
      xid,
      xid_created_at: Date.now(),
      consent_state: 'consented',
      archetype_hint: 'family_buyer',
      confidence: 0.91,
      archetype_source: 'quiz',
    });
    await vi.waitFor(async () => {
      const raw = JSON.parse(String(await redis.raw(['GET', profileKey(xid)]))) as {
        archetype: string;
      };
      expect(raw.archetype).toBe('family_buyer');
    });
    expect(await pttl(xid)).toBeLessThanOrEqual(first);
    await expectRestored(xid, createdAt, 'family_buyer');
  });

  it('after the key expires the same xid gets neutral and nothing resurrects it (NC-6)', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);

    await redis.raw(['DEL', profileKey(xid)]);
    const out = await adapt({ xid, xid_created_at: createdAt, consent_state: 'consented' });
    expect(out.archetype).toBe('neutral');
    expect(out.profile_restore).toBe('miss');
    await settle();
    expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(0);
  });
});

describe('R36 — opt-out suspends (NC-5)', () => {
  it('on: neutral, no store access, key kept, clock not raised; off: restored', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
    const ttl = Number(await redis.raw(['PTTL', profileKey(xid)]));
    redis.requests.length = 0;

    const out = await adapt({
      xid,
      xid_created_at: createdAt,
      consent_state: 'consented',
      optOut: true,
    });

    expectNeutral(out);
    await settle();
    expect(redis.requests).toEqual([]);
    expect(Number(await redis.raw(['PTTL', profileKey(xid)]))).toBeLessThanOrEqual(ttl);
    await expectRestored(xid, createdAt);
  });
});

describe('R23 — restore reads the profile store only', () => {
  it('an empty store restores nothing and reports a miss', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;

    const out = await adapt({ xid, xid_created_at: createdAt, consent_state: 'consented' });

    expect(out.archetype).toBe('neutral');
    expect(out.directives).toEqual([]);
    expect(out.profile_restore).toBe('miss');

    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
  });
});

describe('R39-R41 — the arm per xid', () => {
  it('two sessions with one xid share an arm; with no xid each session draws its own', async () => {
    vi.stubEnv('HOLDOUT_PCT', '0.5');
    const armsOf = async (make: () => AdaptCall): Promise<(boolean | undefined)[]> => {
      const out: (boolean | undefined)[] = [];
      for (let i = 0; i < 2; i++) {
        const call = make();
        const res = await POST(
          new NextRequest('http://localhost/api/adapt', {
            method: 'POST',
            // A public-key caller may not set the rate, so the ops key sends none here.
            headers: { authorization: `Bearer ${OPS_KEY}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              tenant_id: TENANT,
              session_id: newSession(),
              page_type: 'listing_list',
              ...call,
            }),
          }),
        );
        const body = (await res.json()) as AdaptWire;
        out.push(body.holdout_group === true);
      }
      return out;
    };

    const perXid: boolean[] = [];
    for (let i = 0; i < 24; i++) {
      const xid = newXid();
      const createdAt = Date.now() - DAY_MS;
      const [a, b] = await armsOf(() => ({
        xid,
        xid_created_at: createdAt,
        consent_state: 'consented',
      }));
      expect(a).toBe(b);
      perXid.push(a === true);
    }
    // Both arms occurred, or the equality above is vacuous.
    expect(new Set(perXid).size).toBe(2);

    let differed = false;
    for (let i = 0; i < 24 && !differed; i++) {
      const [a, b] = await armsOf(() => ({ consent_state: 'consented' }));
      differed = a !== b;
    }
    expect(differed).toBe(true);
  });

  it('the route’s arm is exactly assignHoldout over the xid', async () => {
    vi.stubEnv('HOLDOUT_PCT', '0.5');
    const secret = process.env.HOLDOUT_ASSIGNMENT_SECRET ?? '';
    const xid = newXid();
    const expected = await assignHoldout({
      tenant_id: TENANT,
      session_id: 'irrelevant',
      assignment_unit_id: xid,
      holdout_pct: 0.5,
      assignment_secret: secret,
    });
    if (expected.skipped) throw new Error('unreachable');

    const res = await POST(
      new NextRequest('http://localhost/api/adapt', {
        method: 'POST',
        headers: { authorization: `Bearer ${OPS_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant_id: TENANT,
          session_id: newSession(),
          page_type: 'listing_list',
          xid,
          xid_created_at: Date.now() - DAY_MS,
          consent_state: 'consented',
        }),
      }),
    );
    const body = (await res.json()) as AdaptWire;
    expect(body.holdout_group === true).toBe(expected.holdout_group);
  });

  it('a holdout xid gets no read and no write, and a treatment run on it restores (NC-10)', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
    const before = await redis.raw(['GET', profileKey(xid)]);
    redis.requests.length = 0;

    for (let i = 0; i < 2; i++) {
      const out = await adapt({
        xid,
        xid_created_at: createdAt,
        consent_state: 'consented',
        archetype_hint: 'family_buyer',
        confidence: 0.9,
        archetype_source: 'quiz',
        holdout_pct: 1,
      });
      expect(out.holdout_group).toBe(true);
      expect(out.archetype).toBe('neutral');
      expect(out.profile_restore).toBeUndefined();
    }
    await settle();

    expect(commandsTouching(xid)).toEqual([]);
    expect(await redis.raw(['GET', profileKey(xid)])).toBe(before);
    await expectRestored(xid, createdAt);
  });

  it('the decision row carries assignment_unit and profile_restored, never the xid', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    clickhouseCalls.length = 0;

    await expectRestored(xid, createdAt);
    await adapt({ consent_state: 'consented' });
    await adapt({ xid, xid_created_at: createdAt, consent_state: 'consented', holdout_pct: 1 });

    await vi.waitFor(() => {
      expect(clickhouseCalls).toHaveLength(3);
    });
    const snapshots = clickhouseCalls.map(
      (c) =>
        JSON.parse(new URL(c.url).searchParams.get('param_p_features_snapshot') ?? '{}') as Record<
          string,
          unknown
        >,
    );
    expect(snapshots[0]).toMatchObject({ assignment_unit: 'xid', profile_restored: true });
    expect(snapshots[1]).toMatchObject({ assignment_unit: 'session' });
    expect(snapshots[1]).not.toHaveProperty('profile_restored');
    expect(snapshots[2]).toMatchObject({
      assignment_unit: 'xid',
      holdout: true,
      profile_restored: false,
    });
    expect(JSON.stringify(clickhouseCalls)).not.toContain(xid);
  });
});

describe('R16, R18 — fails loud, and the xid reaches no sink (NC-8, NC-12)', () => {
  /** Everything a log, Sentry, the LLM or the wire could have been handed. */
  function expectXidInNoSink(xid: string, sinks: unknown[]): void {
    const seen = JSON.stringify([
      sinks,
      mockCaptureException.mock.calls.map((c) => [String(c[0]), c[1] as unknown]),
      mockCaptureMessage.mock.calls as unknown,
      mockCallLlmGateway.mock.calls as unknown,
      clickhouseCalls,
      redis.requests.map((r) => r.url),
    ]);
    expect(seen).not.toContain(xid);
    expect(redis.requests.map((r) => r.body).join()).not.toContain(xid);
  }

  it('a healthy full round trip leaves the xid nowhere', async () => {
    const logs: unknown[] = [];
    for (const m of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      });
    }
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);
    await settle();

    expectXidInNoSink(xid, logs);
    vi.restoreAllMocks();
  });

  it.each([
    [
      'HTTP 403',
      (r: RedisTestDouble) => {
        r.failHttp(403);
      },
    ],
    [
      'a command error',
      (r: RedisTestDouble) => {
        r.failCommand('GET');
      },
    ],
  ])(
    'a read failure (%s) means neutral with an explicit error, Sentry by code',
    async (_l, fail) => {
      if (redis.real) return;
      const logs: unknown[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        logs.push(args);
      });
      const xid = newXid();
      const createdAt = Date.now() - DAY_MS;
      await seedByQuiz(xid, {}, createdAt);
      await expectRestored(xid, createdAt);

      fail(redis);
      const out = await adapt({ xid, xid_created_at: createdAt, consent_state: 'consented' });

      expect(out.archetype).toBe('neutral');
      expect(out.directives).toEqual([]);
      expect(out.profile_restore).toBe('error');
      await vi.waitFor(() => {
        expect(mockCaptureException).toHaveBeenCalled();
      });
      const [error, context] = mockCaptureException.mock.lastCall as [
        Error,
        { tags: Record<string, string> },
      ];
      expect(error.message).toMatch(/^buyer_profile /);
      expect(error.cause).toBeUndefined();
      expect(context.tags.error_code).toBeDefined();
      expectXidInNoSink(xid, logs);
      vi.restoreAllMocks();
    },
  );

  it('Redis unconfigured with the flag on is an error on the wire, never a silent miss (NC-12)', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);

    vi.stubEnv('UPSTASH_REDIS_URL', '');
    const out = await adapt({ xid, xid_created_at: createdAt, consent_state: 'consented' });

    expect(out.archetype).toBe('neutral');
    expect(out.profile_restore).toBe('error');
    await vi.waitFor(() => {
      expect(mockCaptureException).toHaveBeenCalled();
    });
    const [, context] = mockCaptureException.mock.lastCall as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(context.tags.error_code).toBe('redis_unconfigured');
  });

  it('R17: the raw xid is in no key, URL or command', async () => {
    const xid = newXid();
    const createdAt = Date.now() - DAY_MS;
    await seedByQuiz(xid, {}, createdAt);
    await expectRestored(xid, createdAt);

    const profileRequests = redis.requests.filter((r) => r.body.includes('buyer_profile:'));
    expect(profileRequests.length).toBeGreaterThan(0);
    for (const request of profileRequests) {
      expect(request.method).toBe('POST');
      expect(new URL(request.url).pathname).toBe('/pipeline');
    }
    expect(JSON.stringify(redis.requests)).not.toContain(xid);
    expect(profileKey(xid)).toMatch(new RegExp(`^buyer_profile:${TENANT}:[0-9a-f]{64}$`));
  });
});
