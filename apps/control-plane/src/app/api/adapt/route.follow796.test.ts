/**
 * FOLLOW-796 AC-4 (re-files RETRO-093 §4c TG-1) — POST /api/adapt slot_selectors gate.
 *
 * The `slot_selectors` response field was shipped by FOLLOW-340 with no route-level test.
 * This pins the PRE-EXISTING omit-when-empty gate (route.ts: `slotSelectors` is
 * `tenantSchema?.slot_selectors` only when it has ≥1 key, otherwise `undefined`, and the
 * field is spread in conditionally) — none of it is changed by FOLLOW-796.
 *
 * It also pins the VOCABULARY BOUNDARY that FOLLOW-796 depends on: the route emits the
 * DETECTION-vocabulary keys verbatim (`cta_primary`), and the SDK — not the server —
 * translates them to the ADAPTATION vocabulary (`cta`) in
 * packages/sdk/src/core/annotate-slots.ts. If a future change renames server-side, this
 * test fails and forces the SDK translation table to be revisited in the same PR.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow796.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock external dependencies (mirrors route.ab010.test.ts) ─────────────────

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
      { slot: 'feature', en: 'Investment Performance' },
    ],
  })),
}));

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn(),
}));

vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ]),
}));

import { POST } from './route.js';
import { getTenantSchema } from '@/lib/tenant-schema';

const mockGetTenantSchema = vi.mocked(getTenantSchema);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo_key' },
    body: JSON.stringify(body),
  });
}

const BASE_BODY = {
  tenant_id: 'est_demo_tenant',
  session_id: 'sess-follow796-001',
  page_type: 'listing_detail' as const,
  archetype_hint: 'yield_hunter',
  confidence: 0.9,
  similarity: 0.9,
  holdout_pct: 0.0,
};

async function postAndParse(): Promise<Record<string, unknown>> {
  const res = await POST(makePostRequest(BASE_BODY));
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/adapt — FOLLOW-796 AC-4: slot_selectors omit-when-empty gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('non-empty slot_selectors → included in the response, keys verbatim', async () => {
    mockGetTenantSchema.mockResolvedValue({
      reorder_capable: true,
      slot_selectors: { headline: 'h1.listing-title', cta_primary: 'a.btn-book' },
    });

    const body = await postAndParse();

    expect(body.slot_selectors).toEqual({
      headline: 'h1.listing-title',
      cta_primary: 'a.btn-book',
    });
    // Vocabulary boundary: the server does NOT rename cta_primary → cta.
    // The SDK's annotateSlots() owns that translation (FOLLOW-796).
    expect((body.slot_selectors as Record<string, string>).cta).toBeUndefined();
  });

  it('empty slot_selectors object → field OMITTED from the response', async () => {
    mockGetTenantSchema.mockResolvedValue({ reorder_capable: true, slot_selectors: {} });

    const body = await postAndParse();

    // Omitted, not present-as-{} — the SDK's `if (resp.slot_selectors)` guard and the
    // response payload size both depend on this.
    expect('slot_selectors' in body).toBe(false);
  });

  it('tenant schema without slot_selectors → field omitted', async () => {
    mockGetTenantSchema.mockResolvedValue({
      reorder_capable: true,
      container_selector: '[data-estalara-listings-grid]',
      item_selector: '[data-estalara-listing-id]',
    });

    const body = await postAndParse();

    expect('slot_selectors' in body).toBe(false);
  });

  it('tenant schema lookup returns null → field omitted, response still 200', async () => {
    mockGetTenantSchema.mockResolvedValue(null);

    const body = await postAndParse();

    expect('slot_selectors' in body).toBe(false);
    expect(body.session_id).toBe(BASE_BODY.session_id);
    expect(Array.isArray(body.directives)).toBe(true);
  });
});
