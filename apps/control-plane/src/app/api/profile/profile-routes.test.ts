/**
 * @vitest-environment node
 *
 * `POST /api/profile/{erase,access,portability}` and the delete's guarantees (FOLLOW-1316, design
 * review R17-R18, R24-R30, R34, NC-3 server half, NC-11, NC-12).
 *
 * Route-driven: every test sends a signed request through the real handler and looks at the store.
 * Every negative is paired with a positive restore through the real `POST /api/adapt` on the same
 * xid, so an empty store cannot pass it. Set `BUYER_PROFILE_TEST_REDIS_URL` to run against the
 * localhost adapter and a real Redis; the failure-injection tests are fake-only.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRedisTestDouble, type RedisTestDouble } from '@/lib/__tests__/redis-test-double';

const { mockCaptureException, mockCallLlmGateway, keyRows, keyLookupThrows } = vi.hoisted(() => ({
  mockCaptureException: vi.fn(),
  mockCallLlmGateway: vi.fn(),
  keyRows: { current: [] as { tenantId: string }[] },
  keyLookupThrows: { current: false },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: vi.fn(),
}));
vi.mock('@/lib/llm-gateway', () => ({ callLlmGateway: mockCallLlmGateway }));
vi.mock('@/lib/al-enablement', () => ({
  resolveAlEnablement: vi.fn().mockResolvedValue({ off: false, reason: null }),
}));
vi.mock('@/lib/rag-retrieval', () => ({ retrieveListingContext: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/tenant-schema', () => ({ getTenantSchema: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/demo-override-store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDemoOverride: vi.fn().mockResolvedValue({ enabled: false }),
}));
vi.mock('@estalara/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAdminClient: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            keyLookupThrows.current
              ? Promise.reject(new Error('connection to db.internal failed'))
              : Promise.resolve(keyRows.current),
        }),
      }),
    }),
  }),
}));

import { POST as adaptPost } from '@/app/api/adapt/route';
import { POST as accessPost } from './access/route';
import { POST as erasePost } from './erase/route';
import { POST as portabilityPost } from './portability/route';

const TENANT = '00000000-0000-4000-8000-0000000000aa';
const SDK_KEY = 'pk_live_buyer_profile_test';
const OPS_KEY = 'buyer-profile-ops-key';
const DAY_MS = 24 * 60 * 60 * 1000;
const CH_URL = 'http://clickhouse.test';
const ORIGIN = 'http://localhost:3000';

type Handler = (req: NextRequest) => Promise<NextResponse>;

let redis: RedisTestDouble;
let clickhouseCalls: { url: string; body: string }[];
const realFetch = globalThis.fetch;
const touchedKeys: string[] = [];

function sha(xid: string): string {
  return createHash('sha256').update(xid).digest('hex');
}
function profileKey(xid: string): string {
  const key = `buyer_profile:${TENANT}:${sha(xid)}`;
  touchedKeys.push(key, `buyer_profile_tombstone:${TENANT}:${sha(xid)}`);
  return key;
}

function signedRequest(
  path: string,
  body: unknown,
  {
    key = SDK_KEY,
    signature,
    origin = ORIGIN,
  }: { key?: string; signature?: string; origin?: string } = {},
): NextRequest {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'x-estalara-signature': signature ?? createHmac('sha256', key).update(text).digest('hex'),
      'x-forwarded-for': `203.0.113.${String(Math.floor(Math.random() * 250))}`,
      ...(origin ? { origin } : {}),
    },
    body: text,
  });
}

const eraseCall = (xid: string): Promise<NextResponse> =>
  erasePost(signedRequest('/api/profile/erase', { tenant_id: TENANT, xid }));

async function adapt(body: Record<string, unknown>): Promise<{
  archetype: string;
  directives: unknown[];
  profile_restore?: string;
}> {
  const res = await adaptPost(
    new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { authorization: `Bearer ${OPS_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT,
        session_id: randomUUID().replaceAll('-', ''),
        page_type: 'listing_list',
        holdout_pct: 0,
        consent_state: 'consented',
        ...body,
      }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    archetype: string;
    directives: unknown[];
    profile_restore?: string;
  };
}

/** A real write through `/api/adapt`, then a real restore: the store demonstrably holds it. */
async function seedAndProveRestore(xid: string, createdAt: number): Promise<void> {
  await adapt({
    xid,
    xid_created_at: createdAt,
    archetype_hint: 'yield_hunter',
    confidence: 0.86,
    archetype_source: 'quiz',
  });
  await vi.waitFor(
    async () => {
      expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(1);
    },
    { timeout: 10_000 },
  );
  const restored = await adapt({ xid, xid_created_at: createdAt });
  expect(restored.archetype).toBe('yield_hunter');
  expect(restored.profile_restore).toBe('restored');
  expect(restored.directives.length).toBeGreaterThan(0);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

beforeEach(() => {
  redis = createRedisTestDouble(realFetch);
  clickhouseCalls = [];
  keyRows.current = [{ tenantId: TENANT }];
  keyLookupThrows.current = false;
  mockCaptureException.mockReset();
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
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgres://test.invalid/db');
  vi.stubEnv('NODE_ENV', 'test');
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

describe('POST /api/profile/erase (R24-R27, R30)', () => {
  it('deletes the key, the same xid then gets neutral, and a second erase reports not_found (NC-3)', async () => {
    const xid = randomUUID();
    const createdAt = Date.now() - DAY_MS;
    await seedAndProveRestore(xid, createdAt);

    const res = await eraseCall(xid);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: 'deleted', data_source: 'redis' });
    expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(0);

    const replay = await adapt({ xid, xid_created_at: createdAt });
    expect(replay.archetype).toBe('neutral');
    expect(replay.directives).toEqual([]);
    expect(replay.profile_restore).toBe('miss');

    const again = await eraseCall(xid);
    expect(await again.json()).toEqual({ result: 'not_found', data_source: 'redis' });
  });

  it('leaves a 24-hour hash-only tombstone that refuses a delayed write (R27, NC-11)', async () => {
    const xid = randomUUID();
    const createdAt = Date.now() - DAY_MS;
    await seedAndProveRestore(xid, createdAt);
    await eraseCall(xid);

    const tombstone = `buyer_profile_tombstone:${TENANT}:${sha(xid)}`;
    const ttl = Number(await redis.raw(['PTTL', tombstone]));
    expect(ttl).toBeGreaterThan(DAY_MS - 60_000);
    expect(ttl).toBeLessThanOrEqual(DAY_MS);
    expect(await redis.raw(['GET', tombstone])).toBe('1');

    // A stale second tab still holding the xid writes after the withdrawal.
    await adapt({
      xid,
      xid_created_at: createdAt,
      archetype_hint: 'family_buyer',
      confidence: 0.9,
      archetype_source: 'quiz',
    });
    await settle();

    expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(0);
    expect((await adapt({ xid, xid_created_at: createdAt })).archetype).toBe('neutral');
  });

  /** A delete's effect, applied directly at a chosen point of a write. */
  const deleteNow = (xid: string): void => {
    void redis.raw(['SET', `buyer_profile_tombstone:${TENANT}:${sha(xid)}`, '1', 'EX', '86400']);
    void redis.raw(['DEL', profileKey(xid)]);
  };
  const lateWrite = (xid: string, createdAt: number): Promise<unknown> =>
    adapt({
      xid,
      xid_created_at: createdAt,
      archetype_hint: 'family_buyer',
      confidence: 0.9,
      archetype_source: 'quiz',
    });
  const expectGoneForGood = async (xid: string, createdAt: number): Promise<void> => {
    await settle();
    expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(0);
    expect((await adapt({ xid, xid_created_at: createdAt })).archetype).toBe('neutral');
  };

  // The reader's defect: the write used to check the tombstone, SET, re-check, and undo with a DEL. A
  // delete landing before the SET, followed by a failed undo or a lost response, left the key live
  // with its full TTL while erase had answered 200.
  it('a delete just before the write lands, with the DEL that would undo it failing (NC-11)', async () => {
    if (redis.real) return;
    const xid = randomUUID();
    const createdAt = Date.now() - DAY_MS;
    await seedAndProveRestore(xid, createdAt);

    redis.onceBeforeProfileWrite(() => {
      deleteNow(xid);
      redis.failCommand('DEL');
    });
    await lateWrite(xid, createdAt);
    await settle();
    redis.failCommand(null);

    await expectGoneForGood(xid, createdAt);
  });

  it('a delete just before the write lands, with the write response lost (NC-11)', async () => {
    if (redis.real) return;
    const xid = randomUUID();
    const createdAt = Date.now() - DAY_MS;
    await seedAndProveRestore(xid, createdAt);

    redis.onceBeforeProfileWrite(() => {
      deleteNow(xid);
      redis.loseNextResponse();
    });
    await lateWrite(xid, createdAt);

    await expectGoneForGood(xid, createdAt);
  });

  it('a delete right after the write lands, with the write response lost (NC-11)', async () => {
    if (redis.real) return;
    const xid = randomUUID();
    const createdAt = Date.now() - DAY_MS;
    await seedAndProveRestore(xid, createdAt);

    redis.onceAfterProfileWrite(() => {
      deleteNow(xid);
      redis.loseNextResponse();
    });
    await lateWrite(xid, createdAt);

    await expectGoneForGood(xid, createdAt);
  });

  it('writes racing a real erase: none survives it (NC-11, the real scripts on a real Redis)', async () => {
    const xid = randomUUID();
    const createdAt = Date.now() - DAY_MS;
    await seedAndProveRestore(xid, createdAt);

    const racing = Array.from({ length: 12 }, () => lateWrite(xid, createdAt));
    const erased = await eraseCall(xid);
    expect(erased.status).toBe(200);
    await Promise.all(racing);
    await new Promise((resolve) => setTimeout(resolve, redis.real ? 1500 : 50));

    await expectGoneForGood(xid, createdAt);
  });

  it('a reply the write script never gives is a captured failure, not a success', async () => {
    if (redis.real) return;
    const xid = randomUUID();
    const createdAt = Date.now() - DAY_MS;
    await seedAndProveRestore(xid, createdAt);
    mockCaptureException.mockClear();

    redis.replaceNextProfileWriteReply('something else');
    await lateWrite(xid, createdAt);

    await vi.waitFor(() => {
      expect(String(mockCaptureException.mock.lastCall?.[0])).toBe(
        'Error: buyer_profile redis_command_error',
      );
    });
  });

  it('a later self-service erase does not shorten a longer tombstone', async () => {
    const xid = randomUUID();
    await seedAndProveRestore(xid, Date.now() - DAY_MS);
    const tombstone = `buyer_profile_tombstone:${TENANT}:${sha(xid)}`;
    await redis.raw(['SET', tombstone, '1', 'EX', String(90 * 86400)]);

    await eraseCall(xid);

    expect(Number(await redis.raw(['PTTL', tombstone]))).toBeGreaterThan(89 * DAY_MS);
    expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(0);
  });

  it('is scoped to the tenant: another tenant’s key is neither read nor deleted', async () => {
    const xid = randomUUID();
    const createdAt = Date.now() - DAY_MS;
    await seedAndProveRestore(xid, createdAt);

    const other = '00000000-0000-4000-8000-0000000000bb';
    keyRows.current = [{ tenantId: other }];
    const res = await erasePost(signedRequest('/api/profile/erase', { tenant_id: other, xid }));
    expect(await res.json()).toEqual({ result: 'not_found', data_source: 'redis' });
    touchedKeys.push(`buyer_profile_tombstone:${other}:${sha(xid)}`);

    expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(1);
  });

  it.each([
    [
      'HTTP 403',
      (r: RedisTestDouble) => {
        r.failHttp(403);
      },
      'redis_http_error',
    ],
    [
      'a [{error}] reply to the delete',
      (r: RedisTestDouble) => {
        r.failCommand('EVAL');
      },
      'redis_command_error',
    ],
  ])('%s is a non-2xx, never a completed delete (R18)', async (_label, fail, code) => {
    if (redis.real) return;
    const xid = randomUUID();
    const createdAt = Date.now() - DAY_MS;
    await seedAndProveRestore(xid, createdAt);

    fail(redis);
    const res = await eraseCall(xid);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { result: string; error: { code: string } };
    expect(body.result).toBe('failed');
    expect(body.error.code).toBe('profile_store_failed');
    await vi.waitFor(() => {
      expect(mockCaptureException).toHaveBeenCalled();
    });
    expect(String(mockCaptureException.mock.lastCall?.[0])).toBe(`Error: buyer_profile ${code}`);
    expect(
      JSON.stringify(mockCaptureException.mock.calls.map((c) => [String(c[0]), c[1] as unknown])),
    ).not.toContain(xid);

    // Recovery on the same xid: the retry the SDK makes on the next load deletes it.
    redis.failHttp(null);
    redis.failCommand(null);
    const retry = await eraseCall(xid);
    expect(retry.status).toBe(200);
    expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(0);
  });

  it('Redis unconfigured with the flag on is a 503 (NC-12)', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');
    const res = await eraseCall(randomUUID());
    expect(res.status).toBe(503);
  });

  it('flag off with no store answers 200 with the provenance saying so', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');
    vi.stubEnv('BUYER_PROFILE_ENABLED', '');
    const res = await eraseCall(randomUUID());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: 'not_found', data_source: 'not_configured' });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('flag off with a store still deletes: a right outlives the feature', async () => {
    const xid = randomUUID();
    const createdAt = Date.now() - DAY_MS;
    await seedAndProveRestore(xid, createdAt);

    vi.stubEnv('BUYER_PROFILE_ENABLED', '');
    const res = await eraseCall(xid);

    expect(await res.json()).toEqual({ result: 'deleted', data_source: 'redis' });
    expect(await redis.raw(['EXISTS', profileKey(xid)])).toBe(0);
  });
});

describe('POST /api/profile/access and /portability (R30)', () => {
  it('access returns what is held and when it ends, with no consent field needed', async () => {
    const xid = randomUUID();
    const createdAt = Date.now() - 10 * DAY_MS;
    await seedAndProveRestore(xid, createdAt);

    const res = await accessPost(signedRequest('/api/profile/access', { tenant_id: TENANT, xid }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: string;
      profile: unknown;
      expires_at: string;
      data_source: string;
    };
    expect(body.result).toBe('found');
    expect(body.data_source).toBe('redis');
    expect(body.profile).toEqual({ archetype: 'yield_hunter', confidence: 0.86, source: 'quiz' });
    const ends = Date.parse(body.expires_at);
    expect(Math.abs(ends - (createdAt + 90 * DAY_MS))).toBeLessThan(5000);
    expect(JSON.stringify(body)).not.toContain(xid);
  });

  it('portability is versioned JSON of the same data', async () => {
    const xid = randomUUID();
    await seedAndProveRestore(xid, Date.now() - DAY_MS);

    const res = await portabilityPost(
      signedRequest('/api/profile/portability', { tenant_id: TENANT, xid }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      format: 'estalara.buyer_profile',
      format_version: 1,
      profile: { archetype: 'yield_hunter', confidence: 0.86, source: 'quiz' },
      data_source: 'redis',
    });
  });

  it('both work after withdrawal, and say nothing is held (R30)', async () => {
    const xid = randomUUID();
    await seedAndProveRestore(xid, Date.now() - DAY_MS);
    await eraseCall(xid);

    const access = await accessPost(
      signedRequest('/api/profile/access', { tenant_id: TENANT, xid }),
    );
    expect(await access.json()).toEqual({
      result: 'not_found',
      profile: null,
      expires_at: null,
      data_source: 'redis',
    });
    const exported = await portabilityPost(
      signedRequest('/api/profile/portability', { tenant_id: TENANT, xid }),
    );
    expect(await exported.json()).toMatchObject({ profile: null, expires_at: null });
  });

  it.each<[string, Handler]>([
    ['access', accessPost],
    ['portability', portabilityPost],
  ])('%s: a store failure is a 503, not an empty answer (Rule K.2)', async (name, handler) => {
    if (redis.real) return;
    const xid = randomUUID();
    await seedAndProveRestore(xid, Date.now() - DAY_MS);
    redis.failHttp(500);

    const res = await handler(signedRequest(`/api/profile/${name}`, { tenant_id: TENANT, xid }));

    expect(res.status).toBe(503);
  });

  it.each<[string, Handler]>([
    ['access', accessPost],
    ['portability', portabilityPost],
  ])('%s reads never extend the expiry (R21)', async (name, handler) => {
    const xid = randomUUID();
    await seedAndProveRestore(xid, Date.now() - DAY_MS);
    const before = Number(await redis.raw(['PTTL', profileKey(xid)]));

    await handler(signedRequest(`/api/profile/${name}`, { tenant_id: TENANT, xid }));

    expect(Number(await redis.raw(['PTTL', profileKey(xid)]))).toBeLessThanOrEqual(before);
  });
});

describe('the gate (R30): same key and origin rule as /api/quiz/run', () => {
  const routes: [string, Handler][] = [
    ['/api/profile/erase', erasePost],
    ['/api/profile/access', accessPost],
    ['/api/profile/portability', portabilityPost],
  ];

  /** Each refusal must leave a real, restorable profile untouched. */
  const refused = async (
    build: (path: string, xid: string) => NextRequest,
    status: number,
  ): Promise<void> => {
    const xid = randomUUID();
    const createdAt = Date.now() - DAY_MS;
    await seedAndProveRestore(xid, createdAt);
    redis.requests.length = 0;

    for (const [path, handler] of routes) {
      const res = await handler(build(path, xid));
      expect(res.status, path).toBe(status);
      expect(JSON.stringify(await res.json()), path).not.toContain(xid);
    }

    expect(redis.requests).toEqual([]);
    const restored = await adapt({ xid, xid_created_at: createdAt });
    expect(restored.profile_restore).toBe('restored');
  };

  it('no bearer: 401', async () => {
    await refused(
      (path, xid) =>
        new NextRequest(`http://localhost${path}`, {
          method: 'POST',
          body: JSON.stringify({ tenant_id: TENANT, xid }),
        }),
      401,
    );
  });

  it('a wrong HMAC: 401', async () => {
    await refused(
      (path, xid) => signedRequest(path, { tenant_id: TENANT, xid }, { signature: 'a'.repeat(64) }),
      401,
    );
  });

  it('an unknown or revoked key: 401', async () => {
    keyRows.current = [];
    const xid = randomUUID();
    for (const [path, handler] of routes) {
      const res = await handler(signedRequest(path, { tenant_id: TENANT, xid }));
      expect(res.status).toBe(401);
    }
    expect(redis.requests).toEqual([]);
  });

  it('the ops key has no way in: 401 even when correctly signed', async () => {
    keyRows.current = [];
    const xid = randomUUID();
    const res = await erasePost(
      signedRequest('/api/profile/erase', { tenant_id: TENANT, xid }, { key: OPS_KEY }),
    );
    expect(res.status).toBe(401);
  });

  it('an unlisted Origin: 403 before the store', async () => {
    await refused(
      (path, xid) =>
        signedRequest(path, { tenant_id: TENANT, xid }, { origin: 'https://evil.example' }),
      403,
    );
  });

  it('a body tenant other than the key’s: 403 before the store', async () => {
    await refused((path, xid) => signedRequest(path, { tenant_id: 'someone-else', xid }), 403);
  });

  it.each([
    ['not json', '{nope'],
    ['no xid', { tenant_id: TENANT }],
    ['an xid that is not a strict v4', { tenant_id: TENANT, xid: 'abc' }],
    ['an unknown key', { tenant_id: TENANT, xid: randomUUID(), session_id: 'x' }],
  ])('%s: 400 and the store untouched', async (_label, body) => {
    for (const [path, handler] of routes) {
      const res = await handler(signedRequest(path, body));
      expect(res.status, path).toBe(400);
    }
    expect(redis.requests).toEqual([]);
  });

  it('a failed key lookup is a loud 500 and carries no driver text', async () => {
    keyLookupThrows.current = true;
    const res = await erasePost(
      signedRequest('/api/profile/erase', { tenant_id: TENANT, xid: randomUUID() }),
    );
    expect(res.status).toBe(500);
    await vi.waitFor(() => {
      expect(mockCaptureException).toHaveBeenCalled();
    });
    expect(String(mockCaptureException.mock.lastCall?.[0])).toBe(
      'Error: buyer_profile api_key_lookup_failed',
    );
  });

  it('the quota answers 429 past the limit, by client, and a store failure does not lock a buyer out', async () => {
    const xid = randomUUID();
    const hit = (ip: string): Promise<NextResponse> => {
      const req = signedRequest('/api/profile/access', { tenant_id: TENANT, xid });
      req.headers.set('x-forwarded-for', ip);
      return accessPost(req);
    };
    const key = `buyer_profile_quota:${TENANT}:${createHash('sha256').update('198.51.100.7').digest('hex')}`;
    touchedKeys.push(
      key,
      `buyer_profile_quota:${TENANT}:${createHash('sha256').update('198.51.100.8').digest('hex')}`,
    );
    for (let i = 0; i < 60; i++) expect((await hit('198.51.100.7')).status).toBe(200);
    expect((await hit('198.51.100.7')).status).toBe(429);
    expect((await hit('198.51.100.8')).status).toBe(200);
    expect(await redis.raw(['EXISTS', key])).toBe(1);
    expect(Number(await redis.raw(['PTTL', key]))).toBeLessThanOrEqual(60_000);
    // The address is hashed, and only ever in the key.
    expect(JSON.stringify(redis.requests)).not.toContain('198.51.100.7');

    if (redis.real) return;
    // The quota's own store failing must not be what blocks a withdrawal.
    const seed = randomUUID();
    await seedAndProveRestore(seed, Date.now() - DAY_MS);
    redis.failCommand('INCR');
    const erased = await eraseCall(seed);
    expect(erased.status).toBe(200);
    expect(await redis.raw(['EXISTS', profileKey(seed)])).toBe(0);
  });
});

describe('R34 — the audit row', () => {
  it('records the action and result, without the xid or its hash', async () => {
    const xid = randomUUID();
    await seedAndProveRestore(xid, Date.now() - DAY_MS);
    clickhouseCalls.length = 0;

    await eraseCall(xid);
    await accessPost(signedRequest('/api/profile/access', { tenant_id: TENANT, xid }));
    await vi.waitFor(() => {
      expect(clickhouseCalls).toHaveLength(2);
    });

    const rows = clickhouseCalls.map((c) => JSON.parse(c.body) as Record<string, unknown>);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT,
      session_id: '',
      dsr_type: 'buyer_profile_erase',
      action: 'completed',
    });
    expect(rows[1]).toMatchObject({ dsr_type: 'buyer_profile_access', action: 'completed' });
    const seen = JSON.stringify(clickhouseCalls);
    expect(seen).not.toContain(xid);
    expect(seen).not.toContain(sha(xid));
  });

  it('a failed delete is audited as failed', async () => {
    if (redis.real) return;
    const xid = randomUUID();
    await seedAndProveRestore(xid, Date.now() - DAY_MS);
    clickhouseCalls.length = 0;

    redis.failHttp(403);
    await eraseCall(xid);
    await vi.waitFor(() => {
      expect(clickhouseCalls).toHaveLength(1);
    });
    expect(JSON.parse(clickhouseCalls[0]?.body ?? '{}')).toMatchObject({ action: 'failed' });
  });
});
