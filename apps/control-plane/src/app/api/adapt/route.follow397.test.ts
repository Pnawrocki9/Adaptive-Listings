/**
 * FOLLOW-397 — Derive VARIANT_INDEX from SEED_VARIANTS (Rule K.1).
 *
 * AC-2 (TG-3 from RETRO-095): verifies that a variant name NOT in SEED_VARIANTS
 * (e.g. a stray 'v3' or 'default') does NOT silently map to index 0 (control copy).
 *
 * Two parts:
 *  Part A (unit): import the exported VARIANT_INDEX and assert directly that unknown
 *    keys are `undefined`. This test is RED if `'default': 0` is present in the map.
 *  Part B (integration): mock thompsonSample to return 'v3' (a stray variant not in
 *    SEED_VARIANTS) and verify the route returns 200 with the base `s.en` copy —
 *    NOT `s.variants.en[0]` (which would be served by the old `?? 0` fallback).
 *    Uses a synthetic playbook where `s.en` differs from `s.variants.en[0]` so the
 *    two code paths produce distinct outputs.
 *
 * AC-3 grep: 'default' must not appear in VARIANT_INDEX after AC-1 (see Part A
 * assertion `expect(VARIANT_INDEX['default']).toBeUndefined()`).
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow397.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (hoisted before route import) ──────────────────────────────────────

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

vi.mock('@/lib/ab-events', () => ({
  publishAbAssignmentEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn().mockResolvedValue({ enabled: false }),
  DEMO_OVERRIDE_CONFIDENCE: 0.95,
  DEMO_OVERRIDE_SIMILARITY: 0.75,
}));

vi.mock('@/lib/chat-intent-cache', () => ({
  readShadowChatIntent: vi.fn().mockResolvedValue(null),
  flattenIntentDimensions: vi.fn().mockReturnValue({}),
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  tenants: { tenantId: 'tenant_id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

vi.mock('@/lib/embedding-lookup', () => ({
  fetchListingEmbeddings: vi.fn().mockResolvedValue([]),
  fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
  LISTING_EMBEDDING_BATCH_LIMIT: 20,
}));

/**
 * Synthetic playbook where `s.en` is intentionally different from `s.variants.en[0]`.
 * This makes the two code paths (old ?? 0 fallback vs new undefined passthrough)
 * produce distinct directive values, so the test can verify which path was taken.
 *
 * With the old `?? 0` fallback: variantIndex = 0 → serves 'CONTROL_VARIANT_COPY'.
 * With the fix (undefined passthrough): variantIndex = undefined → serves 'BASE_EN_COPY'.
 */
const PLAYBOOK_WITH_DISTINCT_BASE = {
  slots: [
    {
      slot: 'headline',
      en: 'BASE_EN_COPY',
      variants: {
        en: ['CONTROL_VARIANT_COPY', 'V1_VARIANT_COPY', 'V2_VARIANT_COPY'],
      },
    },
  ],
};

vi.mock('@estalara/sdk/playbooks', () => ({
  getPlaybook: vi.fn(() => PLAYBOOK_WITH_DISTINCT_BASE),
}));

// FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ]),
}));

// Mock @estalara/shared: make thompsonSample return 'v3' (stray variant not in SEED_VARIANTS).
// vi.clearAllMocks() clears call history only — mockReturnValue('v3') persists across tests.
vi.mock('@estalara/shared', async () => {
  const mod = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  return {
    ...mod,
    assignHoldout: vi.fn().mockResolvedValue({
      holdout_group: false,
      skipped: false,
      assigned_at: new Date().toISOString(),
    }),
    // 'v3' is not in SEED_VARIANTS — exercises the stray-variant code path.
    thompsonSample: vi.fn().mockReturnValue('v3'),
  };
});

import { POST } from './route.js';
// VARIANT_INDEX lives in its own module (not exported from the Next.js route file
// to satisfy Next.js route-export constraints). The @/lib/bandit-query mock above
// propagates to variant-index.ts via the shared SEED_VARIANTS import.
import { VARIANT_INDEX } from '@/lib/variant-index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_POST_BODY = {
  tenant_id: 'est_demo_tenant',
  session_id: 'sess-follow397-001',
  page_type: 'listing_detail' as const,
  archetype_hint: 'yield_hunter',
  confidence: 0.9,
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

// ─── Part A: unit assertions on VARIANT_INDEX ─────────────────────────────────

describe('VARIANT_INDEX — FOLLOW-397 AC-2 (Part A): derived from SEED_VARIANTS', () => {
  it('maps known variants to their zero-based index', () => {
    expect(VARIANT_INDEX.control).toBe(0);
    expect(VARIANT_INDEX.v1).toBe(1);
    expect(VARIANT_INDEX.v2).toBe(2);
  });

  it('VARIANT_INDEX["v3"] is undefined — stray variant not in SEED_VARIANTS', () => {
    // RED if a hardcoded entry `v3: <number>` exists in the map.
    expect(VARIANT_INDEX.v3).toBeUndefined();
  });

  it('VARIANT_INDEX["default"] is undefined — RED if `default: 0` is present (AC-2)', () => {
    // Key RED-condition check from AC-2: if someone adds `default: 0` back to a
    // hardcoded VARIANT_INDEX, this test fails. GREEN after AC-1.
    expect(VARIANT_INDEX.default).toBeUndefined();
  });

  it('VARIANT_INDEX contains exactly the entries from SEED_VARIANTS — no extras', () => {
    const keys = Object.keys(VARIANT_INDEX).sort();
    expect(keys).toEqual(['control', 'v1', 'v2']);
  });
});

// ─── Part B: integration — stray variant handled gracefully ──────────────────

describe('POST /api/adapt — FOLLOW-397 AC-2 (Part B): stray variant falls through to s.en', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns HTTP 200 when thompsonSample returns a stray variant ("v3")', async () => {
    const res = await POST(makePostRequest(BASE_POST_BODY));
    expect(res.status).toBe(200);
  });

  it(
    'directive value is s.en ("BASE_EN_COPY"), not s.variants.en[0] ("CONTROL_VARIANT_COPY") ' +
      '— proves undefined variantIndex is not coerced to 0',
    async () => {
      const res = await POST(makePostRequest(BASE_POST_BODY));
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        variant: string;
        directives: { type: string; slot: string; value: string }[];
      };

      // The selected (and logged) variant is the stray 'v3'.
      expect(body.variant).toBe('v3');

      // With the old `?? 0` fallback: variantIndex = 0 → 'CONTROL_VARIANT_COPY'.
      // With the fix (undefined passthrough): variantIndex = undefined → s.en = 'BASE_EN_COPY'.
      // The two values are deliberately distinct in PLAYBOOK_WITH_DISTINCT_BASE.
      const headline = body.directives.find((d) => d.type === 'text' && d.slot === 'headline');
      expect(headline?.value).toBe('BASE_EN_COPY');
      expect(headline?.value).not.toBe('CONTROL_VARIANT_COPY');
    },
  );
});
