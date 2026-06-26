// @vitest-environment jsdom
/**
 * FOLLOW-343 — Confidence / signal floor before DOM adaptation.
 *
 * Problem (AUDIT-2026-06-19 F-01):
 *   `refreshDirectives()` called `applyDirectives()` unconditionally whenever a
 *   response existed, including the cold-start init call before any behavioral signal.
 *   The Bayesian cold-start prior is BASE_PRIOR (~0.37) + device/referrer hints; a
 *   single weak hint can push argmax above neutral at ~0.05–0.10 confidence, causing
 *   a wrong-archetype page reshuffle on first load.
 *
 * Fix:
 *   Gate DOM mutation behind:
 *     (a) resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR (0.5), OR
 *     (b) currentIntentState.signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT (2)
 *
 * Acceptance criteria tested here:
 *   AC1: No DOM mutation / reorder applied below the floor; neutral layout preserved.
 *   AC2: Floor value is a named constant (importable) and tested at the boundary
 *        (0.499… = no-op, 0.5 = applies).
 *   AC3: No regression to the quiz/drift path: quiz leaf resolves at 0.85 (above floor).
 *   AC4: signal_count >= 2 alternative gate allows adaptation even below confidence floor.
 *
 * Test strategy:
 *   Uses the `_initForTest()` seam (Rule Q) to drive the REAL `init()` body.
 *   DOM slots are inserted into jsdom's `document.body` before calling `_initForTest()`;
 *   after the call we assert whether the slot text was mutated.
 *
 *   The `aboveFloor` gate lives entirely in `index.ts:refreshDirectives()` — mutating
 *   any constant or removing the `if (aboveFloor)` block will turn these tests RED.
 *
 * Environment: jsdom (real DOM, real sessionStorage, real localStorage).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest, DOM_ADAPT_CONFIDENCE_FLOOR, DOM_ADAPT_MIN_SIGNAL_COUNT } from '../index.js';

import { applyQuizLeaf, initIntentState } from '../core/intent.js';
import { persistIntentState } from '../core/session.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pre-seeded session ID — bypasses fingerprint generation in getOrCreateSession(). */
const SESSION_ID = 'e'.repeat(64);

/** Minimal valid AdaptResponse matching the SDK's Zod schema. */
const BASE_ADAPT_RESPONSE = {
  adapt_decision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  session_id: SESSION_ID,
  archetype: 'yield_hunter',
  similarity: 0.88,
  tier: 1 as const,
  source: 'playbook' as const,
  generated_at: '2026-06-19T00:00:00.000Z',
  directives: [] as {
    type: 'text';
    slot: string;
    value: string;
    archetype: string;
    confidence: number;
  }[],
  ttl_seconds: 300,
  variant: 'control',
};

/** The data-estalara-slot name used in DOM slot fixtures. */
const SLOT_NAME = 'follow_343_headline';

/** Original text set on the slot element before init(). */
const ORIGINAL_TEXT = 'Original headline — must not be replaced below floor';

/** Adapted text returned by mock adapt API directives. */
const ADAPTED_TEXT = 'Adapted headline for yield_hunter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pre-seed a known session into sessionStorage so getOrCreateSession() reuses it. */
function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

/** Insert a <script data-api-key> tag that init() finds via querySelector. */
function insertScriptTag(overrides: Record<string, string> = {}): HTMLScriptElement {
  const script = document.createElement('script');
  script.dataset.apiKey = overrides.apiKey ?? 'test-follow343-key';
  if (overrides.decisionUrl !== undefined) {
    script.dataset.decisionUrl = overrides.decisionUrl;
    script.dataset.tenantId = overrides.tenantId ?? 'follow343-tenant-id';
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

/** Clear sessionStorage, localStorage, and DOM artefacts from init(). */
function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  removeScriptTags();
  document.querySelectorAll('[data-estalara-host]').forEach((el) => {
    el.remove();
  });
}

/**
 * Insert a DOM slot element into document.body that init()'s applyDirectives will target.
 * Returns the element so callers can inspect its textContent post-init.
 */
function insertSlotElement(): HTMLHeadingElement {
  const el = document.createElement('h2');
  el.setAttribute('data-estalara-slot', SLOT_NAME);
  el.textContent = ORIGINAL_TEXT;
  document.body.appendChild(el);
  return el;
}

/** Remove all slot elements created by insertSlotElement(). */
function removeSlotElements(): void {
  document.querySelectorAll(`[data-estalara-slot="${SLOT_NAME}"]`).forEach((el) => {
    el.remove();
  });
}

/**
 * Stub `fetch` globally with the given confidence.
 *
 * When the URL contains `/adapt` returns a valid AdaptResponse with a
 * TextDirective targeting SLOT_NAME.  All other URLs return 200 OK (ingest).
 */
function stubFetchWithConfidence(confidence: number): void {
  const response = {
    ...BASE_ADAPT_RESPONSE,
    confidence,
    directives: [
      {
        type: 'text' as const,
        slot: SLOT_NAME,
        value: ADAPTED_TEXT,
        archetype: 'yield_hunter',
        confidence,
      },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/adapt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(response),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }),
  );
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearAll();
  removeSlotElements();
  vi.restoreAllMocks();
});

afterEach(() => {
  const teardown = (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  if (teardown) {
    teardown();
    delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  }
  clearAll();
  removeSlotElements();
  vi.restoreAllMocks();
});

// ===========================================================================
// AC2 — Named constants are exported and have expected values
// ===========================================================================

describe('AC2 — named constants (FOLLOW-343)', () => {
  it('DOM_ADAPT_CONFIDENCE_FLOOR is exported and equals 0.5', () => {
    expect(DOM_ADAPT_CONFIDENCE_FLOOR).toBe(0.5);
  });

  it('DOM_ADAPT_MIN_SIGNAL_COUNT is exported and equals 2', () => {
    expect(DOM_ADAPT_MIN_SIGNAL_COUNT).toBe(2);
  });

  it('DOM_ADAPT_CONFIDENCE_FLOOR is strictly below the server CONFIDENCE_THRESHOLD (0.6) so the SDK floor does not duplicate the server gate', () => {
    // The server /api/adapt route gates directives at CONFIDENCE_THRESHOLD = 0.6 (route.ts).
    // The SDK floor (0.5) must stay below that value so the description fetch (gated by SDK
    // floor only) can proceed at 0.5–0.59 while the server still returns [] for directives.
    // There is no SIDEBAR_SHOW_THRESHOLD constant in index.ts — the sidebar is admin-only.
    expect(DOM_ADAPT_CONFIDENCE_FLOOR).toBeLessThan(0.6);
  });
});

// ===========================================================================
// AC1 — Below floor: no DOM mutation
// ===========================================================================

describe('AC1 — below floor: applyDirectives is NOT called (FOLLOW-343)', () => {
  it('does NOT mutate DOM slot text when confidence is 0 (cold-start prior)', async () => {
    // Cold-start: signal_count = 0, confidence = 0 (below floor of 0.5)
    const slotEl = insertSlotElement();

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag({
      decisionUrl: 'https://decision.estalara.com/api',
    });
    stubFetchWithConfidence(0.0);

    await _initForTest();

    // DOM must be unchanged
    expect(slotEl.textContent).toBe(ORIGINAL_TEXT);
  });

  it('does NOT mutate DOM slot text when confidence is 0.37 (typical Bayesian neutral prior)', async () => {
    const slotEl = insertSlotElement();

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag({
      decisionUrl: 'https://decision.estalara.com/api',
    });
    stubFetchWithConfidence(0.37);

    await _initForTest();

    expect(slotEl.textContent).toBe(ORIGINAL_TEXT);
  });

  it('does NOT mutate DOM slot text at exactly one step below floor (0.499)', async () => {
    const slotEl = insertSlotElement();

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag({
      decisionUrl: 'https://decision.estalara.com/api',
    });
    // 0.499 — just below the 0.5 floor boundary
    stubFetchWithConfidence(0.499);

    await _initForTest();

    expect(slotEl.textContent).toBe(ORIGINAL_TEXT);
  });
});

// ===========================================================================
// AC2 — At and above floor: DOM mutation IS applied
// ===========================================================================

describe('AC2 — at/above floor: applyDirectives IS called (FOLLOW-343)', () => {
  it('DOES mutate DOM slot text when confidence is exactly at the floor (0.5)', async () => {
    const slotEl = insertSlotElement();

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag({
      decisionUrl: 'https://decision.estalara.com/api',
    });
    stubFetchWithConfidence(0.5);

    await _initForTest();

    expect(slotEl.textContent).toBe(ADAPTED_TEXT);
  });

  it('DOES mutate DOM slot text when confidence is well above the floor (0.75)', async () => {
    const slotEl = insertSlotElement();

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag({
      decisionUrl: 'https://decision.estalara.com/api',
    });
    stubFetchWithConfidence(0.75);

    await _initForTest();

    expect(slotEl.textContent).toBe(ADAPTED_TEXT);
  });
});

// ===========================================================================
// AC3 — Quiz / drift path: confidence 0.85 is always above the floor
// ===========================================================================

describe('AC3 — quiz leaf at 0.85 is above floor — no regression (FOLLOW-343)', () => {
  it('DOES mutate DOM when the session was quiz-answered (confidence 0.85)', async () => {
    // Simulate a session where the quiz was already answered on a previous listing page
    // (Listing A → applyQuizLeaf sets confidence=0.85, persisted to sessionStorage).
    const quizState = applyQuizLeaf(initIntentState(), 'family_buyer');
    persistIntentState(SESSION_ID, quizState);

    const slotEl = insertSlotElement();

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag({
      decisionUrl: 'https://decision.estalara.com/api',
    });

    // Decision API returns 0.85 (quiz leaf level)
    stubFetchWithConfidence(0.85);

    await _initForTest();

    // Quiz leaf is well above floor (0.85 >= 0.5) — DOM MUST be adapted
    expect(slotEl.textContent).toBe(ADAPTED_TEXT);
  });

  it('quiz leaf confidence (0.85) satisfies floor (0.5) by a margin of 0.35', () => {
    // Invariant test: ensures quiz leaf confidence ALWAYS exceeds the floor, even if
    // the floor value is bumped in the future. If DOM_ADAPT_CONFIDENCE_FLOOR is raised
    // above 0.85 this test goes RED — intentional (the quiz path would break).
    const quizLeafConfidence = 0.85;
    expect(quizLeafConfidence).toBeGreaterThanOrEqual(DOM_ADAPT_CONFIDENCE_FLOOR);
  });
});

// ===========================================================================
// AC4 — signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT enables DOM even below floor
// ===========================================================================

describe('AC4 — signal_count gate: DOM applied at signal_count >= 2 even if confidence < 0.5 (FOLLOW-343)', () => {
  it('DOES mutate DOM when signal_count >= 2 and confidence is below floor', async () => {
    // Pre-seed intent state with signal_count = 2 (user has interacted twice)
    // but confidence still below 0.5 (e.g. mixed signals cancel each other).
    const baseState = initIntentState();
    // Manually construct a state with signal_count = 2 at low confidence.
    // We use persistIntentState so the SDK rehydrates it in init().
    const lowConfidenceMultiSignalState = {
      ...baseState,
      signal_count: 2,
      // Confidence below floor but signal_count satisfies the alternative gate.
      confidence: 0.4,
    };
    persistIntentState(SESSION_ID, lowConfidenceMultiSignalState);

    const slotEl = insertSlotElement();

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag({
      decisionUrl: 'https://decision.estalara.com/api',
    });

    // API also returns low confidence — signal_count gate must carry the decision
    stubFetchWithConfidence(0.4);

    await _initForTest();

    // signal_count (2) >= DOM_ADAPT_MIN_SIGNAL_COUNT (2) — DOM MUST be adapted
    // despite confidence (0.4) < DOM_ADAPT_CONFIDENCE_FLOOR (0.5)
    expect(slotEl.textContent).toBe(ADAPTED_TEXT);
  });

  it('does NOT mutate DOM when signal_count = 1 and confidence is below floor', async () => {
    // One signal is not enough — still a cold-start ambiguity scenario.
    const baseState = initIntentState();
    const oneSignalState = {
      ...baseState,
      signal_count: 1,
      confidence: 0.45,
    };
    persistIntentState(SESSION_ID, oneSignalState);

    const slotEl = insertSlotElement();

    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag({
      decisionUrl: 'https://decision.estalara.com/api',
    });

    stubFetchWithConfidence(0.45);

    await _initForTest();

    // signal_count (1) < DOM_ADAPT_MIN_SIGNAL_COUNT (2) AND confidence (0.45) < floor (0.5)
    // — DOM must NOT be mutated
    expect(slotEl.textContent).toBe(ORIGINAL_TEXT);
  });
});
