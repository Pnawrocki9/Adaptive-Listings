/**
 * Tests for the pilot_frozen Lane C guard in /api/adapt (FOLLOW-117).
 *
 * Bug fixed: the guard previously checked cfg.quiz_enabled but the quiz config
 * producer (POST /api/quiz/config) writes the field as cfg.enabled. This test
 * verifies that the guard fires when a frozen-pilot tenant has quizConfig.enabled = true.
 *
 * The guard is non-blocking (fire-and-forget, per PILOT_FREEZE_RULE.md §Decision 3).
 * It emits a console.warn when pilot_frozen=true AND any LANE_C_FLAG_KEYS entry is
 * set to true in quizConfig. We assert on the warn call to confirm the guard triggered.
 *
 * @module apps/control-plane/src/app/api/adapt/route.pilot-frozen.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock all external deps ─────────────────────────────────────────────────────

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

vi.mock('@/lib/bandit-query', () => ({
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ]),
}));

vi.mock('@/lib/ab-events', () => ({
  publishAbAssignmentEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/embedding-lookup', () => ({
  fetchListingEmbeddings: vi.fn().mockResolvedValue(new Map()),
  fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
  LISTING_EMBEDDING_BATCH_LIMIT: 50,
}));

// ── DB mock — must be declared before import of route ─────────────────────────

const mockDbSelect = vi.fn();

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: mockDbSelect,
  })),
  tenants: {
    id: 'id',
    pilotFrozen: 'pilot_frozen',
    quizConfig: 'quiz_config',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

import { POST } from './route';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test_token',
    },
    body: JSON.stringify(body),
  });
}

const FROZEN_PILOT_TENANT_ID = 'tenant-frozen-pilot-001';

const VALID_POST_BODY = {
  tenant_id: FROZEN_PILOT_TENANT_ID,
  session_id: 'sess-frozen-001',
  page_type: 'listing_list' as const,
  archetype_hint: 'yield_hunter',
  confidence: 0.8,
  similarity: 0.9,
};

// ── DB mock factory ────────────────────────────────────────────────────────────

/**
 * Configure the DB mock to return a tenant row with the given pilotFrozen flag
 * and quizConfig object.
 */
function setupDbMock(pilotFrozen: boolean, quizConfig: Record<string, unknown>): void {
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ pilotFrozen, quizConfig }]),
      }),
    }),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('pilot_frozen Lane C guard — FOLLOW-117', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress CLICKHOUSE_URL so logDecisionAsync is a no-op in these tests
    vi.stubEnv('CLICKHOUSE_URL', '');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    warnSpy.mockRestore();
  });

  it('pilot_frozen=true + quizConfig.enabled=true → guard emits warn and response is still 200', async () => {
    // Arrange: frozen pilot with quiz widget ON (the field that was wrongly checked as quiz_enabled)
    setupDbMock(true, { enabled: true });

    const res = await POST(makePostRequest(VALID_POST_BODY));

    // The guard is fire-and-forget — response must still be 200 (non-blocking)
    expect(res.status).toBe(200);

    // Allow the fire-and-forget async work to settle
    await new Promise((resolve) => setImmediate(resolve));

    // Assert the warn fired with the correct event name and flag key
    const warnCalls = warnSpy.mock.calls;
    const matchingCall = warnCalls.find((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]);
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(matchingCall).toBeDefined();

    // The logged message must include 'enabled' (the corrected key), not 'quiz_enabled' (the old wrong key)
    const loggedMsg = matchingCall![0] as string;
    const parsed = JSON.parse(loggedMsg) as { active_lane_c_flags: string[] };
    expect(parsed.active_lane_c_flags).toContain('enabled');
    expect(parsed.active_lane_c_flags).not.toContain('quiz_enabled');
  });

  it('pilot_frozen=true + quizConfig.enabled=false → guard does NOT emit warn', async () => {
    // Arrange: frozen pilot, but quiz is OFF — no Lane C flags active
    setupDbMock(true, { enabled: false });

    await POST(makePostRequest(VALID_POST_BODY));
    await new Promise((resolve) => setImmediate(resolve));

    const warnCalls = warnSpy.mock.calls;
    const matchingCall = warnCalls.find((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(matchingCall).toBeUndefined();
  });

  it('pilot_frozen=false + quizConfig.enabled=true → guard does NOT emit warn', async () => {
    // Arrange: pilot NOT frozen — guard should never fire regardless of Lane C flags
    setupDbMock(false, { enabled: true });

    await POST(makePostRequest(VALID_POST_BODY));
    await new Promise((resolve) => setImmediate(resolve));

    const warnCalls = warnSpy.mock.calls;
    const matchingCall = warnCalls.find((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(matchingCall).toBeUndefined();
  });

  it('pilot_frozen=true + quizConfig missing → guard does NOT emit warn (absent flag = safe)', async () => {
    // Arrange: frozen pilot, quizConfig is empty object — no flags set
    setupDbMock(true, {});

    await POST(makePostRequest(VALID_POST_BODY));
    await new Promise((resolve) => setImmediate(resolve));

    const warnCalls = warnSpy.mock.calls;
    const matchingCall = warnCalls.find((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(matchingCall).toBeUndefined();
  });

  it('guard never blocks the response — always returns 200 even when warn fires', async () => {
    setupDbMock(true, { enabled: true, intent_engine_enabled: true });

    const res = await POST(makePostRequest(VALID_POST_BODY));
    // Non-blocking: HTTP response must be 200 regardless
    expect(res.status).toBe(200);
  });
});
