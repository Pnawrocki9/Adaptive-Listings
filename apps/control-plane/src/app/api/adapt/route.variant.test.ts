/**
 * Tests for FOLLOW-007 / FOLLOW-342 — Thompson sampling variant selection wired into
 * the canonical POST /api/adapt route, and variant reaching copy selection.
 *
 * Coverage:
 *  - Response body includes `variant` field (non-empty string)
 *  - All-paused arms → `variant: 'control'` (thompsonSample returns null)
 *  - `getBanditArms` called with (tenant_id, archetype) — auto-seed path
 *  - ClickHouse INSERT carries the selected variant in the column list
 *  - FOLLOW-342: 3 arms produce distinct textDirectives[0].value when playbook has variants.en
 *  - FOLLOW-342 AC-2: fallback to slot.en when variants is absent from the slot
 *
 * @module apps/control-plane/src/app/api/adapt/route.variant.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (must be hoisted before route import) ──────────────────────────────

// Bypass JWT verification — these tests focus on variant/bandit wiring, not auth.
vi.mock('@/lib/demo-jwt-verify', () => ({
  verifyDemoJwt: vi.fn().mockResolvedValue({}),
  DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
  DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
}));

vi.mock('@/lib/llm-gateway', () => ({
  callLlmGateway: vi.fn().mockResolvedValue(null),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('@estalara/sdk/playbooks', () => ({
  getPlaybook: vi.fn(() => ({
    slots: [
      { slot: 'headline', en: 'High-yield investment property' },
      { slot: 'cta', en: 'View ROI Analysis' },
    ],
  })),
}));

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue({
    reorder_capable: true,
    container_selector: '[data-estalara-listings-grid]',
    item_selector: '[data-estalara-listing-id]',
  }),
}));

vi.mock('@/lib/ab-events', () => ({
  publishAbAssignmentEvent: vi.fn().mockResolvedValue(undefined),
}));

const mockGetBanditArms = vi.hoisted(() => vi.fn());
vi.mock('@/lib/bandit-query', () => ({
  getBanditArms: mockGetBanditArms,
}));

import { POST } from './route.js';
import { getBanditArms } from '@/lib/bandit-query';
import { getPlaybook } from '@estalara/sdk/playbooks';

const VALID_BODY = {
  tenant_id: 'est_demo_tenant',
  session_id: 'sess-variant-001',
  page_type: 'listing_list' as const,
  archetype_hint: 'yield_hunter',
  confidence: 0.8,
  similarity: 0.9,
  holdout_pct: 0.0,
  consent_state: 'granted',
  consent_mode_enabled: false,
};

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer demo_key',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/adapt — FOLLOW-007: response includes variant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBanditArms.mockResolvedValue([
      { variant: 'control', alpha: 1, beta: 1, paused: false },
      { variant: 'v1', alpha: 1, beta: 1, paused: false },
      { variant: 'v2', alpha: 1, beta: 1, paused: false },
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('response body includes a non-empty `variant` string', async () => {
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.variant).toBe('string');
    expect((body.variant as string).length).toBeGreaterThan(0);
    expect(['control', 'v1', 'v2']).toContain(body.variant);
  });

  it('getBanditArms is called with the tenant_id and archetype from the request', async () => {
    await POST(makePostRequest({ ...VALID_BODY, archetype_hint: 'family_buyer' }));

    expect(getBanditArms).toHaveBeenCalledOnce();
    expect(getBanditArms).toHaveBeenCalledWith('est_demo_tenant', 'family_buyer');
  });

  it('all-paused arms → variant: "control" in response', async () => {
    mockGetBanditArms.mockResolvedValue([
      { variant: 'control', alpha: 5, beta: 1, paused: true },
      { variant: 'v1', alpha: 1, beta: 10, paused: true },
      { variant: 'v2', alpha: 3, beta: 2, paused: true },
    ]);

    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.variant).toBe('control');
  });

  it('empty arms (DB unavailable) → variant: "control" in response', async () => {
    mockGetBanditArms.mockResolvedValue([]);

    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.variant).toBe('control');
  });

  it('single active arm → that variant is returned deterministically', async () => {
    mockGetBanditArms.mockResolvedValue([
      { variant: 'control', alpha: 1, beta: 1, paused: true },
      { variant: 'v1', alpha: 1, beta: 1, paused: false },
      { variant: 'v2', alpha: 1, beta: 1, paused: true },
    ]);

    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.variant).toBe('v1');
  });

  it('existing fields (directives, source, archetype) coexist with variant', async () => {
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.directives).toBeDefined();
    expect(body.source).toBeDefined();
    expect(body.archetype).toBeDefined();
    expect(body.variant).toBeDefined();
  });
});

describe('POST /api/adapt — FOLLOW-007: ClickHouse INSERT carries variant', () => {
  let lastFetchBody: string | null = null;
  let lastFetchUrl: string | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    lastFetchBody = null;
    lastFetchUrl = null;
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown, opts?: { body?: string }) => {
        lastFetchUrl = typeof url === 'string' ? url : null;
        lastFetchBody = opts?.body ?? null;
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
    // Make thompsonSample deterministic: only `v1` is active.
    mockGetBanditArms.mockResolvedValue([
      { variant: 'control', alpha: 1, beta: 1, paused: true },
      { variant: 'v1', alpha: 1, beta: 1, paused: false },
      { variant: 'v2', alpha: 1, beta: 1, paused: true },
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('INSERT includes the variant column name', async () => {
    await POST(makePostRequest(VALID_BODY));
    expect(lastFetchBody).not.toBeNull();
    expect(lastFetchBody).toContain('variant');
  });

  it('INSERT passes selected variant value as URL param (FOLLOW-261 parameterized)', async () => {
    await POST(makePostRequest(VALID_BODY));
    expect(lastFetchUrl).not.toBeNull();
    const parsedUrl = new URL(lastFetchUrl!);
    expect(parsedUrl.searchParams.get('param_p_variant')).toBe('v1');
  });

  it('all-paused path passes `control` to ClickHouse as URL param (FOLLOW-261)', async () => {
    mockGetBanditArms.mockResolvedValue([
      { variant: 'control', alpha: 1, beta: 1, paused: true },
      { variant: 'v1', alpha: 1, beta: 1, paused: true },
      { variant: 'v2', alpha: 1, beta: 1, paused: true },
    ]);

    await POST(makePostRequest(VALID_BODY));
    expect(lastFetchUrl).not.toBeNull();
    const parsedUrl = new URL(lastFetchUrl!);
    expect(parsedUrl.searchParams.get('param_p_variant')).toBe('control');
  });
});

// ─── FOLLOW-342: variant reaches copy selection ───────────────────────────────

describe('POST /api/adapt — FOLLOW-342: bandit variant reaches playbook copy selection', () => {
  /**
   * A mock playbook where the headline slot has 3 distinct variants.en entries.
   * Simulates the structure already present on non-neutral archetypes (e.g. yield_hunter).
   */
  const PLAYBOOK_WITH_VARIANTS = {
    slots: [
      {
        slot: 'headline',
        en: 'Default headline (control)',
        variants: {
          en: ['Default headline (control)', 'Variant 1 headline', 'Variant 2 headline'],
        },
      },
      { slot: 'cta', en: 'View Details' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlaybook).mockReturnValue(
      PLAYBOOK_WITH_VARIANTS as ReturnType<typeof getPlaybook>,
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * AC-4 (FOLLOW-342): The 3 bandit arms must produce distinct textDirectives[0].value
   * when the playbook headline slot carries variants.en with 3 entries.
   *
   * Strategy: force each arm to be the sole active arm in turn, then assert the
   * returned headline value matches the expected variants.en[index] entry.
   * This is deterministic — thompsonSample returns the only active arm's variant.
   */
  it('control arm → textDirectives[0].value is variants.en[0]', async () => {
    mockGetBanditArms.mockResolvedValue([
      { variant: 'control', alpha: 1, beta: 1, paused: false },
      { variant: 'v1', alpha: 1, beta: 1, paused: true },
      { variant: 'v2', alpha: 1, beta: 1, paused: true },
    ]);

    const res = await POST(makePostRequest({ ...VALID_BODY, page_type: 'listing_detail' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      directives: { type: string; slot: string; value: string }[];
    };
    const headline = body.directives.find((d) => d.type === 'text' && d.slot === 'headline');
    expect(headline?.value).toBe('Default headline (control)');
  });

  it('v1 arm → textDirectives[0].value is variants.en[1]', async () => {
    mockGetBanditArms.mockResolvedValue([
      { variant: 'control', alpha: 1, beta: 1, paused: true },
      { variant: 'v1', alpha: 1, beta: 1, paused: false },
      { variant: 'v2', alpha: 1, beta: 1, paused: true },
    ]);

    const res = await POST(makePostRequest({ ...VALID_BODY, page_type: 'listing_detail' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      directives: { type: string; slot: string; value: string }[];
    };
    const headline = body.directives.find((d) => d.type === 'text' && d.slot === 'headline');
    expect(headline?.value).toBe('Variant 1 headline');
  });

  it('v2 arm → textDirectives[0].value is variants.en[2]', async () => {
    mockGetBanditArms.mockResolvedValue([
      { variant: 'control', alpha: 1, beta: 1, paused: true },
      { variant: 'v1', alpha: 1, beta: 1, paused: true },
      { variant: 'v2', alpha: 1, beta: 1, paused: false },
    ]);

    const res = await POST(makePostRequest({ ...VALID_BODY, page_type: 'listing_detail' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      directives: { type: string; slot: string; value: string }[];
    };
    const headline = body.directives.find((d) => d.type === 'text' && d.slot === 'headline');
    expect(headline?.value).toBe('Variant 2 headline');
  });

  it('all 3 arms produce distinct headline values', async () => {
    // Run all 3 arm selections and collect headline values.
    const results: string[] = [];

    for (const activeVariant of ['control', 'v1', 'v2'] as const) {
      mockGetBanditArms.mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: activeVariant !== 'control' },
        { variant: 'v1', alpha: 1, beta: 1, paused: activeVariant !== 'v1' },
        { variant: 'v2', alpha: 1, beta: 1, paused: activeVariant !== 'v2' },
      ]);

      const res = await POST(makePostRequest({ ...VALID_BODY, page_type: 'listing_detail' }));
      const body = (await res.json()) as {
        directives: { type: string; slot: string; value: string }[];
      };
      const headline = body.directives.find((d) => d.type === 'text' && d.slot === 'headline');
      results.push(headline?.value ?? '');
    }

    // All 3 values must be non-empty and distinct from each other.
    expect(results).toHaveLength(3);
    expect(new Set(results).size).toBe(3);
  });

  /**
   * AC-2 (FOLLOW-342): fallback-to-slot.en when a slot has no variants array.
   * The copy selection chain is: locale override ?? variants.en[index] ?? slot.en.
   * When variants is undefined, slot.en must be returned regardless of the bandit index.
   */
  it('AC-2 fallback: slot without variants.en returns slot.en regardless of bandit index', async () => {
    // Playbook with NO variants on the cta slot — only en is present.
    const PLAYBOOK_NO_VARIANTS = {
      slots: [
        {
          slot: 'headline',
          en: 'Headline with no variants',
          // variants intentionally absent
        },
        { slot: 'cta', en: 'CTA with no variants' },
      ],
    };

    vi.mocked(getPlaybook).mockReturnValue(PLAYBOOK_NO_VARIANTS as ReturnType<typeof getPlaybook>);

    // Drive v2 arm (index 2) — there is no variants.en[2], so must fall back to slot.en.
    mockGetBanditArms.mockResolvedValue([
      { variant: 'control', alpha: 1, beta: 1, paused: true },
      { variant: 'v1', alpha: 1, beta: 1, paused: true },
      { variant: 'v2', alpha: 1, beta: 1, paused: false },
    ]);

    const res = await POST(makePostRequest({ ...VALID_BODY, page_type: 'listing_detail' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      directives: { type: string; slot: string; value: string }[];
    };

    // Headline: no variants → must return slot.en, NOT undefined or an empty string.
    const headline = body.directives.find((d) => d.type === 'text' && d.slot === 'headline');
    expect(headline?.value).toBe('Headline with no variants');

    // CTA: no variants → must return slot.en.
    const cta = body.directives.find((d) => d.type === 'text' && d.slot === 'cta');
    expect(cta?.value).toBe('CTA with no variants');
  });
});
