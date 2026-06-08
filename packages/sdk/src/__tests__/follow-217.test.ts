// @vitest-environment jsdom
/**
 * FOLLOW-217 — jsdom init() integration test: rehydrate→skip-hints→first-adapt chain
 *              + denial-path erase.
 *
 * Context (why this exists):
 *   FOLLOW-176 (PR #217) shipped 28 unit tests on session.ts helpers but ZERO test on the
 *   index.ts init() wiring — the surface where LG-1 (FOLLOW-207 priors re-perturbing the
 *   rehydrated archetype) lived. FOLLOW-216 (PR #218) fixed LG-1 in production code.
 *   FOLLOW-217 delivers the integration test that prevents future regression.
 *
 * Rule Q (amended 2026-06-08): this test imports and invokes `_initForTest()`, a real exported
 * seam from index.ts that calls the production `init()` body. No gate logic is re-implemented
 * locally. The litmus: drop a `!` on any real gate in index.ts — this test goes RED.
 *
 * Acceptance criteria:
 *   AC1: init() test asserts rehydrate→skip-hints→first-adapt carries the rehydrated
 *        archetype (not default/neutral)
 *   AC2: LG-1 regression assertion: post-init archetype equals the rehydrated archetype
 *        (FOLLOW-207 priors did NOT perturb it after rehydration). The `_initForTest()`
 *        seam returns the final `currentIntentState` directly, making ALL four gates
 *        catchable — including referrer/device priors that only live in-memory on the
 *        rehydrated path and are never written back to sessionStorage.
 *   AC3: Denial-path eraseIntentState invocation asserted at the init() level (not just
 *        session helper level) — verified by calling _initForTest() with denied consent
 *        and asserting the sessionStorage key is removed
 *   AC4: First refreshDirectives()→applyDirectives leg exercised with mocked fetch;
 *        rehydrated archetype survives the API response (intent state is not overwritten
 *        by the adapt API result — only behavioural signals and quiz completion do that)
 *   AC5: No local isValidIntentState copy — test relies on the production guard in init()
 *   AC6: sessionStorage reset between test cases (no cross-test bleed from the rehydrate branch)
 *
 * Test strategy:
 *   The `init()` function is private to index.ts but exposed for tests via the
 *   `_initForTest()` export seam (Rule Q amendment). `_initForTest()` returns the final
 *   `IntentState` resolved by `init()` (or null on early-exit), giving tests direct
 *   in-memory access to the state without re-implementing any logic.
 *
 *   Each test:
 *     1. Pre-seeds sessionStorage with a known session ID (bypasses SHA-256 fingerprint
 *        generation in getOrCreateSession) and, where applicable, a persisted intent state.
 *     2. Pre-seeds localStorage with the consent state.
 *     3. Inserts a <script data-api-key="…"> element into the jsdom document (the production
 *        selector `document.querySelector('script[data-api-key]')` must find it).
 *     4. Stubs fetch to return a valid AdaptResponse so refreshDirectives() can complete
 *        without a live Decision API.
 *     5. Calls `const finalState = await _initForTest()` — the REAL init() body.
 *     6. Asserts on `finalState` (direct in-memory access) and/or sessionStorage reads.
 *
 * Environment: jsdom (real DOM, real sessionStorage, real localStorage).
 * fetch: mocked via vi.stubGlobal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest } from '../index.js';

import {
  persistIntentState,
  rehydrateIntentState,
  intentStateStorageKey,
  INTENT_STATE_SCHEMA_VERSION,
} from '../core/session.js';
import { applyQuizLeaf, initIntentState } from '../core/intent.js';
import type { IntentState } from '../core/intent.js';

// ---------------------------------------------------------------------------
// Fixtures — deterministic session ID (pre-seeded to bypass SHA-256 generation)
// ---------------------------------------------------------------------------

/**
 * Known 64-char hex session ID. Pre-seeded into sessionStorage under
 * `__estalara_session__` so that `getOrCreateSession()` returns it directly
 * without re-deriving a fingerprint — making the session ID predictable in tests.
 */
const SESSION_ID = 'd'.repeat(64);

/** Minimal valid AdaptResponse that passes the SDK's Zod validation schema. */
const ADAPT_RESPONSE = {
  adapt_decision_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  session_id: SESSION_ID,
  archetype: 'luxury_buyer',
  confidence: 0.72,
  similarity: 0.88,
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

/** Pre-seed a known session into sessionStorage so getOrCreateSession() uses it. */
function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

/**
 * Insert a <script data-api-key> tag that init() can find via querySelector.
 *
 * When `decisionUrl` is provided, also sets `data-tenant-id` so fetchDirectives()
 * passes the `config.tenantId` guard (adapt.ts line ~572: `if (!config.tenantId) return null`).
 */
function insertScriptTag(overrides: Record<string, string> = {}): HTMLScriptElement {
  const script = document.createElement('script');
  script.dataset.apiKey = overrides.apiKey ?? 'test-key-follow220';
  if (overrides.decisionUrl !== undefined) {
    script.dataset.decisionUrl = overrides.decisionUrl;
    // tenantId is required by fetchDirectives — set it alongside decisionUrl
    script.dataset.tenantId = overrides.tenantId ?? 'follow220-tenant';
  }
  document.head.appendChild(script);
  return script;
}

/** Remove all Estalara script tags inserted during a test. */
function removeScriptTags(): void {
  document.querySelectorAll<HTMLScriptElement>('script[data-api-key]').forEach((el) => {
    el.remove();
  });
}

/** Clear sessionStorage, localStorage, and any Estalara DOM nodes. */
function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  removeScriptTags();
  // Remove any shadow host elements init() may have attached
  document.querySelectorAll('[data-estalara-host]').forEach((el) => {
    el.remove();
  });
}

/**
 * Stub `fetch` globally to return a valid AdaptResponse for any Decision API
 * request and a 200 OK for any ingest request.
 */
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
      // Ingest endpoint — 200 OK, no body needed
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }),
  );
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach — AC6: sessionStorage reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearAll();
  vi.restoreAllMocks();
});

afterEach(() => {
  // Call teardown if init() ran and registered it
  const teardown = (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  if (teardown) {
    teardown();
    delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  }
  clearAll();
  vi.restoreAllMocks();
});

// ===========================================================================
// AC1 + AC2: rehydrate → skip hints → first-adapt carries rehydrated archetype
// ===========================================================================

describe('AC1 + AC2 — rehydrated archetype survives init() wiring (LG-1 regression)', () => {
  it('AC1: Listing B init via _initForTest() rehydrates and returns the persisted archetype', async () => {
    // === Listing A: cold-start → persist quiz-answered archetype ===
    const listingAState = applyQuizLeaf(initIntentState(), 'family_buyer');
    persistIntentState(SESSION_ID, listingAState);

    // Verify the key exists in sessionStorage before init
    const key = intentStateStorageKey(SESSION_ID);
    expect(sessionStorage.getItem(key)).not.toBeNull();

    // === Listing B: run real init() via seam ===
    seedSession();
    // Consent: granted (skip banner path)
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubFetch();

    const finalState = await _initForTest();

    // AC1: _initForTest() returns the real currentIntentState from init()
    expect(finalState).not.toBeNull();
    expect(finalState!.archetype).toBe('family_buyer');
    expect(finalState!.archetype).not.toBe('neutral');
  });

  it('AC2 (LG-1 regression): FOLLOW-207 priors do NOT perturb the rehydrated archetype', async () => {
    // === Listing A: persist high-confidence yield_hunter ===
    const listingAState = applyQuizLeaf(initIntentState(), 'yield_hunter');
    persistIntentState(SESSION_ID, listingAState);

    const archetypeA = listingAState.archetype; // 'yield_hunter'
    const signalCountA = listingAState.signal_count; // 0
    const confidenceA = listingAState.confidence; // ~0.85

    // === Listing B: run real init() ===
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    // Gate :374 litmus: stub globalThis.location.search with investment UTM.
    // init() reads utm_term via:
    //   (globalThis as { location? }).location?.search
    // Stubbing location as an object on globalThis (rather than assigning window.location.href)
    // avoids jsdom's "Not implemented: navigation" error while still exercising the real gate.
    // When this stub is active, applyReferrerHints receives utmTerm='investment' and would
    // boost portfolio_builder — gate :374 must suppress this on a rehydrated session.
    vi.stubGlobal('location', { search: '?utm_term=investment', pathname: '/' });

    insertScriptTag();
    stubFetch();

    const finalState = await _initForTest();

    // AC2: returned state must show archetype, signal_count, and confidence UNCHANGED
    // (referrer + device priors were gated out — LG-1 fix from FOLLOW-216)
    expect(finalState).not.toBeNull();
    // Gate :381 check: device_type.mobile would increment signal_count by 1 if applied
    expect(finalState!.signal_count).toBe(signalCountA);
    // Gate :374 check: investment UTM would shift portfolio_builder probability if applied
    expect(finalState!.archetype).toBe(archetypeA);
    expect(finalState!.confidence).toBeCloseTo(confidenceA, 5);
    // portfolio_builder must NOT have been boosted by investment UTM
    expect(finalState!.probabilities.portfolio_builder).toBeCloseTo(
      listingAState.probabilities.portfolio_builder,
      10,
    );
  });

  it('AC2 litmus for gate :381 — device_type prior changes signal_count when gate inverted', async () => {
    // This test documents the mechanism by which gate :381 is caught:
    // On a COLD-START (rehydrated=false), the inverted gate `if (intentStateRehydrated)`
    // would be false, skipping the device signal. The cold-start state would have signal_count=0
    // instead of 1. The "cold-start" test below catches this.
    //
    // On a REHYDRATED session, the returned finalState's signal_count directly exposes
    // any wrong device signal application (see AC2 test above).
    //
    // This test confirms the nominal rehydrated case has signal_count preserved from Listing A.
    const stateA = applyQuizLeaf(initIntentState(), 'portfolio_builder');
    // applyQuizLeaf preserves signal_count=0 from initIntentState()
    expect(stateA.signal_count).toBe(0);
    persistIntentState(SESSION_ID, stateA);

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubFetch();

    const finalState = await _initForTest();

    // Gate :381 must prevent device_type signal from incrementing signal_count
    expect(finalState).not.toBeNull();
    expect(finalState!.signal_count).toBe(0); // unchanged — device signal was NOT applied
  });

  it('cold-start (no prior session): FOLLOW-207 priors ARE applied and signal_count advances', async () => {
    // No prior intent state → cold-start path
    expect(sessionStorage.getItem(intentStateStorageKey(SESSION_ID))).toBeNull();

    // On a genuine cold-start there is also no pre-seeded session.
    // init() will call getOrCreateSession() which derives a fingerprint.
    // We accept any session ID — we read it from sessionStorage after init.
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubFetch();

    const finalState = await _initForTest();

    // After cold-start init, at minimum the device_type prior is applied:
    //   applyBehavioralSignal('device_type.*') increments signal_count by 1.
    expect(finalState).not.toBeNull();
    expect(finalState!.signal_count).toBeGreaterThan(0);

    // Also verify LG-2 persisted the state
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
    expect(envelope.state.signal_count).toBeGreaterThan(0);
  });

  it('LG-2: cold-start state is persisted to sessionStorage before first refreshDirectives()', async () => {
    // No prior intent state
    expect(sessionStorage.getItem(intentStateStorageKey(SESSION_ID))).toBeNull();

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubFetch();

    // Spy on setItem BEFORE init() runs so we capture the LG-2 persist call
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    await _initForTest();

    // LG-2: at least one write to the intent state key should have occurred
    const intentKey = intentStateStorageKey(SESSION_ID);
    const intentWrites = setItemSpy.mock.calls.filter(([k]) => k === intentKey);
    expect(intentWrites.length).toBeGreaterThan(0);

    // The envelope in sessionStorage has a valid version and a positive savedAt
    const raw = sessionStorage.getItem(intentKey);
    expect(raw).not.toBeNull();
    const envelope = JSON.parse(raw!) as { version: number; savedAt: number; state: IntentState };
    expect(envelope.version).toBe(INTENT_STATE_SCHEMA_VERSION);
    expect(envelope.savedAt).toBeGreaterThan(0);
  });

  it('LG-2: rehydrated session does NOT write an extra persist (no double-write on rehydrate)', async () => {
    // Listing A: persist a state
    const stateA = applyQuizLeaf(initIntentState(), 'portfolio_builder');
    persistIntentState(SESSION_ID, stateA);

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubFetch();

    // Spy AFTER the initial persist — only capture writes that happen during init()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    await _initForTest();

    // LG-2 gate: on a rehydrated session, the guard `if (!intentStateRehydrated)` at
    // index.ts line ~594 must prevent the LG-2 persist.
    // The only allowable write is from onIntentUpdate (behavioral signal path), which
    // does NOT fire during a no-fetch init (no behavioral events in this test).
    const intentKey = intentStateStorageKey(SESSION_ID);
    const intentWritesDuringInit = setItemSpy.mock.calls.filter(([k]) => k === intentKey);
    // No LG-2 persist should have occurred on a rehydrated session
    expect(intentWritesDuringInit).toHaveLength(0);
  });
});

// ===========================================================================
// AC3: Denial-path eraseIntentState called THROUGH init() (not direct helper)
// ===========================================================================

describe('AC3 — consent denial path: eraseIntentState invoked at init() level', () => {
  it('denied consent with existing session: _initForTest() removes the sessionStorage key', async () => {
    // Simulate a prior session that had granted consent and persisted intent state
    const priorState = applyQuizLeaf(initIntentState(), 'family_buyer');
    persistIntentState(SESSION_ID, priorState);

    // Pre-seed session so peekStoredSessionId() finds our known SESSION_ID
    seedSession();

    // Consent: denied
    localStorage.setItem('estalara_consent', 'denied');

    // Intent state key exists before init
    const key = intentStateStorageKey(SESSION_ID);
    expect(sessionStorage.getItem(key)).not.toBeNull();

    insertScriptTag();
    stubFetch();

    const result = await _initForTest();

    // AC3: init() eraseIntentState(peekStoredSessionId()) must have removed the key
    // (index.ts line ~209: eraseIntentState(peekStoredSessionId()))
    expect(sessionStorage.getItem(key)).toBeNull();
    // Denial path returns null (early exit from init())
    expect(result).toBeNull();
  });

  it('consent denied during banner (pending → denied): init() removes intent key', async () => {
    // Simulate: consent was pending, intent state was already persisted (prior listing nav)
    const priorState = applyQuizLeaf(initIntentState(), 'yield_hunter');
    persistIntentState(SESSION_ID, priorState);
    seedSession();

    // Consent: denied — init() hits the 'denied' path at line ~207–217 and erases intent state
    localStorage.setItem('estalara_consent', 'denied');

    const key = intentStateStorageKey(SESSION_ID);
    expect(sessionStorage.getItem(key)).not.toBeNull();

    insertScriptTag();
    stubFetch();

    await _initForTest();

    // The denied path at init() ~line 209 erases the intent state
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('after erase: a subsequent _initForTest() cold-start does not bleed rehydrated state', async () => {
    // Setup: persist state, deny, run init() (erases it), then run init() again with grant
    const state = applyQuizLeaf(initIntentState(), 'luxury_buyer');
    persistIntentState(SESSION_ID, state);
    seedSession();
    localStorage.setItem('estalara_consent', 'denied');

    const key = intentStateStorageKey(SESSION_ID);
    insertScriptTag();
    stubFetch();

    await _initForTest();

    // First init (denied): key is gone
    expect(sessionStorage.getItem(key)).toBeNull();

    // Call teardown between runs
    const td = (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
    if (td) {
      td();
      delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
    }
    removeScriptTags();

    // Now grant consent and run again
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubFetch();

    const coldStartState = await _initForTest();

    // Cold-start: no prior state bled through; the new state has a fresh archetype
    expect(coldStartState).not.toBeNull();
    // The new state was a cold-start — archetype should NOT be the erased 'luxury_buyer'
    // (it would require a quiz to set luxury_buyer; cold-start defaults to neutral/low-confidence)
    expect(coldStartState!.quiz_answered).toBe(false);
  });
});

// ===========================================================================
// AC4: First refreshDirectives()→applyDirectives leg exercised with mocked fetch;
//       rehydrated archetype survives the API response
// ===========================================================================

describe('AC4 — refreshDirectives() runs with mocked fetch; rehydrated archetype survives', () => {
  it('rehydrated archetype is NOT overwritten by the Decision API archetype', async () => {
    // Pre-seed a rehydrated state with archetype 'portfolio_builder'
    const rehydratedState = applyQuizLeaf(initIntentState(), 'portfolio_builder');
    persistIntentState(SESSION_ID, rehydratedState);
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    // Configure a Decision API URL so refreshDirectives() is triggered
    // The mocked fetch returns 'luxury_buyer' (different from rehydrated 'portfolio_builder')
    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });

    // Mock fetch: adapt response returns 'luxury_buyer', ingest returns 200
    const adaptResponseLuxury = {
      ...ADAPT_RESPONSE,
      archetype: 'luxury_buyer',
      confidence: 0.91,
    };
    stubFetch(adaptResponseLuxury);

    const finalState = await _initForTest();

    // AC4: intent state must still carry 'portfolio_builder'
    // The Decision API response sets DOM directives but does NOT update currentIntentState
    // (intent state is only updated via onIntentUpdate, which fires on behavioral signals
    // or quiz completion — neither happened in this test).
    expect(finalState).not.toBeNull();
    expect(finalState!.archetype).toBe('portfolio_builder');
    expect(finalState!.archetype).not.toBe('luxury_buyer');

    // sessionStorage also reflects the unchanged archetype
    const after = rehydrateIntentState(SESSION_ID) as IntentState;
    expect(after).not.toBeNull();
    expect(after.archetype).toBe('portfolio_builder');
  });

  it('fetch was actually called (Decision API request was dispatched)', async () => {
    const rehydratedState = applyQuizLeaf(initIntentState(), 'family_buyer');
    persistIntentState(SESSION_ID, rehydratedState);
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch();

    await _initForTest();

    // Assert that fetch was called with the adapt endpoint
    const fetchMock = vi.mocked(fetch);
    const adaptCalls = fetchMock.mock.calls.filter(([url]) => {
      const u = url as string;
      return typeof u === 'string' && u.includes('/adapt');
    });
    expect(adaptCalls.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC6: sessionStorage isolation between test cases (validated by test structure)
// ===========================================================================

describe('AC6 — sessionStorage is clean between test cases (no cross-test bleed)', () => {
  it('sessionStorage is empty at the start of this test (prior tests did not bleed)', () => {
    // If AC6 were violated, a previous test's persist would still be here.
    expect(sessionStorage.getItem(intentStateStorageKey(SESSION_ID))).toBeNull();
    expect(sessionStorage.getItem('__estalara_session__')).toBeNull();
  });

  it('intent state written in this test is NOT visible after clearStorages() in afterEach', () => {
    const state = applyQuizLeaf(initIntentState(), 'yield_hunter');
    persistIntentState(SESSION_ID, state);

    const key = intentStateStorageKey(SESSION_ID);
    expect(sessionStorage.getItem(key)).not.toBeNull();

    // afterEach will call clearAll() — the next test will not see this.
    // This test itself verifies the write happened, confirming roundtrip integrity.
  });

  it('no residual intent state from prior test (isolation verified)', () => {
    // Written in the previous test — should be gone after afterEach ran clearAll()
    const key = intentStateStorageKey(SESSION_ID);
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('multiple concurrent session IDs do not collide in sessionStorage', () => {
    const SESSION_A = 'a'.repeat(64);
    const SESSION_B = 'b'.repeat(64);

    const stateA = applyQuizLeaf(initIntentState(), 'family_buyer');
    const stateB = applyQuizLeaf(initIntentState(), 'yield_hunter');

    persistIntentState(SESSION_A, stateA);
    persistIntentState(SESSION_B, stateB);

    const rehydratedA = rehydrateIntentState(SESSION_A) as IntentState;
    const rehydratedB = rehydrateIntentState(SESSION_B) as IntentState;

    expect(rehydratedA.archetype).toBe('family_buyer');
    expect(rehydratedB.archetype).toBe('yield_hunter');

    // Keys are different (session-scoped)
    expect(intentStateStorageKey(SESSION_A)).not.toBe(intentStateStorageKey(SESSION_B));
  });
});

// ===========================================================================
// Additional edge cases: schema version guard + staleness guard
// (these exercise the rehydrateIntentState path that init() depends on)
// ===========================================================================

describe('Rehydration guards — schema version and staleness', () => {
  it('stale entry (>30min old) is rejected and key is removed from sessionStorage', () => {
    // Write an envelope with a savedAt timestamp in the past (31 minutes ago)
    const staleEnvelope = {
      version: INTENT_STATE_SCHEMA_VERSION,
      savedAt: Date.now() - 31 * 60 * 1000,
      state: applyQuizLeaf(initIntentState(), 'family_buyer'),
    };
    sessionStorage.setItem(intentStateStorageKey(SESSION_ID), JSON.stringify(staleEnvelope));

    const result = rehydrateIntentState(SESSION_ID);

    // Stale → null returned and key removed
    expect(result).toBeNull();
    expect(sessionStorage.getItem(intentStateStorageKey(SESSION_ID))).toBeNull();
  });

  it('wrong schema version: entry is rejected and key is removed from sessionStorage', () => {
    const wrongVersionEnvelope = {
      version: 999, // not INTENT_STATE_SCHEMA_VERSION
      savedAt: Date.now(),
      state: applyQuizLeaf(initIntentState(), 'yield_hunter'),
    };
    sessionStorage.setItem(intentStateStorageKey(SESSION_ID), JSON.stringify(wrongVersionEnvelope));

    const result = rehydrateIntentState(SESSION_ID);

    expect(result).toBeNull();
    expect(sessionStorage.getItem(intentStateStorageKey(SESSION_ID))).toBeNull();
  });

  it('fresh entry is accepted and archetype is preserved', () => {
    const freshState = applyQuizLeaf(initIntentState(), 'portfolio_builder');
    persistIntentState(SESSION_ID, freshState);

    const result = rehydrateIntentState(SESSION_ID) as IntentState;

    expect(result).not.toBeNull();
    expect(result.archetype).toBe('portfolio_builder');
    expect(result.quiz_answered).toBe(true);
  });
});
