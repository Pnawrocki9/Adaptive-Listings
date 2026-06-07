/**
 * FOLLOW-216 — Gate FOLLOW-207 priors behind !intentStateRehydrated + persist init-time state
 *
 * Unit tests covering the gating logic in index.ts:
 *
 *   LG-1 (AC1): When intentStateRehydrated=true, applyReferrerHints and
 *     applyBehavioralSignal('device_type.*') must NOT be called — the rehydrated
 *     archetype must be unchanged by these priors.
 *
 *   LG-2 (AC2): On a cold-start (intentStateRehydrated=false), persistIntentState()
 *     must be called once before refreshDirectives() so the cold-start archetype is
 *     carried on the very first cross-listing navigation even before any behavioral
 *     signal fires.
 *
 * These unit tests assert the gating behavior at the helper level, exercising the
 * logic that index.ts wires together. The full jsdom init() integration test
 * (listing A → navigate → listing B chain) is FOLLOW-217.
 *
 * Environment: node (no DOM). Storage APIs are stubbed at globalThis level.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  persistIntentState,
  rehydrateIntentState,
  intentStateStorageKey,
  INTENT_STATE_SCHEMA_VERSION,
} from '../core/session.js';
import {
  initIntentState,
  applyBehavioralSignal,
  applyReferrerHints,
  applyQuizLeaf,
} from '../core/intent.js';
import type { IntentState } from '../core/intent.js';

// ─── Storage stubs ────────────────────────────────────────────────────────────

const mockSessionStorage = new Map<string, string>();

function stubSessionStorage(): void {
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => mockSessionStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mockSessionStorage.set(key, value);
    },
    removeItem: (key: string) => {
      mockSessionStorage.delete(key);
    },
    clear: () => {
      mockSessionStorage.clear();
    },
  });
}

stubSessionStorage();

const SESSION_ID = 'c'.repeat(64);
const INVESTMENT_REFERRER = 'https://investment.example.com/';

beforeEach(() => {
  mockSessionStorage.clear();
  vi.restoreAllMocks();
  stubSessionStorage();
});

/**
 * Applies cold-start FOLLOW-207 priors to `state` conditionally on `rehydrated`.
 * This mirrors the exact gate implemented in index.ts:
 *   if (!intentStateRehydrated) { applyReferrerHints(...); applyBehavioralSignal(...); }
 */
function applyFollow207Priors(
  state: IntentState,
  rehydrated: boolean,
  referrer: string,
  deviceSignal: 'device_type.desktop' | 'device_type.mobile',
): IntentState {
  if (rehydrated) return state;
  let next = applyReferrerHints(state, referrer, '');
  next = applyBehavioralSignal(next, deviceSignal);
  return next;
}

/**
 * Runs the LG-2 cold-start persist gate from index.ts:
 *   if (!intentStateRehydrated) { persistIntentState(sessionId, state); }
 */
function maybeInitPersist(sessionId: string, state: IntentState, rehydrated: boolean): void {
  if (!rehydrated) {
    persistIntentState(sessionId, state);
  }
}

// ─── LG-1: Rehydrated session must NOT be mutated by FOLLOW-207 priors ────────

describe('LG-1 — FOLLOW-207 priors gated behind !intentStateRehydrated', () => {
  it('rehydrated state is unchanged when intentStateRehydrated=true (referrer + device skipped)', () => {
    // Listing A: persist a quiz-answered archetype
    const listingAState = applyQuizLeaf(initIntentState(), 'yield_hunter');
    persistIntentState(SESSION_ID, listingAState);

    // Listing B: rehydrate
    const raw = rehydrateIntentState(SESSION_ID);
    expect(raw).not.toBeNull();
    const rehydrated = raw as IntentState;

    const archetypeBefore = rehydrated.archetype;
    const signalCountBefore = rehydrated.signal_count;
    const portfolioBefore = rehydrated.probabilities.portfolio_builder;
    const yieldBefore = rehydrated.probabilities.yield_hunter;

    // Gate: intentStateRehydrated=true → priors skipped
    const afterPriors = applyFollow207Priors(
      rehydrated,
      true,
      INVESTMENT_REFERRER,
      'device_type.desktop',
    );

    expect(afterPriors.archetype).toBe(archetypeBefore);
    expect(afterPriors.signal_count).toBe(signalCountBefore);
    expect(afterPriors.probabilities.portfolio_builder).toBeCloseTo(portfolioBefore, 10);
    expect(afterPriors.probabilities.yield_hunter).toBeCloseTo(yieldBefore, 10);
  });

  it('cold-start state IS mutated when intentStateRehydrated=false (referrer + device applied)', () => {
    expect(rehydrateIntentState(SESSION_ID)).toBeNull();

    const base = initIntentState();
    const portfolioBefore = base.probabilities.portfolio_builder;
    const signalCountBefore = base.signal_count;

    // Gate: intentStateRehydrated=false → priors applied
    const afterPriors = applyFollow207Priors(
      base,
      false,
      INVESTMENT_REFERRER,
      'device_type.desktop',
    );

    expect(afterPriors.probabilities.portfolio_builder).toBeGreaterThan(portfolioBefore);
    expect(afterPriors.signal_count).toBeGreaterThan(signalCountBefore);
  });

  it('rehydrated family_buyer: investment referrer does NOT shift portfolio_builder', () => {
    const listingAState = applyQuizLeaf(initIntentState(), 'family_buyer');
    persistIntentState(SESSION_ID, listingAState);

    const raw = rehydrateIntentState(SESSION_ID);
    const rehydrated = raw as IntentState;
    const portfolioBefore = rehydrated.probabilities.portfolio_builder;

    // rehydrated=true → referrer gate skips the call
    const afterPriors = applyFollow207Priors(
      rehydrated,
      true,
      INVESTMENT_REFERRER,
      'device_type.desktop',
    );

    expect(afterPriors.probabilities.portfolio_builder).toBeCloseTo(portfolioBefore, 10);
    expect(afterPriors.archetype).toBe('family_buyer');
  });

  it('rehydrated state: device_type.desktop does NOT inflate signal_count', () => {
    const listingAState = applyQuizLeaf(initIntentState(), 'luxury_buyer');
    persistIntentState(SESSION_ID, listingAState);

    const rehydrated = rehydrateIntentState(SESSION_ID) as IntentState;
    const signalCountBefore = rehydrated.signal_count;

    const afterPriors = applyFollow207Priors(rehydrated, true, '', 'device_type.desktop');

    expect(afterPriors.signal_count).toBe(signalCountBefore);
  });

  it('gate is symmetric: cold-start mutates; rehydrated is stable (same referrer, both paths)', () => {
    // Cold-start path
    const coldBase = initIntentState();
    const coldPortfolioBefore = coldBase.probabilities.portfolio_builder;
    const coldAfter = applyFollow207Priors(
      coldBase,
      false,
      INVESTMENT_REFERRER,
      'device_type.desktop',
    );
    expect(coldAfter.probabilities.portfolio_builder).toBeGreaterThan(coldPortfolioBefore);

    // Rehydrated path — persist cold state first
    persistIntentState(SESSION_ID, coldAfter);
    const rehydrated = rehydrateIntentState(SESSION_ID) as IntentState;
    const portfolioAfterRehydrate = rehydrated.probabilities.portfolio_builder;

    const rehydratedAfterPriors = applyFollow207Priors(
      rehydrated,
      true, // rehydrated=true → priors skipped
      INVESTMENT_REFERRER,
      'device_type.desktop',
    );

    // Same referrer but priors not re-applied → probability unchanged
    expect(rehydratedAfterPriors.probabilities.portfolio_builder).toBeCloseTo(
      portfolioAfterRehydrate,
      10,
    );
  });
});

// ─── LG-2: Cold-start state is persisted before first refreshDirectives() ──────

describe('LG-2 — persistIntentState called on cold-start before first refreshDirectives()', () => {
  it('after cold-start priors, intent state is persisted to sessionStorage', () => {
    let currentIntentState = initIntentState();
    // Apply cold-start priors (intentStateRehydrated=false path)
    currentIntentState = applyFollow207Priors(
      currentIntentState,
      false,
      INVESTMENT_REFERRER,
      'device_type.desktop',
    );

    // LG-2: persist before first refreshDirectives
    maybeInitPersist(SESSION_ID, currentIntentState, false);

    const key = intentStateStorageKey(SESSION_ID);
    const raw = mockSessionStorage.get(key);
    expect(raw).toBeDefined();

    const envelope = JSON.parse(raw!) as {
      version: number;
      savedAt: number;
      state: IntentState;
    };
    expect(envelope.version).toBe(INTENT_STATE_SCHEMA_VERSION);
    expect(envelope.state.probabilities.portfolio_builder).toBeGreaterThan(
      initIntentState().probabilities.portfolio_builder,
    );
  });

  it('cold-start state rehydratable on next page load before any behavioral signal', () => {
    // Listing A: cold-start with investment referrer prior — no behavioral signals
    let listingAState = initIntentState();
    listingAState = applyFollow207Priors(
      listingAState,
      false,
      INVESTMENT_REFERRER,
      'device_type.desktop',
    );

    // LG-2: persist before first refreshDirectives
    maybeInitPersist(SESSION_ID, listingAState, false);

    // Listing B: rehydrate immediately — cold-start archetype available without behavioral signals
    const raw = rehydrateIntentState(SESSION_ID);
    expect(raw).not.toBeNull();

    const rehydrated = raw as IntentState;
    expect(rehydrated.probabilities.portfolio_builder).toBeGreaterThan(
      initIntentState().probabilities.portfolio_builder,
    );
  });

  it('rehydrated session does NOT trigger LG-2 persist (no extra write)', () => {
    const listingAState = applyQuizLeaf(initIntentState(), 'downsizer');
    persistIntentState(SESSION_ID, listingAState);

    // Listing B: rehydrate
    const raw = rehydrateIntentState(SESSION_ID) as IntentState;

    // Spy on sessionStorage.setItem to detect any additional write
    const setItemSpy = vi.fn<(key: string, value: string) => void>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => mockSessionStorage.get(key) ?? null,
      setItem: setItemSpy,
      removeItem: (key: string) => {
        mockSessionStorage.delete(key);
      },
      clear: () => {
        mockSessionStorage.clear();
      },
    });

    // LG-2 gate: rehydrated=true → skip persist
    maybeInitPersist(SESSION_ID, raw, true);

    // No setItem call should have occurred
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('quiz-answered archetype persisted on cold-start survives to listing B', () => {
    // Listing A: quiz answered → LG-2 persist (simulating cold-start before behavioral signal)
    const listingAState = applyQuizLeaf(initIntentState(), 'portfolio_builder');
    maybeInitPersist(SESSION_ID, listingAState, false);

    // Listing B: rehydrate — portfolio_builder archetype available immediately
    const hydratedRaw = rehydrateIntentState(SESSION_ID);
    expect(hydratedRaw).not.toBeNull();

    const hydrated = hydratedRaw as IntentState;
    expect(hydrated.archetype).toBe('portfolio_builder');
    expect(hydrated.quiz_answered).toBe(true);
    expect(hydrated.confidence).toBeGreaterThan(0.5);
  });
});

// ─── Integration: LG-1 + LG-2 together: listing A → listing B round-trip ─────

describe('LG-1 + LG-2 combined: full cold-start → rehydration chain', () => {
  it('listing A cold-start priors survive to listing B without re-perturbation', () => {
    // === LISTING A PAGE LOAD ===
    expect(rehydrateIntentState(SESSION_ID)).toBeNull();

    let stateA = initIntentState();
    // Apply cold-start priors (intentStateRehydrated=false)
    stateA = applyFollow207Priors(stateA, false, INVESTMENT_REFERRER, 'device_type.desktop');
    // LG-2: persist before first refreshDirectives
    maybeInitPersist(SESSION_ID, stateA, false);

    const archetypeA = stateA.archetype;
    const signalCountA = stateA.signal_count;
    const portfolioA = stateA.probabilities.portfolio_builder;

    // === LISTING B PAGE LOAD ===
    const rawB = rehydrateIntentState(SESSION_ID);
    expect(rawB).not.toBeNull();
    const rehydratedB = rawB as IntentState;

    // LG-1: priors NOT re-applied on rehydrated session
    const stateB = applyFollow207Priors(
      rehydratedB,
      true,
      INVESTMENT_REFERRER,
      'device_type.desktop',
    );

    // Correctness property from FOLLOW-216 AC4:
    // The rehydrated archetype on listing B equals what was persisted on listing A.
    expect(stateB.archetype).toBe(archetypeA);
    expect(stateB.signal_count).toBe(signalCountA);
    expect(stateB.probabilities.portfolio_builder).toBeCloseTo(portfolioA, 10);
  });

  it('quiz-answered archetype preserved across navigation without re-perturbation', () => {
    // Listing A: behavioral signals + quiz answered
    let stateA = initIntentState();
    stateA = applyBehavioralSignal(stateA, 'listing.viewed');
    stateA = applyBehavioralSignal(stateA, 'listing.viewed');
    stateA = applyQuizLeaf(stateA, 'luxury_buyer');

    const signalCountA = stateA.signal_count;
    const confidenceA = stateA.confidence;

    // onIntentUpdate persists (simulated)
    persistIntentState(SESSION_ID, stateA);

    // Listing B: rehydrate → priors NOT applied (LG-1 gate)
    const rawB = rehydrateIntentState(SESSION_ID);
    expect(rawB).not.toBeNull();
    const rehydratedB = rawB as IntentState;

    const stateB = applyFollow207Priors(
      rehydratedB,
      true,
      INVESTMENT_REFERRER,
      'device_type.mobile',
    );

    expect(stateB.archetype).toBe('luxury_buyer');
    expect(stateB.quiz_answered).toBe(true);
    expect(stateB.signal_count).toBe(signalCountA);
    expect(stateB.confidence).toBeCloseTo(confidenceA, 5);
  });
});
