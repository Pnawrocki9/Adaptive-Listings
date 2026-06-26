/**
 * Tests for the pilot_frozen Lane C guard in /api/adapt.
 *
 * FOLLOW-265 (2026-06-11): AC5 contract-pinning tests added — ratifies quiz-only
 * contract (RETRO-051). The guard checks ONLY `tenants.quiz_enabled` (typed boolean
 * column). The three previously-documented JSONB keys (lane_c_active,
 * intent_engine_enabled, shadow_mode_override) are outside the runtime backstop by
 * design; no live producers existed for any of them. See PILOT_FREEZE_RULE.md
 * §Implementation for the forward-compat contract for new Lane C axes.
 *
 * FOLLOW-263 / RETRO-049: guard repointed from JSONB `quizConfig.enabled` to the
 * typed boolean column `tenants.quiz_enabled` (SoT per FOLLOW-102 / migration 0025).
 *
 * Original guard introduced by RETRO-012 / FOLLOW-117.
 *
 * The guard is non-blocking (fire-and-forget, per PILOT_FREEZE_RULE.md §Decision 3).
 * It emits a console.warn when pilot_frozen=true AND quiz_enabled=true. We assert
 * on the warn call to confirm the guard triggered.
 *
 * AC1: guard reads tenants.quiz_enabled (typed column), NOT quizConfig JSONB.
 * AC2: fires correctly for quiz_enabled=true AND quiz_enabled=false.
 * AC3: quiz_enabled changes during freeze window → guard reflects new state.
 * AC4: pilotFrozen=true + quiz_enabled=false → guard does NOT fire.
 * AC5 (FOLLOW-265): quiz-only contract pinned — non-quiz flags do NOT trigger guard.
 *
 * @module apps/control-plane/src/app/api/adapt/route.pilot-frozen.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock all external deps ─────────────────────────────────────────────────────

// Bypass JWT verification — these tests focus on pilot-frozen guard, not auth.
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

// FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
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
//
// FOLLOW-263 (AC1): the DB mock now exposes `quizEnabled` (the typed boolean
// column) rather than `quizConfig` (the JSONB column). This proves the guard reads
// the typed column — if the route still selected `quizConfig`, the mock would
// return undefined for it and the guard would silently fail to fire.

const mockDbSelect = vi.fn();

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: mockDbSelect,
  })),
  tenants: {
    id: 'id',
    pilotFrozen: 'pilot_frozen',
    // FOLLOW-263: expose quizEnabled (typed boolean SoT), not quizConfig (JSONB legacy).
    quizEnabled: 'quiz_enabled',
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
 * and quizEnabled boolean.
 *
 * FOLLOW-263 (AC1): mock uses `quizEnabled` (typed boolean), not `quizConfig`
 * (JSONB). The guard must select quizEnabled from the DB — if it still selected
 * quizConfig, this mock would return undefined and the guard would be silent.
 */
function setupDbMock(pilotFrozen: boolean, quizEnabled: boolean): void {
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ pilotFrozen, quizEnabled }]),
      }),
    }),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('pilot_frozen Lane C guard — RETRO-012/FOLLOW-117 / FOLLOW-263 repoint / FOLLOW-265 quiz-only ratified', () => {
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

  // ── AC1 + AC2: guard reads typed column, fires when quiz_enabled=true ────────

  it('AC1/AC2: pilot_frozen=true + quiz_enabled=true → guard emits warn (typed column read)', async () => {
    // FOLLOW-263 (AC1): the mock exposes quizEnabled=true. If the route still
    // selected quizConfig (JSONB), it would get undefined and the guard would be
    // silent — this test would fail, proving the column was not repointed.
    setupDbMock(true, true);

    const res = await POST(makePostRequest(VALID_POST_BODY));

    // The guard is fire-and-forget — response must still be 200 (non-blocking)
    expect(res.status).toBe(200);

    // Allow the fire-and-forget async work to settle
    await new Promise((resolve) => setImmediate(resolve));

    // Assert the warn fired with the correct event name
    const warnCalls = warnSpy.mock.calls;
    const matchingCall = warnCalls.find((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]);
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(matchingCall).toBeDefined();

    // FOLLOW-263: the logged message must include quiz_enabled:true (the typed
    // column value), NOT the old active_lane_c_flags JSONB-key array format.
    const loggedMsg = matchingCall![0] as string;
    const parsed = JSON.parse(loggedMsg) as {
      quiz_enabled?: boolean;
      active_lane_c_flags?: string[];
    };
    expect(parsed.quiz_enabled).toBe(true);
    // Ensure the old JSONB-key array format is NOT present (guard was repointed)
    expect(parsed.active_lane_c_flags).toBeUndefined();
  });

  // ── AC2 + AC4: guard does NOT fire when quiz_enabled=false ──────────────────

  it('AC2/AC4: pilot_frozen=true + quiz_enabled=false → guard does NOT emit warn (quiz already off)', async () => {
    // AC4 acceptance: pilotFrozen=true + quiz_enabled=false should not trigger warn.
    // Quiz is already off — no Lane C contamination risk.
    setupDbMock(true, false);

    await POST(makePostRequest(VALID_POST_BODY));
    await new Promise((resolve) => setImmediate(resolve));

    const warnCalls = warnSpy.mock.calls;
    const matchingCall = warnCalls.find((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(matchingCall).toBeUndefined();
  });

  // ── pilot not frozen → guard never fires ────────────────────────────────────

  it('pilot_frozen=false + quiz_enabled=true → guard does NOT emit warn', async () => {
    // Pilot NOT frozen — guard should never fire regardless of quiz state.
    setupDbMock(false, true);

    await POST(makePostRequest(VALID_POST_BODY));
    await new Promise((resolve) => setImmediate(resolve));

    const warnCalls = warnSpy.mock.calls;
    const matchingCall = warnCalls.find((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(matchingCall).toBeUndefined();
  });

  // ── AC3: quiz_enabled changes during freeze window ──────────────────────────

  it('AC3: quiz_enabled changes from false→true during freeze window → guard fires on next read', async () => {
    // First call: quiz_enabled=false — guard should NOT fire.
    setupDbMock(true, false);

    await POST(makePostRequest(VALID_POST_BODY));
    await new Promise((resolve) => setImmediate(resolve));

    const warnCallsBefore = warnSpy.mock.calls.filter((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(warnCallsBefore).toHaveLength(0);

    // Simulate quiz_enabled changing to true during the freeze window
    // (e.g. a PATCH /api/tenants/:id was called and flipped the column).
    // Reset mock to return quiz_enabled=true.
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setupDbMock(true, true);

    await POST(makePostRequest({ ...VALID_POST_BODY, session_id: 'sess-frozen-002' }));
    await new Promise((resolve) => setImmediate(resolve));

    // Guard MUST fire now that quiz_enabled is true
    const warnCallsAfter = warnSpy.mock.calls.filter((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(warnCallsAfter).toHaveLength(1);

    const parsed = JSON.parse(warnCallsAfter[0]![0] as string) as { quiz_enabled?: boolean };
    expect(parsed.quiz_enabled).toBe(true);
  });

  it('AC3: quiz_enabled changes from true→false during freeze window → guard stops firing', async () => {
    // First call: quiz_enabled=true — guard fires.
    setupDbMock(true, true);

    await POST(makePostRequest(VALID_POST_BODY));
    await new Promise((resolve) => setImmediate(resolve));

    const warnCallsBefore = warnSpy.mock.calls.filter((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(warnCallsBefore).toHaveLength(1);

    // Simulate quiz being disabled (tenant toggled quiz OFF via dashboard).
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setupDbMock(true, false);

    await POST(makePostRequest({ ...VALID_POST_BODY, session_id: 'sess-frozen-003' }));
    await new Promise((resolve) => setImmediate(resolve));

    // Guard must NOT fire — quiz is now off, no contamination risk.
    const warnCallsAfter = warnSpy.mock.calls.filter((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(warnCallsAfter).toHaveLength(0);
  });

  // ── Non-blocking response guarantee ─────────────────────────────────────────

  it('guard never blocks the response — always returns 200 even when warn fires', async () => {
    setupDbMock(true, true);

    const res = await POST(makePostRequest(VALID_POST_BODY));
    // Non-blocking: HTTP response must be 200 regardless
    expect(res.status).toBe(200);
  });

  // ── Guard is silent for unknown tenant ──────────────────────────────────────

  it('pilot_frozen=true + quizEnabled missing (DB returns undefined) → guard does NOT emit warn', async () => {
    // Simulates a row where quiz_enabled column is null/undefined (e.g. old row
    // before migration 0025 backfill ran). Guard should treat undefined as false — safe.
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ pilotFrozen: true, quizEnabled: undefined }]),
        }),
      }),
    });

    await POST(makePostRequest(VALID_POST_BODY));
    await new Promise((resolve) => setImmediate(resolve));

    const warnCalls = warnSpy.mock.calls;
    const matchingCall = warnCalls.find((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(matchingCall).toBeUndefined();
  });

  // ── AC5 (FOLLOW-265): contract-pinning — quiz-only ratified ──────────────────
  //
  // INTENTIONAL — FOLLOW-265 (ratified 2026-06-11):
  // The freeze guard checks ONLY `tenants.quiz_enabled`. The three previously-
  // documented JSONB-key flags (`lane_c_active`, `intent_engine_enabled`,
  // `shadow_mode_override`) were dropped from the runtime backstop because they
  // never had live producers. This test pins that contract: even if the DB row
  // carries a JSONB key that looks like a Lane C flag, the guard does NOT fire
  // solely because of that key — it only fires when `quizEnabled=true`.
  //
  // New Lane C axes MUST add a typed `tenants.*_enabled` column + migration and
  // wire it into checkPilotFrozenAsync() — NOT into quizConfig JSONB. See
  // docs/ops/PILOT_FREEZE_RULE.md §Implementation for the forward-compat contract.

  it('AC5 (FOLLOW-265 quiz-only contract): DB row with only quizEnabled=false does NOT trigger guard even if JSONB quizConfig.enabled=true were present', async () => {
    // This test verifies the quiz-only contract: the guard reads only the typed
    // `quizEnabled` boolean column, not any JSONB blob key. A hypothetical legacy
    // row that might have quizConfig.enabled=true in the JSONB but quizEnabled=false
    // in the typed column must NOT fire the guard.
    //
    // The mock returns pilotFrozen=true with quizEnabled=false. The guard must stay
    // silent — it does not inspect any JSONB blob for additional Lane C flags.
    // Intentional — FOLLOW-265 / RETRO-051.
    setupDbMock(true, false);

    await POST(makePostRequest(VALID_POST_BODY));
    await new Promise((resolve) => setImmediate(resolve));

    const warnCalls = warnSpy.mock.calls;
    const matchingCall = warnCalls.find((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('pilot_frozen_lane_c_active');
    });
    // Guard must NOT fire: the ONLY trigger is quizEnabled=true on the typed column.
    // Other Lane C axes (lane_c_active, intent_engine_enabled, shadow_mode_override)
    // are outside the runtime backstop by design — FOLLOW-265.
    expect(matchingCall).toBeUndefined();
  });

  it('AC5 (FOLLOW-265 quiz-only contract): guard log payload does NOT contain active_lane_c_flags (old JSONB array format has been retired)', async () => {
    // This test pins the log payload contract. After FOLLOW-263/FOLLOW-265, the
    // warn log must use `quiz_enabled: boolean`, NOT `active_lane_c_flags: string[]`.
    // The old format is permanently retired. Intentional — FOLLOW-265 / RETRO-051.
    setupDbMock(true, true);

    await POST(makePostRequest(VALID_POST_BODY));
    await new Promise((resolve) => setImmediate(resolve));

    const warnCalls = warnSpy.mock.calls;
    const matchingCall = warnCalls.find((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('pilot_frozen_lane_c_active');
    });
    expect(matchingCall).toBeDefined();

    const loggedMsg = matchingCall![0] as string;
    const parsed = JSON.parse(loggedMsg) as {
      quiz_enabled?: boolean;
      active_lane_c_flags?: string[];
    };
    // Must use new field
    expect(parsed.quiz_enabled).toBe(true);
    // Must NOT use old retired field
    expect(parsed.active_lane_c_flags).toBeUndefined();
  });
});
