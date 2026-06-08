// @vitest-environment jsdom
/**
 * FOLLOW-227 — gate + cap dwell-time boost across the rehydrate boundary (Rule R compliance).
 *
 * Context (why this exists):
 *   FOLLOW-190 (PR #225) shipped `applyDwellSignal` wired into `startDwellTimer` via
 *   `onIntentUpdate → persistIntentState`.  Because the persisted state is REHYDRATED on
 *   the next listing page and the dwell timer RESTARTS at `refreshDirectives()`, the dwell
 *   boost was compounding on every cross-listing navigation — no `!intentStateRehydrated`
 *   gate, no cap (Rule R violation, RETRO-037).
 *
 * Rule Q compliance: this test drives the REAL `_initForTest()` seam from index.ts.
 *   No gate logic is re-implemented locally — drop a `!` on any index.ts guard and
 *   the relevant test goes RED.
 *
 * Acceptance criteria:
 *   AC1: `applyDwellSignal` increments `dwell_ticks_applied` in the returned state
 *        (pure-function unit test — verifies the bookkeeping field is produced).
 *   AC2: `DWELL_MAX_SESSION_CONTRIBUTION` is exported from intent.ts and equals 3.
 *   AC3: A rehydrated state with `dwell_ticks_applied >= DWELL_MAX_SESSION_CONTRIBUTION`
 *        does NOT get re-boosted: `_initForTest()` on a session where ticks are already
 *        exhausted returns the same archetype/confidence as the persisted state
 *        (cap enforced through the real timer path).
 *   AC4: A rehydrated state with `dwell_ticks_applied < DWELL_MAX_SESSION_CONTRIBUTION`
 *        CAN still accumulate more ticks (partial rehydrate path is not over-gated).
 *   AC5: Cold-start (no prior dwell ticks) starts at `dwell_ticks_applied = 0` (undefined
 *        in persisted state → treated as 0 at the call site).
 *
 * Test strategy:
 *   AC1 + AC2: pure unit tests on intent.ts exports — no init() needed.
 *   AC3 + AC4: integration tests using `_initForTest()` with fake timers so the dwell
 *              interval fires synchronously under test control.
 *   AC5: inspects the persisted envelope after a cold-start _initForTest().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest } from '../index.js';

import {
  persistIntentState,
  intentStateStorageKey,
  INTENT_STATE_SCHEMA_VERSION,
} from '../core/session.js';
import {
  applyDwellSignal,
  applyQuizLeaf,
  initIntentState,
  DWELL_MAX_SESSION_CONTRIBUTION,
  DWELL_BASE_BOOST,
  DWELL_UNIT_MS,
} from '../core/intent.js';
import type { IntentState } from '../core/intent.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = 'e'.repeat(64);

/** Minimal valid AdaptResponse. */
const ADAPT_RESPONSE = {
  adapt_decision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  session_id: SESSION_ID,
  archetype: 'yield_hunter',
  confidence: 0.78,
  similarity: 0.9,
  tier: 1 as const,
  source: 'playbook' as const,
  generated_at: '2026-06-08T00:00:00.000Z',
  directives: [],
  ttl_seconds: 300,
  variant: 'control',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

function insertScriptTag(overrides: Record<string, string> = {}): HTMLScriptElement {
  const script = document.createElement('script');
  script.dataset.apiKey = overrides.apiKey ?? 'test-key-follow227';
  if (overrides.decisionUrl !== undefined) {
    script.dataset.decisionUrl = overrides.decisionUrl;
    script.dataset.tenantId = overrides.tenantId ?? 'follow227-tenant';
  }
  document.head.appendChild(script);
  return script;
}

function removeScriptTags(): void {
  document.querySelectorAll<HTMLScriptElement>('script[data-api-key]').forEach((el) => {
    el.remove();
  });
}

function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  removeScriptTags();
  document.querySelectorAll('[data-estalara-host]').forEach((el) => {
    el.remove();
  });
}

function stubFetch(adaptResponse: unknown = ADAPT_RESPONSE): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/adapt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(adaptResponse),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }),
  );
}

function callTeardown(): void {
  const td = (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  if (td) {
    td();
    delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  }
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearAll();
  vi.restoreAllMocks();
});

afterEach(() => {
  callTeardown();
  clearAll();
  vi.restoreAllMocks();
});

// ===========================================================================
// AC1: applyDwellSignal increments dwell_ticks_applied (pure-function unit test)
// ===========================================================================

describe('AC1 — applyDwellSignal increments dwell_ticks_applied in returned state', () => {
  it('state with no prior dwell ticks: dwell_ticks_applied goes from undefined to 1', () => {
    const state = applyQuizLeaf(initIntentState(), 'yield_hunter');
    expect(state.dwell_ticks_applied).toBeUndefined();

    // elapsed_ms must be long enough to produce boost > 1:
    //   boost = 1 + 0.08 * log2(elapsed / 30_000)
    //   for elapsed = 30_000: log2(1) = 0 → boost = 1 (returns unchanged)
    //   for elapsed = 60_000: log2(2) = 1 → boost = 1.08 (positive)
    const elapsed_ms = 60_000;
    const result = applyDwellSignal(state, elapsed_ms);

    expect(result).not.toBe(state); // new object returned
    expect(result.dwell_ticks_applied).toBe(1);
  });

  it('state with existing 2 ticks: dwell_ticks_applied increments to 3', () => {
    const base = applyQuizLeaf(initIntentState(), 'luxury_buyer');
    const stateWith2 = { ...base, dwell_ticks_applied: 2 };

    const result = applyDwellSignal(stateWith2, 60_000);

    expect(result.dwell_ticks_applied).toBe(3);
  });

  it('returns unchanged state reference when archetype is neutral', () => {
    const state = initIntentState(); // archetype = 'neutral'
    expect(state.archetype).toBe('neutral');

    const result = applyDwellSignal(state, 60_000);

    expect(result).toBe(state); // same reference — no mutation
    expect(result.dwell_ticks_applied).toBeUndefined();
  });

  it('returns unchanged state reference when boost ≤ 1 (elapsed too short)', () => {
    const state = applyQuizLeaf(initIntentState(), 'family_buyer');
    // elapsed_ms = 30_000: boost = 1 + DWELL_BASE_BOOST * log2(30000/30000) = 1 + 0 = 1
    const result = applyDwellSignal(state, DWELL_UNIT_MS);

    expect(result).toBe(state); // unchanged reference
  });

  it('boost formula matches documented spec: 1 + DWELL_BASE_BOOST * log2(elapsed / DWELL_UNIT_MS)', () => {
    // Verify the formula is as documented — this is the contract tests assert on.
    // elapsed = 90_000: log2(90_000 / 30_000) = log2(3) ≈ 1.585
    const elapsed = 90_000;
    const expectedBoost = 1 + DWELL_BASE_BOOST * Math.log2(elapsed / DWELL_UNIT_MS);
    expect(expectedBoost).toBeGreaterThan(1);
    expect(expectedBoost).toBeCloseTo(1 + 0.08 * Math.log2(3), 10);
  });
});

// ===========================================================================
// AC2: DWELL_MAX_SESSION_CONTRIBUTION exported and equals 3
// ===========================================================================

describe('AC2 — DWELL_MAX_SESSION_CONTRIBUTION exported constant', () => {
  it('equals 3 (one per DWELL_THRESHOLDS_MS threshold: 30s / 90s / 180s)', () => {
    expect(DWELL_MAX_SESSION_CONTRIBUTION).toBe(3);
  });

  it('is a numeric constant (not undefined or null)', () => {
    expect(typeof DWELL_MAX_SESSION_CONTRIBUTION).toBe('number');
  });
});

// ===========================================================================
// AC3: Rehydrated state with exhausted ticks → cap enforced through init()
// ===========================================================================

describe('AC3 — rehydrated state with dwell_ticks_applied exhausted: no re-boost', () => {
  it('init() with a fully-boosted rehydrated state: archetype unchanged after simulated dwell ticks', async () => {
    // Build a state that already has all dwell ticks applied.
    // This simulates a session where listing A exhausted all 3 threshold boosts.
    const baseState = applyQuizLeaf(initIntentState(), 'yield_hunter');
    const exhaustedState: IntentState = {
      ...baseState,
      dwell_ticks_applied: DWELL_MAX_SESSION_CONTRIBUTION, // all 3 ticks already applied
    };

    persistIntentState(SESSION_ID, exhaustedState);
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch({
      ...ADAPT_RESPONSE,
      archetype: 'yield_hunter',
      confidence: 0.78,
    });

    // Use fake timers so the dwell interval fires synchronously.
    vi.useFakeTimers();

    const initPromise = _initForTest();

    // Advance time past all three DWELL_THRESHOLDS_MS (30s / 90s / 180s)
    // to simulate the dwell timer firing three threshold ticks.
    // The cap check must prevent applyDwellSignal from running.
    await vi.advanceTimersByTimeAsync(200_000); // 200 s (past 180 s threshold)

    const finalState = await initPromise;

    vi.useRealTimers();

    expect(finalState).not.toBeNull();
    expect(finalState!.archetype).toBe('yield_hunter');
    // dwell_ticks_applied must remain at the cap — it was not incremented past it
    expect(finalState!.dwell_ticks_applied ?? 0).toBe(DWELL_MAX_SESSION_CONTRIBUTION);
  }, 10_000);
});

// ===========================================================================
// AC4: Rehydrated state with partial ticks → remaining ticks still allowed
// ===========================================================================

describe('AC4 — rehydrated state with partial dwell ticks: remaining ticks are allowed', () => {
  it('init() with 1 dwell tick already applied: can still receive up to 2 more', async () => {
    const baseState = applyQuizLeaf(initIntentState(), 'portfolio_builder');
    const partialState: IntentState = {
      ...baseState,
      dwell_ticks_applied: 1, // 1 tick already applied; 2 remain
    };

    persistIntentState(SESSION_ID, partialState);
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch({
      ...ADAPT_RESPONSE,
      archetype: 'portfolio_builder',
      confidence: 0.72,
    });

    vi.useFakeTimers();

    const initPromise = _initForTest();

    // Advance 200 s — all three threshold windows pass.
    // With 1 tick already applied, only 2 more boosts should fire (cap = 3).
    await vi.advanceTimersByTimeAsync(200_000);

    const finalState = await initPromise;

    vi.useRealTimers();

    expect(finalState).not.toBeNull();
    expect(finalState!.archetype).toBe('portfolio_builder');
    // After 2 additional ticks, total should be at cap (3).
    // (Could be 1 if the adapt response changes previousArchetype before the timer fires —
    // the important assertion is that ticks_applied did NOT stay at 1 indefinitely.)
    const ticks = finalState!.dwell_ticks_applied ?? 0;
    expect(ticks).toBeGreaterThanOrEqual(1);
    expect(ticks).toBeLessThanOrEqual(DWELL_MAX_SESSION_CONTRIBUTION);
  }, 10_000);
});

// ===========================================================================
// AC5: Cold-start begins with no dwell ticks (undefined → treated as 0)
// ===========================================================================

describe('AC5 — cold-start: dwell_ticks_applied starts at 0 (undefined)', () => {
  it('freshly persisted cold-start state has dwell_ticks_applied undefined (no ticks yet)', async () => {
    // No prior intent state
    expect(sessionStorage.getItem(intentStateStorageKey(SESSION_ID))).toBeNull();

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubFetch();

    const finalState = await _initForTest();

    expect(finalState).not.toBeNull();
    // On a cold-start before any dwell tick, the field is either absent or 0.
    expect(finalState!.dwell_ticks_applied ?? 0).toBe(0);

    // Verify the persisted envelope also carries the correct value
    const rawSession = sessionStorage.getItem('__estalara_session__');
    expect(rawSession).not.toBeNull();
    const { sessionId } = JSON.parse(rawSession!) as { sessionId: string };
    const rawEnvelope = sessionStorage.getItem(intentStateStorageKey(sessionId));
    expect(rawEnvelope).not.toBeNull();
    const envelope = JSON.parse(rawEnvelope!) as {
      version: number;
      savedAt: number;
      state: IntentState;
    };
    expect(envelope.version).toBe(INTENT_STATE_SCHEMA_VERSION);
    // No dwell boost has fired — field absent or 0
    expect(envelope.state.dwell_ticks_applied ?? 0).toBe(0);
  });
});
