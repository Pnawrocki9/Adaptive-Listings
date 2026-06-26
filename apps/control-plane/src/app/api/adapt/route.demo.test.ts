/**
 * DEMO MODE tests for POST /api/adapt — DEMO-001.
 *
 * Coverage (AC4, AC6, AC7a, AC7b):
 *   - When DEMO MODE is on: endpoint uses the override archetype (not archetype_hint)
 *     at DEMO_OVERRIDE_CONFIDENCE/SIMILARITY so the decision tree runs adaptation.
 *   - When DEMO MODE is off: endpoint uses the SDK's archetype_hint unchanged.
 *   - Response includes demo_override=true flag when active (AC6).
 *   - When getDemoOverride throws (DB configured-but-failed), falls back to SDK hint
 *     and does NOT set demo_override flag (Rule K.2 degrade gracefully on decision path).
 *
 * @module apps/control-plane/src/app/api/adapt/route.demo.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Hoisted stubs ────────────────────────────────────────────────────────────

const { mockGetDemoOverride } = vi.hoisted(() => ({
  mockGetDemoOverride: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Bypass JWT verification — these tests focus on demo-override logic, not auth.
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

// FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi
    .fn()
    .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]),
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/embedding-lookup', () => ({
  fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
  fetchListingEmbeddings: vi.fn().mockResolvedValue(new Map()),
  LISTING_EMBEDDING_BATCH_LIMIT: 20,
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  })),
  tenants: {},
  demoOverrides: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: mockGetDemoOverride,
  DEMO_OVERRIDE_CONFIDENCE: 0.95,
  DEMO_OVERRIDE_SIMILARITY: 0.75,
}));

vi.mock('@/lib/ab-events', () => ({
  publishAbAssignmentEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@estalara/shared', async () => {
  // Spread the real shared module and override only the functions the adapt route uses
  // from this module. We import it explicitly to avoid using forbidden `import()` generics.
  const mod = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  return {
    ...mod,
    assignHoldout: vi.fn().mockResolvedValue({
      holdout_group: false,
      skipped: false,
      assigned_at: new Date().toISOString(),
    }),
    thompsonSample: vi.fn().mockReturnValue('control'),
  };
});

import { POST } from './route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test_key',
    },
    body: JSON.stringify(body),
  });
}

const BASE_BODY = {
  tenant_id: TENANT_ID,
  session_id: 'sess-demo-001',
  page_type: 'listing_detail',
  archetype_hint: 'neutral',
  confidence: 0.5,
  similarity: 0.5,
};

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/adapt — DEMO MODE override (DEMO-001 AC4, AC6, AC7a, AC7b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: demo mode off
    mockGetDemoOverride.mockResolvedValue({
      enabled: false,
      overrideArchetype: null,
      overrideModel: 'claude-sonnet-4-6',
    });
  });

  it('AC7b — when DEMO MODE is off, uses archetype_hint from body unchanged', async () => {
    mockGetDemoOverride.mockResolvedValue({
      enabled: false,
      overrideArchetype: 'luxury_buyer',
      overrideModel: 'claude-sonnet-4-6',
    });

    const res = await POST(makePostRequest({ ...BASE_BODY, archetype_hint: 'neutral' }));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    // Since DEMO is off, archetype from response must be the SDK hint (neutral)
    expect(body.archetype).toBe('neutral');
    expect(body.demo_override).toBeUndefined();
  });

  it('AC7a — when DEMO MODE is on, uses override archetype regardless of archetype_hint', async () => {
    mockGetDemoOverride.mockResolvedValue({
      enabled: true,
      overrideArchetype: 'yield_hunter',
      overrideModel: 'claude-haiku-4-5-20251001',
    });

    const res = await POST(makePostRequest({ ...BASE_BODY, archetype_hint: 'neutral' }));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    // DEMO MODE is on — archetype must be yield_hunter not neutral
    expect(body.archetype).toBe('yield_hunter');
    // Confidence must be DEMO_OVERRIDE_CONFIDENCE (0.95)
    expect(body.confidence).toBe(0.95);
  });

  it('AC6 — demo_override flag is true in response when DEMO MODE is on', async () => {
    mockGetDemoOverride.mockResolvedValue({
      enabled: true,
      overrideArchetype: 'family_buyer',
      overrideModel: 'claude-sonnet-4-6',
    });

    const res = await POST(makePostRequest({ ...BASE_BODY }));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.demo_override).toBe(true);
  });

  it('AC6 — demo_override flag is absent in response when DEMO MODE is off', async () => {
    mockGetDemoOverride.mockResolvedValue({
      enabled: false,
      overrideArchetype: null,
      overrideModel: 'claude-sonnet-4-6',
    });

    const res = await POST(makePostRequest({ ...BASE_BODY }));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.demo_override).toBeUndefined();
  });

  it('falls back to SDK hint when getDemoOverride throws (Rule K.2 degrade)', async () => {
    mockGetDemoOverride.mockRejectedValue(new Error('DB connection refused'));

    const res = await POST(makePostRequest({ ...BASE_BODY, archetype_hint: 'downsizer' }));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    // Should fall back to the SDK hint (downsizer) with normal confidence
    expect(body.archetype).toBe('downsizer');
    expect(body.confidence).toBe(0.5);
    expect(body.demo_override).toBeUndefined();
  });
});
