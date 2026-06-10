/**
 * FOLLOW-101 tests for POST /api/adapt — chat-intent shadow prior bridge (AC-1, AC-2, AC-3).
 *
 * Coverage:
 *   AC-1: Redis contains a valid shadow key → response includes chat_intent_dimensions
 *         with flattened (non-null) dimensions.
 *   AC-2: Redis key absent → response has no chat_intent_dimensions field.
 *   AC-3: Redis throws → response proceeds normally with no chat_intent_dimensions
 *         (fail-open).
 *   AC-extra: tax_aware=true → included as 'true' string; null/undefined values omitted.
 *
 * @module apps/control-plane/src/app/api/adapt/route.chat-intent.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Hoisted stubs ────────────────────────────────────────────────────────────

const { mockReadShadowChatIntent } = vi.hoisted(() => ({
  mockReadShadowChatIntent: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Demo JWT bypass — these tests focus on chat-intent logic, not auth.
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

vi.mock('@/lib/bandit-query', () => ({
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
  getDemoOverride: vi.fn().mockResolvedValue({ enabled: false, overrideArchetype: null }),
  DEMO_OVERRIDE_CONFIDENCE: 0.95,
  DEMO_OVERRIDE_SIMILARITY: 0.75,
}));

vi.mock('@/lib/ab-events', () => ({
  publishAbAssignmentEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@estalara/shared', async () => {
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

// Mock the chat-intent cache helper — unit under test is the route, not the cache.
vi.mock('@/lib/chat-intent-cache', () => ({
  readShadowChatIntent: mockReadShadowChatIntent,
  flattenIntentDimensions: (dims: Record<string, unknown>) => {
    // Thin wrapper matching the real implementation for test predictability.
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(dims)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'boolean') {
        if (v) result[k] = 'true';
      } else if (typeof v === 'string' && v.length > 0) {
        result[k] = v;
      }
    }
    return result;
  },
}));

import { POST } from './route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440099';

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
  session_id: 'sess-chat-001',
  page_type: 'listing_detail',
  archetype_hint: 'neutral',
  confidence: 0.5,
  similarity: 0.5,
};

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/adapt — chat-intent shadow bridge (FOLLOW-101)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-1: Redis contains valid shadow key → response includes chat_intent_dimensions', async () => {
    mockReadShadowChatIntent.mockResolvedValue({
      intent_dimensions: {
        purchase_purpose: 'investment',
        geo_priority: 'school_district',
        tax_aware: null, // null → should be omitted
        urgency: null, // null → should be omitted
      },
      archetype_hint: 'yield_hunter',
      confidence: 0.82,
    });

    const res = await POST(makePostRequest(BASE_BODY));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.chat_intent_dimensions).toEqual({
      purchase_purpose: 'investment',
      geo_priority: 'school_district',
    });
  });

  it('AC-1: tax_aware=true → included as string "true"', async () => {
    mockReadShadowChatIntent.mockResolvedValue({
      intent_dimensions: {
        tax_aware: true,
        purchase_purpose: 'investment',
      },
    });

    const res = await POST(makePostRequest(BASE_BODY));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    const dims = body.chat_intent_dimensions as Record<string, string> | undefined;
    expect(dims?.tax_aware).toBe('true');
    expect(dims?.purchase_purpose).toBe('investment');
  });

  it('AC-2: Redis key absent (returns null) → no chat_intent_dimensions in response', async () => {
    mockReadShadowChatIntent.mockResolvedValue(null);

    const res = await POST(makePostRequest(BASE_BODY));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    // Field should be absent (not included when null / empty)
    expect(body.chat_intent_dimensions).toBeUndefined();
  });

  it('AC-3: Redis read throws → response proceeds normally, no chat_intent_dimensions', async () => {
    mockReadShadowChatIntent.mockRejectedValue(new Error('Redis connection timeout'));

    const res = await POST(makePostRequest(BASE_BODY));
    // Response must still be 200 (fail-open)
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.chat_intent_dimensions).toBeUndefined();
    // Standard required fields are present
    expect(typeof body.adapt_decision_id).toBe('string');
    expect(typeof body.archetype).toBe('string');
  });

  it('AC-3: readShadowChatIntent returns shadow with all-null dimensions → no chat_intent_dimensions', async () => {
    mockReadShadowChatIntent.mockResolvedValue({
      intent_dimensions: {
        purchase_purpose: null,
        urgency: null,
        tax_aware: null,
      },
    });

    const res = await POST(makePostRequest(BASE_BODY));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    // All dims were null → flattenIntentDimensions returns {} → field omitted
    expect(body.chat_intent_dimensions).toBeUndefined();
  });
});
