/**
 * `POST /api/adapt` — buyer traits [FOLLOW-1360, ESC-086 item 4].
 *
 * `traits` is an additive body field: canonical ids are kept (max 7), anything else is dropped
 * without a 400. On the playbook branches a trait adds at most one invitation slot (`trait_note`),
 * which asserts nothing about the property and so survives the §E.7.0 withhold; on the model
 * branches the ids reach the gateway as guidance and every check the directives pass is unchanged.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow1360.test
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGateway } = vi.hoisted(() => ({ mockGateway: vi.fn() }));

vi.mock('@/lib/demo-jwt-verify', () => ({
  verifyDemoJwt: vi.fn().mockResolvedValue({}),
  DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
  DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
}));
vi.mock('@/lib/llm-gateway', () => ({ callLlmGateway: mockGateway }));
vi.mock('@estalara/auth', () => ({ getAuthClaims: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/rag-retrieval', () => ({ retrieveListingContext: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/tenant-schema', () => ({ getTenantSchema: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi
    .fn()
    .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]),
}));

import { POST } from './route';

interface AdaptBody {
  directives: { type: string; slot?: string; value?: string }[];
  source: string;
  fallback_reason?: string;
}

function adapt(extra: Record<string, unknown>, similarity = 0.95): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo_key' },
      body: JSON.stringify({
        tenant_id: 'est_demo_tenant',
        session_id: 'sess-follow1360',
        page_type: 'listing_detail',
        archetype_hint: 'family_buyer',
        confidence: 0.9,
        similarity,
        holdout_pct: 0,
        ...extra,
      }),
    }),
  );
}

async function slotsFor(extra: Record<string, unknown>): Promise<string[]> {
  const res = await adapt(extra);
  expect(res.status).toBe(200);
  return ((await res.json()) as AdaptBody).directives.map((d) => d.slot ?? '').sort();
}

describe('POST /api/adapt — traits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('serves no trait slot without a trait', async () => {
    expect(await slotsFor({})).toEqual(['cta']);
    expect(await slotsFor({ traits: [] })).toEqual(['cta']);
  });

  it.each([
    ['premium', 'Request a Private Viewing'],
    ['works_from_home', 'Ask About Home Office Space'],
    ['residency_goal', 'Ask About Residency Requirements'],
    ['seasoned_investor', 'Request an Investment Pack'],
    ['buying_from_abroad', 'Ask About Buying From Abroad'],
    ['will_let', 'Ask About Letting This Home'],
  ])('%s adds its one invitation slot on the playbook branch', async (trait, text) => {
    const res = await adapt({ traits: [trait] });
    const body = (await res.json()) as AdaptBody;
    const note = body.directives.filter((d) => d.slot === 'trait_note');
    expect(note).toHaveLength(1);
    expect(note[0]?.value).toBe(text);
    expect(body.directives.map((d) => d.slot).sort()).toEqual(['cta', 'trait_note']);
  });

  it('serves the pl invitation for locale pl', async () => {
    const res = await adapt({ traits: ['premium'], locale: 'pl' });
    const body = (await res.json()) as AdaptBody;
    expect(body.directives.find((d) => d.slot === 'trait_note')?.value).toBe(
      'Poproś o prywatną prezentację',
    );
  });

  it('has_children adds nothing to the page', async () => {
    expect(await slotsFor({ traits: ['has_children'] })).toEqual(['cta']);
  });

  it('accepts and ignores unknown traits (no 400, no slot)', async () => {
    const res = await adapt({ traits: ['no_such_trait', 'PREMIUM', 'x'.repeat(64)] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AdaptBody).directives.map((d) => d.slot)).toEqual(['cta']);
  });

  it('keeps at most 7 ids and de-duplicates (one slot per trait)', async () => {
    const all = [
      'premium',
      'works_from_home',
      'residency_goal',
      'buying_from_abroad',
      'seasoned_investor',
      'will_let',
      'has_children',
    ];
    const slots = await slotsFor({ traits: [...all, ...all, ...all] });
    expect(slots.filter((s) => s === 'trait_note')).toHaveLength(6);
  });

  it('rejects a non-array traits field like any other malformed body', async () => {
    expect((await adapt({ traits: 'premium' })).status).toBe(400);
  });

  it('hands only canonical ids to the gateway on the model branches', async () => {
    mockGateway.mockResolvedValue(null);
    await adapt({ traits: ['premium', 'bogus', 'has_children'] }, 0.5);
    expect(mockGateway).toHaveBeenCalledTimes(1);
    expect(mockGateway.mock.calls[0]?.[0]).toMatchObject({ traits: ['premium', 'has_children'] });
  });

  it('adds no traits key to the gateway call when none is sent', async () => {
    mockGateway.mockResolvedValue(null);
    await adapt({}, 0.5);
    expect(mockGateway.mock.calls[0]?.[0]).not.toHaveProperty('traits');
  });
});
