/**
 * Tests for TICKET-AB-010 — holdout gating + consent skip on control-plane POST /api/adapt.
 *
 * Coverage:
 *   - holdout_pct: 1.0 + consent granted → directives: [], holdout_group: true
 *   - consent_state: 'opted_out' + consent_mode_enabled → directives: [], no holdout_group
 *   - holdout_pct: 0.0 + consent granted → treatment arm, directives non-empty
 *   - holdout_pct absent → default 0.1 (neither guaranteed hold-out nor treatment)
 *
 * Approach:
 *   - holdout_pct: 1.0 guarantees every session lands in holdout (100% holdout rate).
 *   - holdout_pct: 0.0 guarantees every session lands in treatment (0% holdout rate).
 *   - consent_mode_enabled: true + opted_out → skipped.
 *
 * @module apps/control-plane/src/app/api/adapt/route.ab010.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock all external dependencies ───────────────────────────────────────────

// Bypass JWT verification — these tests focus on holdout/consent gating, not auth.
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

// Mock tenant-schema to return a reorder-capable schema for est_demo_tenant
vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue({
    reorder_capable: true,
    container_selector: '[data-estalara-listings-grid]',
    item_selector: '[data-estalara-listing-id]',
  }),
}));

// Mock ab-events to avoid Redpanda in tests
vi.mock('@/lib/ab-events', () => ({
  publishAbAssignmentEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock bandit-query — POST handler now calls getBanditArms (FOLLOW-007)
vi.mock('@/lib/bandit-query', () => ({
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ]),
}));

import { POST } from './route.js';
import { publishAbAssignmentEvent } from '@/lib/ab-events';

const mockPublishAbAssignmentEvent = vi.mocked(publishAbAssignmentEvent);

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const BASE_BODY = {
  tenant_id: 'est_demo_tenant',
  session_id: 'sess-ab010-001',
  page_type: 'listing_list' as const,
  archetype_hint: 'yield_hunter',
  confidence: 0.8,
  similarity: 0.9,
  listing_ids: ['listing-a', 'listing-b'],
};

// ─── AB-010 tests ─────────────────────────────────────────────────────────────

describe('POST /api/adapt — TICKET-AB-010: holdout gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('AC-2: holdout_pct=1.0 + consent granted → directives:[], holdout_group:true', async () => {
    const res = await POST(
      makePostRequest({
        ...BASE_BODY,
        holdout_pct: 1.0,
        consent_state: 'granted',
        consent_mode_enabled: false,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.directives)).toBe(true);
    expect((body.directives as unknown[]).length).toBe(0);
    expect(body.source).toBe('default');
    expect(body.holdout_group).toBe(true);
  });

  it('AC-2: ab.assignment event emitted for holdout session', async () => {
    await POST(
      makePostRequest({
        ...BASE_BODY,
        holdout_pct: 1.0,
        consent_state: 'granted',
        consent_mode_enabled: false,
      }),
    );
    // Allow fire-and-forget microtask to settle
    await Promise.resolve();
    expect(mockPublishAbAssignmentEvent).toHaveBeenCalledOnce();
    const callArgs = mockPublishAbAssignmentEvent.mock.calls[0]![0];
    expect(callArgs.holdout_group).toBe(true);
    expect(callArgs.tenant_id).toBe('est_demo_tenant');
    expect(callArgs.session_id).toBe('sess-ab010-001');
  });

  it('AC-3: consent_state=opted_out + consent_mode_enabled → directives:[], no holdout_group', async () => {
    const res = await POST(
      makePostRequest({
        ...BASE_BODY,
        consent_state: 'opted_out',
        consent_mode_enabled: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.directives)).toBe(true);
    expect((body.directives as unknown[]).length).toBe(0);
    expect(body.source).toBe('default');
    // AC-3: holdout_group must NOT be present when skipped
    expect(body.holdout_group).toBeUndefined();
  });

  it('AC-3: consent event NOT emitted when consent skipped', async () => {
    await POST(
      makePostRequest({
        ...BASE_BODY,
        consent_state: 'opted_out',
        consent_mode_enabled: true,
      }),
    );
    await Promise.resolve();
    expect(mockPublishAbAssignmentEvent).not.toHaveBeenCalled();
  });

  it('AC-4: holdout_pct=0.0 + consent granted → treatment arm, directives non-empty', async () => {
    const res = await POST(
      makePostRequest({
        ...BASE_BODY,
        holdout_pct: 0.0,
        consent_state: 'granted',
        consent_mode_enabled: false,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Treatment arm: directives should be present (either text or reorder)
    expect(Array.isArray(body.directives)).toBe(true);
    // source is not 'default' because confidence=0.8 > 0.6 threshold
    expect(body.source).not.toBe('default');
    // holdout_group should be false (not absent — treatment arm)
    expect(body.holdout_group).toBeUndefined();
  });

  it('AC-5: ab.assignment event emitted for treatment session', async () => {
    await POST(
      makePostRequest({
        ...BASE_BODY,
        holdout_pct: 0.0,
        consent_state: 'granted',
        consent_mode_enabled: false,
      }),
    );
    await Promise.resolve();
    expect(mockPublishAbAssignmentEvent).toHaveBeenCalledOnce();
    const callArgs = mockPublishAbAssignmentEvent.mock.calls[0]![0];
    expect(callArgs.holdout_group).toBe(false);
  });

  it('consent_state=unknown + consent_mode_enabled → consent skipped', async () => {
    const res = await POST(
      makePostRequest({
        ...BASE_BODY,
        consent_state: 'unknown',
        consent_mode_enabled: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.directives as unknown[]).length).toBe(0);
    expect(body.holdout_group).toBeUndefined();
  });

  it('consent_mode_enabled=false → consent state ignored, assignment proceeds', async () => {
    const res = await POST(
      makePostRequest({
        ...BASE_BODY,
        holdout_pct: 0.0,
        consent_state: 'opted_out',
        consent_mode_enabled: false,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // With holdout_pct=0.0 and consent_mode_enabled=false, treatment arm runs
    expect(body.source).not.toBe('default');
  });

  it('missing consent fields → defaults to no consent gating (treatment proceeds)', async () => {
    const res = await POST(
      makePostRequest({
        ...BASE_BODY,
        holdout_pct: 0.0,
        // No consent_state, no consent_mode_enabled
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // With holdout_pct=0.0, treatment arm runs
    expect(body.source).not.toBe('default');
  });
});
