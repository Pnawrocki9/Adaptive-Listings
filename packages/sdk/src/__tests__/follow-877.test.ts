// @vitest-environment jsdom
/**
 * FOLLOW-877 — the `aboveFloor` gate is a DISJUNCTION, and it covers the description axis.
 *
 * WHY THIS FILE EXISTS (RETRO-259 §4b CB-1, FOLLOW-875):
 *   `adapt-floor.ts` used to document `DOM_ADAPT_CONFIDENCE_FLOOR` as the "SOLE" gate of the
 *   `/adapt/description` path. The shipped code never matched that: `index.ts:827-829` ORs in
 *   `signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT`, and BOTH `applyDirectives()` and the
 *   fire-and-forget `applyDescriptionAdaptation()` sit inside that single `if (aboveFloor)`
 *   block (`index.ts:831-857`). The docblock is corrected in the same PR; these tests are what
 *   keep code and docblock from diverging again.
 *
 * WHAT EACH TEST PROTECTS — every case below is written so that a specific edit turns it RED:
 *   D-1  `||` → `&&`               : below-floor + 2 signals must STILL fetch the description.
 *   D-2  `||` → `&&`               : above-floor + 0 signals must STILL fetch the description.
 *   D-3  gate removed / weakened   : below-floor + 1 signal must NOT fetch anything.
 *   D-4  description call hoisted
 *        OUT of `if (aboveFloor)`  : same setup as D-3, asserted on the description axis
 *                                    specifically — if the call moves above/below the block it
 *                                    fires on a cold-start session and this goes red.
 *   D-5  the 0.5–0.59 ASYMMETRY    : the interesting case the old docblock only described.
 *                                    The server returns `[]` for directives (it gates at
 *                                    `confidence <= 0.6`, route.ts:275) while the SDK fetches
 *                                    and applies a description anyway. Asserted on BOTH axes in
 *                                    one run: DOM headline unchanged, description slot changed.
 *   D-6  constant drift            : the two constants and the server threshold they ladder
 *                                    against.
 *
 * NOTE ON SCOPE: these tests LOCK CURRENT BEHAVIOR. Whether the description axis SHOULD ride the
 * `signal_count >= 2` escape hatch is an open product decision (ESC-054) — if it is decided the
 * other way, D-1 is the test that must be deliberately inverted, and that inversion is the
 * record of the decision.
 *
 * Stub discipline is inherited from follow-354.test.ts: the `/adapt/description` match MUST be
 * checked BEFORE the generic `/adapt` match, because the former is a path suffix of the latter.
 *
 * Environment: jsdom (real DOM, real sessionStorage, real localStorage).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest, DOM_ADAPT_CONFIDENCE_FLOOR, DOM_ADAPT_MIN_SIGNAL_COUNT } from '../index.js';
import { initIntentState } from '../core/intent.js';
import { persistIntentState } from '../core/session.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pre-seeded session ID — bypasses fingerprint generation in getOrCreateSession(). */
const SESSION_ID = '7'.repeat(64);

const LISTING_ID = 'listing-877-test';
const DECISION_API_URL = 'https://decision.estalara.com/api';
const HEADLINE_SLOT = 'headline';
const ORIGINAL_HEADLINE = 'Original agent-authored headline.';
const ADAPTED_HEADLINE = 'Adapted headline for yield hunters.';
const ORIGINAL_DESCRIPTION = 'Original agent-authored long-form description.';
const ADAPTED_DESCRIPTION = 'AI-adapted long-form description for yield hunter investors.';

/**
 * The server-side directive gate, mirrored here so this suite can emulate production.
 *
 * Source of truth: `apps/control-plane/src/app/api/adapt/route.ts:86`
 * (`const CONFIDENCE_THRESHOLD = 0.6;`) applied at `route.ts:275` as
 * `if (confidence <= CONFIDENCE_THRESHOLD) return { directives: [], source: 'default' };`
 * — note `<=`, so the bar is strictly greater than 0.6. That boundary is locked
 * server-side by `apps/control-plane/src/app/api/adapt/route.test.ts:267`
 * ("Branch 1 edge: confidence exactly 0.6 → source: default").
 *
 * Duplicated as a literal rather than imported: `packages/sdk` must not depend on
 * `apps/control-plane`. Same precedent as `follow-343.test.ts:212`.
 */
const SERVER_CONFIDENCE_THRESHOLD = 0.6;

/** Minimal valid AdaptResponse matching the SDK's Zod schema. */
const BASE_ADAPT_RESPONSE = {
  adapt_decision_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  session_id: SESSION_ID,
  archetype: 'yield_hunter',
  similarity: 0.88,
  page_context: 2 as const,
  source: 'playbook' as const,
  generated_at: '2026-08-07T00:00:00.000Z',
  variant: 'control',
};

/** Minimal valid DescriptionResponse that passes fetchDescription()'s guards. */
const DESCRIPTION_RESPONSE = {
  source: 'ai_cached' as const,
  description: ADAPTED_DESCRIPTION,
  locale: 'en',
  generated_at: '2026-08-07T00:00:00.000Z',
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

/**
 * Seed a rehydratable intent state with an explicit `signal_count`.
 *
 * This is the ONLY way to drive the second branch of the disjunction from a unit test:
 * `signal_count` is not part of the `/adapt` request or response contract, so it cannot be
 * injected through the fetch stub. `_initForTest()` rehydrates this envelope before the first
 * `refreshDirectives()` (FOLLOW-216).
 */
function seedIntentState(signalCount: number, confidence: number): void {
  persistIntentState(SESSION_ID, {
    ...initIntentState(),
    archetype: 'yield_hunter',
    signal_count: signalCount,
    confidence,
  });
}

function insertScriptTag(): HTMLScriptElement {
  const script = document.createElement('script');
  script.dataset.apiKey = 'test-follow877-api-key';
  script.dataset.decisionUrl = DECISION_API_URL;
  script.dataset.tenantId = 'follow877-tenant-id';
  document.head.appendChild(script);
  return script;
}

/**
 * Insert BOTH slots plus the listing id, so the only variable across tests is the gate:
 *   - `[data-estalara-slot="headline"]`    — target of the directive axis
 *   - `[data-estalara-slot="description"]` — target of the description axis
 *   - `[data-estalara-listing-id]`         — required by applyDescriptionAdaptation():403-411
 */
function insertDom(): { headline: HTMLElement; description: HTMLElement } {
  const container = document.createElement('div');
  container.setAttribute('data-estalara-listing-id', LISTING_ID);

  const headline = document.createElement('h2');
  headline.setAttribute('data-estalara-slot', HEADLINE_SLOT);
  headline.textContent = ORIGINAL_HEADLINE;

  const description = document.createElement('div');
  description.setAttribute('data-estalara-slot', 'description');
  description.textContent = ORIGINAL_DESCRIPTION;

  container.append(headline, description);
  document.body.appendChild(container);
  return { headline, description };
}

function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  document.querySelectorAll<HTMLScriptElement>('script[data-api-key]').forEach((el) => {
    el.remove();
  });
  document.querySelectorAll('[data-estalara-host]').forEach((el) => {
    el.remove();
  });
  document.querySelectorAll('[data-estalara-listing-id]').forEach((el) => {
    el.remove();
  });
  document.querySelectorAll('[data-estalara-slot]').forEach((el) => {
    el.remove();
  });
}

/**
 * Stub `fetch` and EMULATE THE SERVER GATE.
 *
 * `emulateServerGate: true` reproduces `route.ts:275` — at `confidence <= 0.6` the response
 * carries `directives: []`, exactly as production does. This is what makes D-5 a real
 * asymmetry test rather than a restatement of the SDK gate: the directive axis is silenced by
 * the SERVER while the description axis is opened by the SDK.
 */
function stubFetch(confidence: number, emulateServerGate: boolean): ReturnType<typeof vi.fn> {
  const serverSuppressed = emulateServerGate && confidence <= SERVER_CONFIDENCE_THRESHOLD;
  const adaptResponse = {
    ...BASE_ADAPT_RESPONSE,
    confidence,
    ...(serverSuppressed
      ? { directives: [] as [], source: 'default' as const }
      : {
          directives: [
            {
              type: 'text' as const,
              slot: HEADLINE_SLOT,
              value: ADAPTED_HEADLINE,
              archetype: 'yield_hunter',
              confidence,
            },
          ],
        }),
  };

  const mockFn = vi.fn().mockImplementation((url: string) => {
    // Description check FIRST — '/adapt' is a prefix of '/adapt/description'.
    if (typeof url === 'string' && url.includes('/adapt/description')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(DESCRIPTION_RESPONSE),
      });
    }
    if (typeof url === 'string' && url.includes('/adapt')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(adaptResponse),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });

  vi.stubGlobal('fetch', mockFn);
  return mockFn;
}

function descriptionFetches(mockFn: ReturnType<typeof vi.fn>): string[] {
  return (mockFn.mock.calls as unknown as [string, ...unknown[]][])
    .map(([url]) => url)
    .filter((url) => typeof url === 'string' && url.includes('/adapt/description'));
}

/** Let the fire-and-forget `applyDescriptionAdaptation()` chain settle before asserting DOM. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearAll();
  vi.restoreAllMocks();
});

afterEach(() => {
  const teardown = (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  if (teardown) {
    teardown();
    delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  }
  clearAll();
  vi.restoreAllMocks();
});

// ===========================================================================
// D-1 / D-2 — the gate is `||`, not `&&`, and it covers the description axis
// ===========================================================================

describe('FOLLOW-877 — aboveFloor is a DISJUNCTION on the description axis', () => {
  it('D-1: below the floor, signal_count >= 2 alone STILL fetches /adapt/description', async () => {
    // Swapping `||` for `&&` at index.ts:827-829 makes aboveFloor false here → RED.
    const belowFloor = DOM_ADAPT_CONFIDENCE_FLOOR - 0.2; // 0.30
    insertDom();
    seedSession();
    seedIntentState(DOM_ADAPT_MIN_SIGNAL_COUNT, belowFloor);
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    const mockFetch = stubFetch(belowFloor, false);
    await _initForTest();

    expect(descriptionFetches(mockFetch).length).toBeGreaterThanOrEqual(1);
  });

  it('D-2: at the floor, signal_count 0 alone STILL fetches /adapt/description', async () => {
    // The mirror image of D-1: `&&` would also make this false → RED. Together D-1 and D-2
    // pin the operator from both sides; neither alone would catch every swap.
    insertDom();
    seedSession();
    seedIntentState(0, DOM_ADAPT_CONFIDENCE_FLOOR);
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    const mockFetch = stubFetch(DOM_ADAPT_CONFIDENCE_FLOOR, false);
    await _initForTest();

    expect(descriptionFetches(mockFetch).length).toBeGreaterThanOrEqual(1);
  });

  it('D-3: neither branch true (0.30 confidence, 1 signal) → NO /adapt/description fetch', async () => {
    // Deleting the `if (aboveFloor)` block, or replacing the disjunction with a tautology,
    // turns this RED. It is also the D-4 assertion: if `applyDescriptionAdaptation()` is
    // hoisted OUT of the gate, a cold-start session fetches and this goes red.
    insertDom();
    seedSession();
    seedIntentState(DOM_ADAPT_MIN_SIGNAL_COUNT - 1, DOM_ADAPT_CONFIDENCE_FLOOR - 0.2);
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    const mockFetch = stubFetch(DOM_ADAPT_CONFIDENCE_FLOOR - 0.2, false);
    await _initForTest();
    await flushMicrotasks();

    expect(descriptionFetches(mockFetch)).toHaveLength(0);
  });

  it('D-4: with neither branch true the description slot keeps its ORIGINAL text', async () => {
    // D-3 asserts the fetch; this asserts the DOM. Both are needed: a future refactor could
    // keep the fetch inside the gate but move the slot write outside it.
    const { description } = insertDom();
    seedSession();
    seedIntentState(DOM_ADAPT_MIN_SIGNAL_COUNT - 1, DOM_ADAPT_CONFIDENCE_FLOOR - 0.2);
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    stubFetch(DOM_ADAPT_CONFIDENCE_FLOOR - 0.2, false);
    await _initForTest();
    await flushMicrotasks();

    expect(description.textContent).toBe(ORIGINAL_DESCRIPTION);
  });
});

// ===========================================================================
// D-5 — the 0.5–0.59 asymmetry, tested rather than described (FOLLOW-877 AC-4)
// ===========================================================================

describe('FOLLOW-877 AC-4 — the 0.5–0.59 band: server says no directives, SDK still adapts copy', () => {
  it('D-5: at 0.55 the server returns [] for directives yet the description IS fetched and applied', async () => {
    const band = 0.55; // >= DOM_ADAPT_CONFIDENCE_FLOOR (0.5), <= SERVER_CONFIDENCE_THRESHOLD (0.6)
    expect(band).toBeGreaterThanOrEqual(DOM_ADAPT_CONFIDENCE_FLOOR);
    expect(band).toBeLessThanOrEqual(SERVER_CONFIDENCE_THRESHOLD);

    const { headline, description } = insertDom();
    seedSession();
    seedIntentState(0, band);
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    // emulateServerGate: true → this response carries directives: [] exactly as route.ts:275 does.
    const mockFetch = stubFetch(band, true);
    await _initForTest();
    await flushMicrotasks();

    // Directive axis: silenced by the SERVER, not by the SDK floor.
    expect(headline.textContent).toBe(ORIGINAL_HEADLINE);
    // Description axis: no server-side confidence parameter exists, so the SDK proceeds.
    expect(descriptionFetches(mockFetch).length).toBeGreaterThanOrEqual(1);
    expect(description.textContent).toBe(ADAPTED_DESCRIPTION);
  });

  it('D-5b: the same asymmetry holds BELOW the floor once signal_count >= 2', async () => {
    // This is the case FOLLOW-877 was filed for and the one the old docblock denied: at 0.30
    // confidence — cold-start territory, the exact scenario FOLLOW-343 was opened to stop —
    // two behavioral signals are enough to put LLM-generated copy on the page.
    const cold = 0.3;
    const { headline, description } = insertDom();
    seedSession();
    seedIntentState(DOM_ADAPT_MIN_SIGNAL_COUNT, cold);
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    const mockFetch = stubFetch(cold, true);
    await _initForTest();
    await flushMicrotasks();

    expect(headline.textContent).toBe(ORIGINAL_HEADLINE); // server gate held
    expect(descriptionFetches(mockFetch).length).toBeGreaterThanOrEqual(1);
    expect(description.textContent).toBe(ADAPTED_DESCRIPTION); // SDK gate did not
  });
});

// ===========================================================================
// D-6 — the gating ladder constants (drift guard)
// ===========================================================================

describe('FOLLOW-877/875 — gating ladder constants', () => {
  it('D-6a: DOM_ADAPT_CONFIDENCE_FLOOR is 0.5 and DOM_ADAPT_MIN_SIGNAL_COUNT is 2', () => {
    expect(DOM_ADAPT_CONFIDENCE_FLOOR).toBe(0.5);
    expect(DOM_ADAPT_MIN_SIGNAL_COUNT).toBe(2);
  });

  it('D-6b: the SDK floor sits strictly below the server threshold, and the server bar is STRICTLY greater than 0.6', () => {
    // route.ts:275 is `confidence <= CONFIDENCE_THRESHOLD → []`, so 0.6 itself is suppressed.
    // Any ticket that quotes "clear 0.6" is quoting the wrong bar (FOLLOW-875 AC-1).
    expect(DOM_ADAPT_CONFIDENCE_FLOOR).toBeLessThan(SERVER_CONFIDENCE_THRESHOLD);
    expect(SERVER_CONFIDENCE_THRESHOLD).toBe(0.6);
  });
});
