// @vitest-environment jsdom
/**
 * FOLLOW-229 — index.ts dwell-wiring integration test through the _initForTest() seam.
 *
 * Context (why this exists):
 *   FOLLOW-190 (PR #225) shipped `applyDwellSignal` wired into `startDwellTimer` via
 *   `onIntentUpdate → persistIntentState`, and FOLLOW-227 (PR #226) added the
 *   `dwell_ticks_applied` field + `DWELL_MAX_SESSION_CONTRIBUTION` cap.  The 41 unit
 *   tests in `follow-190.test.ts` exercise the pure-function helpers, but ZERO tests
 *   drive the `index.ts` timer wiring (start/stop/firedThresholds/visibility/persist) —
 *   the surface where LG-1/LG-2/LG-3 and the HALF_WIRE_P live.  The same gap existed
 *   for FOLLOW-217 priors (RETRO-032 TG-1 / RETRO-034); this file closes it for dwell.
 *
 * Rule Q (amended 2026-06-08): this test MUST import and invoke `_initForTest()` — a
 *   real exported seam from index.ts that calls the production `init()` body.  No gate
 *   logic is re-implemented locally.  Dropping a `!` on any real gate in index.ts causes
 *   the relevant test here to go RED.
 *
 * Rule R (2026-06-08): any intent-state mutation that flows into persistIntentState must
 *   be gated behind `!intentStateRehydrated` OR be idempotent under rehydration.  The
 *   dwell boost uses the second strategy (per-session cap via dwell_ticks_applied).
 *   This file asserts both strategies are enforced end-to-end through `init()`.
 *
 * Observation model:
 *   `_initForTest()` returns `currentIntentState` at init()-exit time — BEFORE any dwell
 *   timer tick fires (the setInterval is a side-effect registered AFTER init() returns
 *   `currentIntentState`).  Observable state after timer ticks is in sessionStorage:
 *   the timer callback calls `applyDwellSignal → onIntentUpdate → persistIntentState`.
 *
 *   Critical precondition for observable ticks:
 *     The timer callback contains the guard `if (currentIntentState.archetype === 'neutral') return`.
 *     Dwell ticks only fire when the Bayesian intent engine (NOT the Decision API response)
 *     shows a non-neutral archetype.  A cold-start session with only device_type priors
 *     remains neutral (BASE_PRIOR gives neutral 37% vs 4% per archetype × small damping).
 *     Therefore, timer-tick tests use a REHYDRATED non-neutral state (e.g. quiz-answered
 *     'yield_hunter') so the guard allows the tick to proceed.
 *
 *   Test pattern:
 *     1. Persist a quiz-answered, non-neutral IntentState to sessionStorage (listing-A stub).
 *     2. Set localStorage `estalara_consent = 'granted'`.
 *     3. Insert <script data-api-key data-decision-url data-tenant-id>.
 *     4. Stub fetch to return the SAME archetype as the rehydrated state.
 *     5. vi.useFakeTimers() BEFORE _initForTest().
 *     6. Start _initForTest() (not awaited yet).
 *     7. vi.advanceTimersByTimeAsync(N) — flushes Promise micro-tasks + fires interval.
 *     8. await initPromise.
 *     9. Read sessionStorage[intentStateStorageKey(SESSION_ID)] for post-tick state.
 *
 * Acceptance criteria:
 *   AC1: `_initForTest()` + mocked Decision API returning a non-neutral archetype on a
 *        rehydrated non-neutral session: the dwell timer fires after `refreshDirectives()`
 *        completes.  Observable via sessionStorage: after advancing 35 s, the persisted
 *        envelope's `dwell_ticks_applied` is ≥ 1.
 *   AC2: `applyDwellSignal` is called through the REAL wired path — `dwell_ticks_applied`
 *        in sessionStorage advances from 0 to ≥ 1 without calling `applyDwellSignal`
 *        directly.  The `signal_count` field in the persisted state does NOT increment
 *        alongside the tick (dwell is continuous, not a discrete signal).
 *   AC3: `DWELL_MAX_SESSION_CONTRIBUTION` cap enforced through the REAL `init()` path:
 *        after advancing past all three DWELL_THRESHOLDS_MS, `dwell_ticks_applied` in
 *        sessionStorage is ≤ `DWELL_MAX_SESSION_CONTRIBUTION`.
 *   AC4: `stopDwellTimer()` fires on a `visibilitychange`→hidden event dispatched through
 *        the real `init()` listener: hiding the page before the first threshold window
 *        results in 0 ticks even after advancing past all thresholds.
 *   AC5: Mutation tests:
 *        (a) `!intentStateRehydrated` gate — dropped gate causes signal_count to increment
 *            on a rehydrated session (asserted to stay unchanged with gate in place).
 *        (b) `DWELL_MAX_SESSION_CONTRIBUTION` cap — exhausted rehydrated state stays at
 *            cap even after advancing past all thresholds (cap check enforced via init()).
 *        (c) Neutral archetype guard — Decision API neutral response → 0 ticks.
 *
 * Environment: jsdom (real DOM, real sessionStorage, real localStorage).
 * fetch: mocked via vi.stubGlobal.
 * Timers: vi.useFakeTimers() / vi.useRealTimers() per test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest } from '../index.js';

import {
  persistIntentState,
  rehydrateIntentState,
  intentStateStorageKey,
  INTENT_STATE_SCHEMA_VERSION,
} from '../core/session.js';
import { applyQuizLeaf, initIntentState, DWELL_MAX_SESSION_CONTRIBUTION } from '../core/intent.js';
import type { IntentState } from '../core/intent.js';

// ---------------------------------------------------------------------------
// Constants — mirror the non-exported values from index.ts.  Not imported
// directly (module-private); tests drive behaviour against them.
// ---------------------------------------------------------------------------

/**
 * index.ts DWELL_TICK_MS = 5_000.
 * Used in the hide-before-threshold test to advance exactly N tick intervals.
 */
const TICK_MS = 5_000;

/**
 * Well past all three thresholds (30 s / 90 s / 180 s).
 * Most timer tests use this rather than exact threshold advances because the
 * exact moment startDwellTimer() is called depends on when the Promise micro-task
 * chain completes relative to the fake-time advance (start-time jitter).  200 s
 * covers all three threshold windows regardless of jitter.
 */
const PAST_ALL_THRESHOLDS = 200_000;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = 'f'.repeat(64);

/**
 * Minimal AdaptResponse for a non-neutral archetype.
 * The archetype MUST match the rehydrated intent state archetype so that
 * previousArchetype changes (null → 'yield_hunter') → startDwellTimer() is called.
 *
 * Note: the Bayesian intent state archetype (not the API response archetype) is what
 * the timer callback checks.  For ticks to fire, currentIntentState.archetype must be
 * non-neutral, which comes from the rehydrated quiz-answered state.
 */
const ADAPT_RESPONSE_YIELD = {
  adapt_decision_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  session_id: SESSION_ID,
  archetype: 'yield_hunter',
  confidence: 0.79,
  similarity: 0.91,
  tier: 1 as const,
  source: 'playbook' as const,
  generated_at: '2026-06-08T00:00:00.000Z',
  directives: [],
  ttl_seconds: 300,
  variant: 'control',
};

/** Neutral AdaptResponse — must NOT trigger startDwellTimer. */
const ADAPT_RESPONSE_NEUTRAL = {
  ...ADAPT_RESPONSE_YIELD,
  archetype: 'neutral',
  confidence: 0.37,
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
  script.dataset.apiKey = overrides.apiKey ?? 'test-key-follow229';
  if (overrides.decisionUrl !== undefined) {
    script.dataset.decisionUrl = overrides.decisionUrl;
    script.dataset.tenantId = overrides.tenantId ?? 'follow229-tenant';
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

function stubFetch(adaptResponse: unknown = ADAPT_RESPONSE_YIELD): void {
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

/**
 * Seed a quiz-answered non-neutral intent state into sessionStorage.
 *
 * Required precondition for timer-tick tests: the timer callback has a guard
 * `if (currentIntentState.archetype === 'neutral') return`.  A cold-start session
 * with only device_type priors stays neutral (BASE_PRIOR neutral=37% >> 4% × damping).
 * Seeding a quiz-answered state gives currentIntentState a dominant non-neutral archetype
 * so the guard allows ticks to proceed.
 *
 * Also, `dwell_ticks_applied` is set to 0 explicitly so we can observe it increase.
 */
function seedNonNeutralState(
  archetype: 'yield_hunter' | 'portfolio_builder' | 'family_buyer' = 'yield_hunter',
): IntentState {
  const base = applyQuizLeaf(initIntentState(), archetype);
  const state: IntentState = { ...base, dwell_ticks_applied: 0 };
  persistIntentState(SESSION_ID, state);
  return state;
}

/**
 * Read the dwell_ticks_applied value from the persisted sessionStorage envelope.
 *
 * This is the canonical observation path for timer-driven dwell mutations.
 * `_initForTest()` returns currentIntentState at init()-exit (before any tick fires).
 * Subsequent interval callbacks call `onIntentUpdate → persistIntentState`, so
 * sessionStorage carries the post-tick state.
 */
function readPersistedTicks(sessionId: string): number {
  const raw = sessionStorage.getItem(intentStateStorageKey(sessionId));
  if (!raw) return 0;
  const envelope = JSON.parse(raw) as { state: IntentState };
  return envelope.state.dwell_ticks_applied ?? 0;
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach — isolation between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearAll();
  vi.restoreAllMocks();
});

afterEach(() => {
  // Restore real timers BEFORE teardown so clearInterval works correctly
  vi.useRealTimers();
  callTeardown();
  clearAll();
  vi.restoreAllMocks();
});

// ===========================================================================
// AC1 + AC2: Timer starts after refreshDirectives() and dwell_ticks_applied advances
// ===========================================================================

describe('AC1 + AC2 — dwell timer starts after refreshDirectives() and advances dwell_ticks_applied', () => {
  it('AC1: dwell tick fires through init() after advancing past the 30 s threshold', async () => {
    // Precondition: rehydrated quiz-answered 'yield_hunter' state so the timer callback
    // does not return early on the `archetype === 'neutral'` guard.
    seedNonNeutralState('yield_hunter');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    // API returns same archetype as rehydrated state → previousArchetype null → 'yield_hunter'
    // → startDwellTimer() is called inside refreshDirectives()
    stubFetch(ADAPT_RESPONSE_YIELD);

    vi.useFakeTimers();

    const initPromise = _initForTest();

    // Advance fake time well past ALL DWELL_THRESHOLDS_MS.
    // vi.advanceTimersByTimeAsync flushes Promise micro-tasks first (so fetch resolves,
    // refreshDirectives completes, startDwellTimer is called), then advances the clock
    // in TICK_MS increments, firing the setInterval callbacks.
    //
    // We use PAST_ALL_THRESHOLDS (200 s) rather than just THRESHOLD_30S + TICK_MS
    // because the exact moment startDwellTimer() is called depends on when the
    // Promise micro-task chain (fetch → refreshDirectives) completes relative to the
    // fake-time advance.  If startDwellTimer runs at T+10s (one timer step later than T),
    // adaptedAt = T+10s and the 30 s window is at T+40s — outside the 35 s advance.
    // Using 200 s covers all three threshold windows regardless of start-time jitter.
    await vi.advanceTimersByTimeAsync(PAST_ALL_THRESHOLDS);

    await initPromise;

    // AC1: the timer ran and at least one threshold tick was persisted via onIntentUpdate
    const ticksApplied = readPersistedTicks(SESSION_ID);
    expect(ticksApplied).toBeGreaterThanOrEqual(1);
  }, 10_000);

  it('AC2: dwell_ticks_applied advances without incrementing signal_count (continuous signal)', async () => {
    // AC2 asserts the wiring path: timer → applyDwellSignal → onIntentUpdate → persistIntentState.
    // It also verifies the documented invariant: `signal_count` is NOT incremented by dwell ticks
    // (applyDwellSignal intentionally preserves signal_count — dwell is continuous, not discrete).
    seedNonNeutralState('yield_hunter');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_RESPONSE_YIELD);

    // Read the initial signal_count from sessionStorage BEFORE init() runs
    const beforeState = rehydrateIntentState(SESSION_ID) as IntentState;
    const initialSignalCount = beforeState.signal_count; // 0 (applyQuizLeaf preserves 0)

    vi.useFakeTimers();

    const initPromise = _initForTest();

    // Use PAST_ALL_THRESHOLDS (200 s) to avoid start-time jitter with fake timers.
    // See AC1 comment above for the explanation.
    await vi.advanceTimersByTimeAsync(PAST_ALL_THRESHOLDS);

    await initPromise;

    // Read post-tick state from sessionStorage
    const raw = sessionStorage.getItem(intentStateStorageKey(SESSION_ID));
    expect(raw).not.toBeNull();
    const envelope = JSON.parse(raw!) as { version: number; state: IntentState };

    // AC2a: dwell tick was applied through the real wiring path
    expect(envelope.state.dwell_ticks_applied ?? 0).toBeGreaterThanOrEqual(1);

    // AC2b: signal_count unchanged — dwell does NOT increment signal_count.
    // (applyDwellSignal docs: "signal_count is NOT incremented (dwell is continuous, not a discrete event)")
    // On a rehydrated session, the cold-start block is skipped (no device_type prior fires).
    // So signal_count should equal initialSignalCount (0).
    expect(envelope.state.signal_count).toBe(initialSignalCount);
  }, 10_000);

  it('AC1 negative: no ticks fire when Decision API returns neutral', async () => {
    // Neutral API response → stopDwellTimer() is called (not startDwellTimer).
    // Seed a non-neutral rehydrated state so the archetype check alone would not prevent ticks;
    // the timer simply never starts because startDwellTimer() is not called.
    seedNonNeutralState('yield_hunter');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_RESPONSE_NEUTRAL); // <-- neutral

    vi.useFakeTimers();

    const initPromise = _initForTest();

    await vi.advanceTimersByTimeAsync(PAST_ALL_THRESHOLDS);

    await initPromise;

    // Timer never started → 0 ticks in sessionStorage
    // (The persisted state was written by the LG-2 persist in refreshDirectives,
    //  before the timer would have started, so dwell_ticks_applied is still 0.)
    expect(readPersistedTicks(SESSION_ID)).toBe(0);
  }, 10_000);
});

// ===========================================================================
// AC3: DWELL_MAX_SESSION_CONTRIBUTION cap enforced through real init() path
// ===========================================================================

describe('AC3 — DWELL_MAX_SESSION_CONTRIBUTION cap enforced through real init() timer path', () => {
  it('AC3: after advancing past all thresholds, dwell_ticks_applied is ≤ DWELL_MAX_SESSION_CONTRIBUTION', async () => {
    // Non-neutral rehydrated state, no prior dwell ticks.
    // Advancing past all three DWELL_THRESHOLDS_MS gives the timer 3 threshold windows.
    // After the cap is reached, further ticks must be silently dropped by the cap check.
    // If the cap check were removed, ticks_applied would exceed 3 → test RED.
    seedNonNeutralState('yield_hunter');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_RESPONSE_YIELD);

    vi.useFakeTimers();

    const initPromise = _initForTest();

    // Advance well past all three thresholds (200 s >> 180 s)
    await vi.advanceTimersByTimeAsync(PAST_ALL_THRESHOLDS);

    await initPromise;

    const ticksApplied = readPersistedTicks(SESSION_ID);
    // At least one tick must have fired (proving the timer ran)
    expect(ticksApplied).toBeGreaterThanOrEqual(1);
    // Cap enforcement: ticks_applied must be ≤ DWELL_MAX_SESSION_CONTRIBUTION
    // Removing the cap check → ticksApplied > 3 → RED
    expect(ticksApplied).toBeLessThanOrEqual(DWELL_MAX_SESSION_CONTRIBUTION);
  }, 10_000);

  it('AC3 via finalState: returned state shows ≤ cap (init()-exit snapshot)', async () => {
    // The finalState returned by _initForTest() captures currentIntentState at init()-exit.
    // For a rehydrated state starting at dwell_ticks_applied=0, the init-exit snapshot
    // shows 0 (no tick has fired yet at the moment init() returns).
    // This test confirms the post-tick state is ONLY in sessionStorage — see readPersistedTicks.
    seedNonNeutralState('yield_hunter');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_RESPONSE_YIELD);

    vi.useFakeTimers();

    const initPromise = _initForTest();

    await vi.advanceTimersByTimeAsync(PAST_ALL_THRESHOLDS);

    const finalState = await initPromise;

    // finalState = init()-exit snapshot (before any tick fires).
    // On a rehydrated session, the cold-start block is skipped, so no persist runs
    // inside init() body. finalState.dwell_ticks_applied = 0 (from rehydrated state).
    // The timer fires AFTER init() returns → only sessionStorage reflects the ticks.
    expect(finalState).not.toBeNull();
    // The returned value is the init()-exit state — dwell_ticks_applied is still 0
    expect(finalState!.dwell_ticks_applied ?? 0).toBe(0);
    // But sessionStorage HAS been updated by the timer callbacks
    const persistedTicks = readPersistedTicks(SESSION_ID);
    expect(persistedTicks).toBeGreaterThanOrEqual(1);
    expect(persistedTicks).toBeLessThanOrEqual(DWELL_MAX_SESSION_CONTRIBUTION);
  }, 10_000);

  it('persisted envelope after timer: schema version correct + dwell_ticks_applied ≥ 1', async () => {
    // After the dwell timer fires, onIntentUpdate → persistIntentState writes the
    // updated state.  Assert the envelope has the correct schema version and tick count.
    seedNonNeutralState('yield_hunter');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_RESPONSE_YIELD);

    vi.useFakeTimers();

    const initPromise = _initForTest();

    // Advance past all thresholds to reliably land at least one tick
    await vi.advanceTimersByTimeAsync(PAST_ALL_THRESHOLDS);

    await initPromise;

    const rawEnvelope = sessionStorage.getItem(intentStateStorageKey(SESSION_ID));
    expect(rawEnvelope).not.toBeNull();
    const envelope = JSON.parse(rawEnvelope!) as {
      version: number;
      savedAt: number;
      state: IntentState;
    };
    // Schema version must be preserved through the timer-driven persist path
    expect(envelope.version).toBe(INTENT_STATE_SCHEMA_VERSION);
    expect(envelope.savedAt).toBeGreaterThan(0);
    // Timer tick was applied and persisted
    expect(envelope.state.dwell_ticks_applied ?? 0).toBeGreaterThanOrEqual(1);
  }, 10_000);
});

// ===========================================================================
// AC5: Mutation tests — exhausted rehydrated state / dropped gates
// ===========================================================================

describe('AC5 — mutation tests: dropped gates cause test failures', () => {
  it('AC5a: !intentStateRehydrated gate — rehydrated session signal_count preserved (gate enforced)', async () => {
    // Rule R + FOLLOW-219 single cold-start gate:
    //   If the `!intentStateRehydrated` gate were dropped, applyBehavioralSignal('device_type.*')
    //   would run on the rehydrated session, incrementing signal_count by 1.
    //   Gate must hold: signal_count equals the persisted value (0) after init().
    //   Removing the `!intentStateRehydrated` condition → signal_count > 0 → RED.
    const baseState = applyQuizLeaf(initIntentState(), 'family_buyer');
    const signalCountA = baseState.signal_count; // 0

    persistIntentState(SESSION_ID, baseState);
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    // Stub location with investment UTM — would boost portfolio_builder if referrer hints ran
    vi.stubGlobal('location', { search: '?utm_term=investment', pathname: '/' });

    insertScriptTag();
    stubFetch();

    const finalState = await _initForTest();

    expect(finalState).not.toBeNull();
    // Gate must hold: signal_count unchanged (referrer + device priors were gated out)
    expect(finalState!.signal_count).toBe(signalCountA);
    // Archetype also unchanged (referrer prior did not run)
    expect(finalState!.archetype).toBe('family_buyer');
  });

  it('AC5b: DWELL_MAX_SESSION_CONTRIBUTION cap — exhausted state does not gain ticks via init() timer', async () => {
    // Primary Rule R + FOLLOW-227 cap mutation test driven through init().
    // Exhaust all ticks in the persisted state; then verify they do not re-fire.
    // If the cap check in startDwellTimer were removed, ticks_applied would exceed cap → RED.
    const baseState = applyQuizLeaf(initIntentState(), 'yield_hunter');
    const exhaustedState: IntentState = {
      ...baseState,
      dwell_ticks_applied: DWELL_MAX_SESSION_CONTRIBUTION, // all 3 ticks used
    };

    persistIntentState(SESSION_ID, exhaustedState);
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    // Same archetype as rehydrated state → startDwellTimer IS called
    stubFetch({ ...ADAPT_RESPONSE_YIELD, archetype: 'yield_hunter' });

    vi.useFakeTimers();

    const initPromise = _initForTest();

    // Advance past all thresholds — without the cap check, all 3 would re-fire → 6 total
    await vi.advanceTimersByTimeAsync(PAST_ALL_THRESHOLDS);

    const finalState = await initPromise;

    // finalState: captured at init()-exit (before any tick; rehydrated state shows cap)
    expect(finalState).not.toBeNull();
    expect(finalState!.dwell_ticks_applied).toBe(DWELL_MAX_SESSION_CONTRIBUTION);

    // Persisted state: cap enforced during timer callbacks (timer fires but returns early)
    const persistedTicks = readPersistedTicks(SESSION_ID);
    expect(persistedTicks).toBe(DWELL_MAX_SESSION_CONTRIBUTION);
  }, 10_000);

  it('AC5c: neutral API response → timer not started → 0 ticks even with non-neutral Bayesian state', async () => {
    // Even with a non-neutral rehydrated Bayesian state, if the Decision API returns neutral,
    // startDwellTimer() is not called (stopDwellTimer() is called instead).
    // If this guard were removed from refreshDirectives(), ticks would fire → RED.
    seedNonNeutralState('yield_hunter');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_RESPONSE_NEUTRAL);

    vi.useFakeTimers();

    const initPromise = _initForTest();

    await vi.advanceTimersByTimeAsync(PAST_ALL_THRESHOLDS);

    await initPromise;

    // Timer never started (stopDwellTimer called for neutral) → 0 ticks
    expect(readPersistedTicks(SESSION_ID)).toBe(0);
  }, 10_000);
});

// ===========================================================================
// AC4: stopDwellTimer() fires on visibilitychange → hidden through init()
// ===========================================================================

describe('AC4 — stopDwellTimer() fires on visibility-hidden event through init()', () => {
  it('hiding the page before first threshold: no ticks fire after visibilitychange=hidden', async () => {
    // Strategy:
    //   1. Non-neutral rehydrated state (so archetype guard is not the obstacle).
    //   2. Advance to 24 s (before the 30 s threshold window [25.5 s, 34.5 s]).
    //      No ticks yet.
    //   3. Dispatch visibilitychange hidden → stopDwellTimer() clears the interval.
    //   4. Advance past ALL thresholds → timer is stopped; no ticks should fire.
    //   5. Assert sessionStorage shows 0 ticks.
    //   Removing stopDwellTimer() from the visibilitychange handler → ticks fire → RED.
    seedNonNeutralState('yield_hunter');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_RESPONSE_YIELD);

    vi.useFakeTimers();

    const initPromise = _initForTest();

    // Advance to 24 s: 4 tick intervals fire (5s, 10s, 15s, 20s).
    // elapsed ≤ 24000: |24000 - 30000| = 6000 > 4500 → not in threshold window yet.
    await vi.advanceTimersByTimeAsync(4 * TICK_MS);

    // Simulate page hidden — fires stopDwellTimer() via the real visibilitychange listener
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event('visibilitychange'));

    // Now advance far past all thresholds — timer was stopped, no more ticks
    await vi.advanceTimersByTimeAsync(PAST_ALL_THRESHOLDS);

    await initPromise;

    // 0 ticks: timer stopped before the first threshold window
    expect(readPersistedTicks(SESSION_ID)).toBe(0);

    // Restore visibilityState for subsequent tests
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  }, 10_000);

  it('AC4: ticks already fired before hide ARE preserved in sessionStorage', async () => {
    // Verify the hide path is not over-aggressive: ticks accumulated BEFORE the page
    // is hidden must still be in sessionStorage.
    // This test advances past the 30 s threshold (1 tick fires), THEN hides the page.
    seedNonNeutralState('yield_hunter');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_RESPONSE_YIELD);

    vi.useFakeTimers();

    const initPromise = _initForTest();

    // Advance past all thresholds to ensure at least one tick fires before hide.
    // Using PAST_ALL_THRESHOLDS avoids start-time jitter (see AC1 comment).
    await vi.advanceTimersByTimeAsync(PAST_ALL_THRESHOLDS);

    // Now hide the page — ticks already persisted are not affected by this
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event('visibilitychange'));

    await initPromise;

    // The tick(s) that fired before hide must still be in sessionStorage
    expect(readPersistedTicks(SESSION_ID)).toBeGreaterThanOrEqual(1);

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  }, 10_000);
});

// ===========================================================================
// Rehydrate boundary: dwell_ticks_applied persists across listing navigation
// ===========================================================================

describe('Rehydrate boundary — dwell_ticks_applied survives across listing navigation', () => {
  it('ticks accumulated on listing A rehydrate correctly on listing B', async () => {
    // Simulate listing A: non-neutral state, timer fires, state persisted.
    seedNonNeutralState('yield_hunter');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_RESPONSE_YIELD);

    vi.useFakeTimers();

    const initPromiseA = _initForTest();

    // Advance past all thresholds to ensure at least one tick persists
    await vi.advanceTimersByTimeAsync(PAST_ALL_THRESHOLDS);

    await initPromiseA;

    const ticksAfterA = readPersistedTicks(SESSION_ID);
    expect(ticksAfterA).toBeGreaterThanOrEqual(1);

    // Simulate cross-listing navigation: rehydrateIntentState reads the persisted envelope
    const rehydrated = rehydrateIntentState(SESSION_ID) as IntentState;
    expect(rehydrated).not.toBeNull();

    // The rehydrated state carries the tick count from listing A
    expect(rehydrated.dwell_ticks_applied ?? 0).toBe(ticksAfterA);
    // The archetype is preserved
    expect(rehydrated.archetype).toBe('yield_hunter');
  }, 10_000);
});

// ===========================================================================
// Isolation: sessionStorage clean between tests
// ===========================================================================

describe('sessionStorage isolation between test cases', () => {
  it('no residual intent state from prior tests (afterEach clearAll works)', () => {
    expect(sessionStorage.getItem(intentStateStorageKey(SESSION_ID))).toBeNull();
    expect(sessionStorage.getItem('__estalara_session__')).toBeNull();
  });
});
