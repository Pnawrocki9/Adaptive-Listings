// @vitest-environment jsdom
/**
 * FOLLOW-252 + FOLLOW-253 — chat-intent prior idempotency across the rehydrate boundary.
 *
 * Context (why this exists):
 *   RETRO-047 found that `_chatPriorAppliedSessionId` in adapt.ts was an in-memory module
 *   variable reset to null on page reload.  Because the IntentState (including the
 *   already-applied distribution) survives reload via sessionStorage, AND the 24h Redis
 *   shadow key persists, `/api/adapt` returns `chat_intent_dimensions` again on reload.
 *   With only the in-memory guard, `applyChatIntentPrior` re-folds the likelihoods onto
 *   the already-applied distribution — double-counting on every reload within the 24h window.
 *
 *   FOLLOW-252 (Option A) fixes this by adding `chatPriorApplied: boolean` to `IntentState`
 *   and checking it in `fetchDirectives` as the PRIMARY idempotency guard (persisted across
 *   reloads via sessionStorage).
 *
 * Rule R verification (this test closes the gap):
 *   The prior FOLLOW-101 test in follow-101.test.ts exercises only the in-memory
 *   `_chatPriorAppliedSessionId` guard within a single page lifecycle — it passes CI
 *   even when the reload-reapply hole is live.  The tests here drive the rehydrate→re-init
 *   path through the `_initForTest()` seam (Rule Q), which proves the PRIMARY persisted
 *   guard is correctly wired.
 *
 * Test strategy (per Rule Q amendment 2026-06-08):
 *   Each test drives the REAL init() body via `_initForTest()`.  No gate logic is
 *   re-implemented locally.  Dropping or inverting the `intentState.chatPriorApplied`
 *   guard in adapt.ts causes the relevant tests here to go RED.
 *
 * Acceptance criteria covered:
 *   FOLLOW-252 AC1: chat prior applied AT MOST ONCE across a hard page reload.
 *   FOLLOW-252 AC2: chat signal arriving AFTER first adapt (TG-2) still applies exactly once.
 *   FOLLOW-252 AC3: idempotency marker is persisted in IntentState envelope, NOT in-memory.
 *   FOLLOW-252 AC4: test through `_initForTest` rehydrate→re-init seam (this file).
 *   FOLLOW-252 AC5: `// Rule R:` comment present in guard code (verified by code review).
 *   FOLLOW-253 AC1: rehydrate→re-init path driven via `_initForTest` seam.
 *   FOLLOW-253 AC2: resumed archetype/confidence NOT re-perturbed; prior applied at most once.
 *   FOLLOW-253 AC3: TG-2 post-first-adapt chat arrival applies exactly once on rehydrated session.
 *
 * Environment: jsdom (real DOM, real sessionStorage, real localStorage).
 * fetch: mocked via vi.stubGlobal.
 *
 * @module packages/sdk/src/__tests__/follow-252
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest } from '../index.js';
import { resetAdaptState, setEventQueueRef } from '../core/adapt.js';
import {
  persistIntentState,
  intentStateStorageKey,
  INTENT_STATE_SCHEMA_VERSION,
} from '../core/session.js';
import { applyQuizLeaf, initIntentState } from '../core/intent.js';
import type { IntentState } from '../core/intent.js';
import type { CollectedEvent } from '../core/events.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_ID = 'e'.repeat(64);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal valid AdaptResponse that passes Zod schema validation.
 * No `chat_intent_dimensions` by default (added per-test as needed).
 */
const BASE_ADAPT_RESPONSE = {
  adapt_decision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  session_id: SESSION_ID,
  archetype: 'yield_hunter',
  confidence: 0.79,
  similarity: 0.88,
  tier: 1 as const,
  source: 'playbook' as const,
  generated_at: '2026-06-10T00:00:00.000Z',
  directives: [],
  variant: 'control',
};

/**
 * AdaptResponse that includes chat_intent_dimensions pointing to investment intent.
 * Strong enough to shift the distribution and, with a quiz-answered personal-use
 * state, trigger `chat_mismatch` detection.
 */
const ADAPT_WITH_CHAT_DIMS = {
  ...BASE_ADAPT_RESPONSE,
  chat_intent_dimensions: { purchase_purpose: 'investment' },
};

/**
 * AdaptResponse without chat dimensions — used for the first adapt call in TG-2.
 */
const ADAPT_NO_CHAT_DIMS = {
  ...BASE_ADAPT_RESPONSE,
  chat_intent_dimensions: null,
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
  script.dataset.apiKey = overrides.apiKey ?? 'test-key-follow252';
  if (overrides.decisionUrl !== undefined) {
    script.dataset.decisionUrl = overrides.decisionUrl;
    script.dataset.tenantId = overrides.tenantId ?? 'follow252-tenant';
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

function callTeardown(): void {
  const td = (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  if (td) {
    td();
    delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  }
}

/**
 * Stub fetch to return the given adapt response for `/adapt` calls and 200 for ingest.
 */
function stubFetch(adaptResponse: unknown = ADAPT_WITH_CHAT_DIMS): void {
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

/**
 * Stub fetch to return different responses on successive calls.
 * First call → `firstResponse`, subsequent calls → `laterResponse`.
 */
function stubFetchSequence(firstResponse: unknown, laterResponse: unknown): void {
  let callCount = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/adapt')) {
        callCount += 1;
        const body = callCount === 1 ? firstResponse : laterResponse;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }),
  );
}

/**
 * Read the full IntentState from the persisted sessionStorage envelope.
 */
function readPersistedState(sessionId: string): IntentState | null {
  const raw = sessionStorage.getItem(intentStateStorageKey(sessionId));
  if (!raw) return null;
  const envelope = JSON.parse(raw) as { version: number; state: IntentState | undefined };
  return envelope.state ?? null;
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach — isolation
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearAll();
  resetAdaptState();
  const q: CollectedEvent[] = [];
  setEventQueueRef(q);
  vi.restoreAllMocks();
});

afterEach(() => {
  callTeardown();
  clearAll();
  resetAdaptState();
  vi.restoreAllMocks();
});

// ===========================================================================
// FOLLOW-252 AC1 + FOLLOW-253 AC1/AC2:
//   chat prior applied AT MOST ONCE across a hard page reload
// ===========================================================================

describe('FOLLOW-252 AC1 / FOLLOW-253 AC2 — chat prior NOT re-applied after reload', () => {
  it('AC1 (primary): chatPriorApplied flag persisted after first init; second init skips prior', async () => {
    // === "Listing A" / first init: no rehydrated state, chat dims present in adapt response ===
    // Seed a quiz-answered state so applyChatIntentPrior receives non-trivial evidence.
    const coldState = applyQuizLeaf(initIntentState(), 'family_buyer');
    persistIntentState(SESSION_ID, coldState);

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_WITH_CHAT_DIMS);

    const firstState = await _initForTest();

    // First init: chat prior must have been applied.
    // The returned state is `currentIntentState` at init()-exit (after refreshDirectives).
    // Because the API returned chat_intent_dimensions and the state had chatPriorApplied=undefined,
    // fetchDirectives calls applyChatIntentPrior, sets chatPriorApplied=true, and persists.
    expect(firstState).not.toBeNull();

    // Verify chatPriorApplied=true is in sessionStorage (the persisted envelope).
    const persistedAfterFirst = readPersistedState(SESSION_ID);
    expect(persistedAfterFirst).not.toBeNull();
    expect(persistedAfterFirst!.chatPriorApplied).toBe(true);

    // Capture the post-first-apply distribution for comparison.
    const probsAfterFirst = { ...persistedAfterFirst!.probabilities };
    const confidenceAfterFirst = persistedAfterFirst!.confidence;

    // === Teardown the first init (simulates page reload / tab-level reset) ===
    callTeardown();
    removeScriptTags();
    // IMPORTANT: do NOT clear sessionStorage — the persisted state (chatPriorApplied=true)
    // must survive to be rehydrated in the second init.
    // Also do NOT clear sessionStorage session — same session ID survives reload.
    // DO reset the in-memory module variable (simulates fresh module-load on reload).
    resetAdaptState();

    // === "Listing A reload" / second init: same session, state rehydrated, chat dims again ===
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_WITH_CHAT_DIMS); // API still returns chat dims (24h window still active)

    const secondState = await _initForTest();

    // FOLLOW-252 AC1 (core assertion):
    // The second init rehydrates the state with chatPriorApplied=true and skips the prior.
    // Distribution must NOT be re-perturbed — probabilities must be identical to post-first.
    expect(secondState).not.toBeNull();

    const persistedAfterSecond = readPersistedState(SESSION_ID);
    expect(persistedAfterSecond).not.toBeNull();

    // chatPriorApplied must still be true (not reset by second init).
    expect(persistedAfterSecond!.chatPriorApplied).toBe(true);

    // The archetype probabilities must NOT have been re-perturbed.
    // If the double-count hole were still present, yield_hunter (boosted by investment dims)
    // would have a higher probability on the second init than the first.
    // We compare yield_hunter specifically — it is the primary archetype boosted by
    // purchase_purpose=investment (the chat_intent_dimensions used above).
    const yhAfterFirst = probsAfterFirst.yield_hunter;
    const yhAfterSecond = persistedAfterSecond!.probabilities.yield_hunter;

    // Allow a tiny floating-point tolerance but require near-equality.
    // If re-application occurred, yhAfterSecond >> yhAfterFirst (investment prior compounds).
    expect(yhAfterSecond).toBeCloseTo(yhAfterFirst, 10);

    // Confidence must also be stable.
    expect(persistedAfterSecond!.confidence).toBeCloseTo(confidenceAfterFirst, 10);
  });

  it('AC1 (regression guard): removing chatPriorApplied guard would cause re-perturbation', async () => {
    // This test documents the observable symptom that WOULD occur without the fix.
    // We verify the fix is in place by confirming the probabilities do NOT compound.
    // (This is the same assertion as above, framed as the regression guard.)

    const coldState = applyQuizLeaf(initIntentState(), 'family_buyer');
    persistIntentState(SESSION_ID, coldState);

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_WITH_CHAT_DIMS);

    const firstState = await _initForTest();
    expect(firstState).not.toBeNull();

    const yhBeforeReload = readPersistedState(SESSION_ID)?.probabilities.yield_hunter ?? 0;

    callTeardown();
    removeScriptTags();
    resetAdaptState();

    // Second init with same chat dims
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_WITH_CHAT_DIMS);

    await _initForTest();

    const yhAfterReload = readPersistedState(SESSION_ID)?.probabilities.yield_hunter ?? 0;

    // Without the fix: yhAfterReload >> yhBeforeReload (prior compounds each reload).
    // With the fix: yhAfterReload ≈ yhBeforeReload (prior applied only once, idempotent).
    expect(yhAfterReload).toBeCloseTo(yhBeforeReload, 10);
  });
});

// ===========================================================================
// FOLLOW-252 AC2 / FOLLOW-253 AC3:
//   TG-2 — chat signal arrives AFTER first adapt (first call returned no dims)
// ===========================================================================

describe('FOLLOW-252 AC2 / FOLLOW-253 AC3 — TG-2: chat dims arriving late still apply exactly once', () => {
  it('TG-2: first adapt returns no dims (chatPriorApplied=false), second returns dims → applied once', async () => {
    // Scenario: user arrives on a listing page. The first adapt call happens before the
    // chat NLP pipeline has processed any messages (no chat_intent_dimensions).
    // The user then chats, and on the SECOND adapt call (after behavioral signals trigger
    // a refetch), the shadow key exists and dims are returned. The prior must apply exactly once.
    //
    // This test drives the scenario through a TWO-CALL sequence using stubFetchSequence.

    const coldState = applyQuizLeaf(initIntentState(), 'family_buyer');
    persistIntentState(SESSION_ID, coldState);

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });

    // First call: no chat dims (cold shadow key, user hasn't chatted yet).
    // Second call and beyond: chat dims present (user has chatted).
    stubFetchSequence(ADAPT_NO_CHAT_DIMS, ADAPT_WITH_CHAT_DIMS);

    const firstInitState = await _initForTest();
    expect(firstInitState).not.toBeNull();

    // After first init (first adapt call returned no dims):
    // chatPriorApplied must still be false/undefined in the persisted state.
    // The persisted state after first init is the cold-start state (before any chat dims).
    // Note: the cold-start state is written by the FOLLOW-219 single cold-start block
    // on non-rehydrated init, so chatPriorApplied defaults to undefined (not present).
    const stateAfterFirstInit = readPersistedState(SESSION_ID);
    // chatPriorApplied should be falsy (undefined or false) — no dims were returned yet.
    expect(stateAfterFirstInit?.chatPriorApplied).toBeFalsy();

    callTeardown();
    removeScriptTags();
    resetAdaptState();

    // Now simulate the second adapt call by running _initForTest again.
    // This time, the fetch stub returns chat dims (simulating the user having chatted
    // between the first and second adapt calls — the shadow key now exists).
    //
    // The rehydrated state has chatPriorApplied=undefined, so the primary guard allows
    // the prior to be applied this time.
    insertScriptTag({ decisionUrl: apiBase });
    // Reset stub to always return chat dims now (shadow key fully populated).
    stubFetch(ADAPT_WITH_CHAT_DIMS);

    await _initForTest();

    const stateAfterSecondInit = readPersistedState(SESSION_ID);
    expect(stateAfterSecondInit).not.toBeNull();

    // FOLLOW-252 AC2 core assertion: chat prior was applied on the second adapt call.
    expect(stateAfterSecondInit!.chatPriorApplied).toBe(true);

    // Capture the distribution after first application.
    const yhAfterApplication = stateAfterSecondInit!.probabilities.yield_hunter;

    callTeardown();
    removeScriptTags();
    resetAdaptState();

    // Third init: same session, same chat dims, chatPriorApplied=true in persisted state.
    // The prior must NOT be applied again.
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_WITH_CHAT_DIMS);

    await _initForTest();

    const stateAfterThirdInit = readPersistedState(SESSION_ID);
    expect(stateAfterThirdInit).not.toBeNull();

    // FOLLOW-253 AC3: distribution must be stable (not re-perturbed on third init).
    expect(stateAfterThirdInit!.probabilities.yield_hunter).toBeCloseTo(yhAfterApplication, 10);
    expect(stateAfterThirdInit!.chatPriorApplied).toBe(true);
  });
});

// ===========================================================================
// FOLLOW-252 AC3:
//   idempotency marker is in the persisted IntentState envelope, NOT in-memory
// ===========================================================================

describe('FOLLOW-252 AC3 — chatPriorApplied is in the persisted sessionStorage envelope', () => {
  it('chatPriorApplied=true is serialised in the envelope state after fetchDirectives applies dims', async () => {
    const coldState = applyQuizLeaf(initIntentState(), 'family_buyer');
    persistIntentState(SESSION_ID, coldState);

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_WITH_CHAT_DIMS);

    await _initForTest();

    // Read the raw sessionStorage envelope directly (NOT via rehydrateIntentState,
    // which returns only the state object).
    const storageKey = intentStateStorageKey(SESSION_ID);
    const raw = sessionStorage.getItem(storageKey);
    expect(raw).not.toBeNull();

    const envelope = JSON.parse(raw!) as {
      version: number;
      savedAt: number;
      state: Record<string, unknown>;
    };

    // AC3: schema version must be correct (not bumped by FOLLOW-252 — chatPriorApplied
    // is an optional field, so no schema bump is needed).
    expect(envelope.version).toBe(INTENT_STATE_SCHEMA_VERSION);
    expect(envelope.savedAt).toBeGreaterThan(0);

    // AC3 core: chatPriorApplied must be present and true in the serialised state object.
    expect(envelope.state.chatPriorApplied).toBe(true);
  });

  it('chatPriorApplied absent in envelope when no chat dims were returned', async () => {
    // When the adapt response has no chat_intent_dimensions, the prior is not applied
    // and chatPriorApplied must NOT be written to the IntentState (remains undefined).
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    // No decision API → refreshDirectives skipped entirely, so intent state only persisted
    // by the cold-start block. chatPriorApplied is never set.
    insertScriptTag(); // no decisionUrl
    stubFetch(BASE_ADAPT_RESPONSE);

    await _initForTest();

    const storageKey = intentStateStorageKey(SESSION_ID);
    const raw = sessionStorage.getItem(storageKey);
    expect(raw).not.toBeNull();

    const envelope = JSON.parse(raw!) as {
      state: Record<string, unknown>;
    };

    // chatPriorApplied must be absent (undefined) since no dims were returned.
    expect(envelope.state.chatPriorApplied).toBeUndefined();
  });
});

// ===========================================================================
// FOLLOW-252 AC1 (cross-listing navigation within same tab lifecycle):
//   secondary in-memory guard still works for same-tab navigation
// ===========================================================================

describe('FOLLOW-252 AC1 — in-tab navigation: prior applied once even without reload', () => {
  it('two sequential adapt calls in same init: prior applied on first, skipped on second', async () => {
    // This drives the FOLLOW-101 AC-5 scenario but also verifies the primary guard.
    // The secondary in-memory guard (_chatPriorAppliedSessionId) handles this case.
    // We verify the outcome is the same as before: prior applied at most once per init().

    const coldState = applyQuizLeaf(initIntentState(), 'family_buyer');
    persistIntentState(SESSION_ID, coldState);

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');

    const apiBase = 'https://test-api.estalara.com/api';
    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_WITH_CHAT_DIMS);

    // First full init — includes one refreshDirectives() call
    const firstState = await _initForTest();
    expect(firstState).not.toBeNull();

    // After init, chatPriorApplied must be true in persisted state.
    const persisted = readPersistedState(SESSION_ID);
    expect(persisted?.chatPriorApplied).toBe(true);

    // Distribution after first application.
    const yhAfterFirst = persisted!.probabilities.yield_hunter;

    // Now run init AGAIN without resetting sessionStorage (same session, same tab lifecycle).
    // This simulates a SPA re-mount or a second SDK init call in the same page lifecycle.
    callTeardown();
    removeScriptTags();
    // Do NOT call resetAdaptState() — simulating same-tab navigation, not a full reset.

    insertScriptTag({ decisionUrl: apiBase });
    stubFetch(ADAPT_WITH_CHAT_DIMS); // dims still present

    await _initForTest();

    // chatPriorApplied must still be true and probabilities must be stable.
    const persistedAfterSecondInit = readPersistedState(SESSION_ID);
    expect(persistedAfterSecondInit?.chatPriorApplied).toBe(true);
    expect(persistedAfterSecondInit!.probabilities.yield_hunter).toBeCloseTo(yhAfterFirst, 10);
  });
});
