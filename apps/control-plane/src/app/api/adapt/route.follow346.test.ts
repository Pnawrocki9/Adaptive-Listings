/**
 * FOLLOW-346 / FOLLOW-635 tests: chat-intent shadow-read bridge on POST /api/adapt.
 *
 * FOLLOW-635 (CEO ruling, option A, 2026-07-24): the `CHAT_NLP_LIVE` flag was
 * vestigial (it gated a `console.info` only) and has been deleted. There is no
 * server-side gate on this path: `chat_intent_dimensions` is attached
 * unconditionally whenever the Redis shadow key has data, and it IS
 * live-influencing across calls via the SDK's `applyChatIntentPrior` → next-call
 * `archetype_hint` loop (tested in `packages/sdk`), not "shadow-only." This file
 * covers only the server-side POST /api/adapt read+response contract.
 *
 * Coverage:
 *   AC-LIVE-1: chat_intent_dimensions is attached unconditionally (no flag/env
 *              var required) when the shadow key has data, for the CURRENT
 *              request/response — the directive-influence happens on the NEXT
 *              adapt call via the SDK client loop, not on this one.
 *   AC-LIVE-2: shadow key absent → no chat_intent_dimensions, adaptation unchanged.
 *   AC-LIVE-3: No raw chat text fields appear in the adapt response (DPIA C-07).
 *   AC-LIVE-4: Shadow key read failure (fail-open) does not change the directives.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow346.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Hoisted stubs ────────────────────────────────────────────────────────────

const { mockReadShadowChatIntent } = vi.hoisted(() => ({
  mockReadShadowChatIntent: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

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

vi.mock('@/lib/chat-intent-cache', () => ({
  readShadowChatIntent: mockReadShadowChatIntent,
  flattenIntentDimensions: (dims: Record<string, unknown>) => {
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
  session_id: 'sess-follow346-001',
  page_type: 'listing_detail',
  archetype_hint: 'neutral',
  confidence: 0.5,
  similarity: 0.5,
};

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FOLLOW-346 / FOLLOW-635: chat-intent shadow-read bridge (no CHAT_NLP_LIVE gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-LIVE-1: chat_intent_dimensions is attached unconditionally when the shadow key has data', async () => {
    // Shadow key returns intent dimensions
    mockReadShadowChatIntent.mockResolvedValue({
      intent_dimensions: {
        purchase_purpose: 'investment',
        urgency: '0-3mo',
      },
      archetype_hint: 'yield_hunter',
      confidence: 0.8,
    });

    // No CHAT_NLP_LIVE (or any equivalent) env var is set — the flag no longer
    // exists and the read/response is not gated by anything.
    const res = await POST(makePostRequest(BASE_BODY));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);

    // chat_intent_dimensions IS returned (for SDK applyChatIntentPrior)
    expect(body.chat_intent_dimensions).toBeDefined();
    expect((body.chat_intent_dimensions as Record<string, string>).purchase_purpose).toBe(
      'investment',
    );

    // Directives for THIS response are empty because confidence=0.5 is below the
    // 0.6 threshold (no adaptation on this call) — this is unrelated to chat
    // intent; the chat-driven influence happens on the SDK's NEXT adapt() call
    // via archetype_hint (applyChatIntentPrior), not within this request.
    expect(Array.isArray(body.directives)).toBe(true);
    // source is 'default' because confidence=0.5 <= 0.6 threshold
    expect(body.source).toBe('default');
  });

  it('AC-LIVE-2: shadow key absent → no chat_intent_dimensions, adaptation unchanged', async () => {
    mockReadShadowChatIntent.mockResolvedValue(null);

    const res = await POST(makePostRequest(BASE_BODY));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.chat_intent_dimensions).toBeUndefined();
    // Standard adapt response fields are present
    expect(typeof body.adapt_decision_id).toBe('string');
    expect(body.source).toBe('default');
  });

  it('AC-LIVE-3: no raw chat text fields appear in the adapt response (DPIA C-07)', async () => {
    // Shadow key with real intent dimensions
    mockReadShadowChatIntent.mockResolvedValue({
      intent_dimensions: {
        purchase_purpose: 'primary_residence',
        family_stage: 'young_family',
      },
    });

    const res = await POST(makePostRequest(BASE_BODY));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);

    // chat_intent_dimensions must only contain the 12-dim intent vector fields
    const dims = body.chat_intent_dimensions as Record<string, string> | undefined;
    if (dims !== undefined) {
      // Confirm no raw text fields (e.g. 'content', 'message', 'text', 'raw_message')
      const rawTextKeys = ['content', 'message', 'text', 'raw_message', 'chat_text'];
      for (const key of rawTextKeys) {
        expect(dims).not.toHaveProperty(key);
      }
    }
    // The top-level response should not contain raw chat text fields either
    expect(body).not.toHaveProperty('raw_chat_text');
    expect(body).not.toHaveProperty('chat_message_content');
  });

  it('AC-LIVE-4: shadow read failure → fail-open, directives unaffected', async () => {
    mockReadShadowChatIntent.mockRejectedValue(new Error('Upstash timeout'));

    const res = await POST(makePostRequest(BASE_BODY));
    // Must still be 200 (fail-open)
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    // No chat_intent_dimensions when read fails
    expect(body.chat_intent_dimensions).toBeUndefined();
    // Standard response fields still present
    expect(typeof body.adapt_decision_id).toBe('string');
    expect(body.source).toBe('default');
  });
});
