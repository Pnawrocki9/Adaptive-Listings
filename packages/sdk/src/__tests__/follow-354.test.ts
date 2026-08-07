// @vitest-environment jsdom
/**
 * FOLLOW-354 — Confidence floor description-axis tests.
 *
 * Context:
 *   The 12 existing tests in follow-343.test.ts assert the DIRECTIVE axis: whether
 *   text/class/reorder directives from /api/adapt are applied or suppressed by the
 *   DOM_ADAPT_CONFIDENCE_FLOOR gate.
 *
 *   Those tests use `url.includes('/adapt')` as the fetch stub matcher. That pattern
 *   is COLLIDING: it matches BOTH /api/adapt (directive endpoint) AND
 *   /api/adapt/description (description endpoint), because the latter is a path suffix
 *   of the former. In the existing tests the collision is harmless because no description
 *   slots are in the DOM — applyDescriptionAdaptation() exits early before fetching.
 *   But that collision makes it IMPOSSIBLE to assert description-axis behaviour with
 *   the existing stub pattern.
 *
 *   The description axis is the genuine value of the floor:
 *     - /api/adapt has a server-side CONFIDENCE_THRESHOLD = 0.6 gate (returns [] AT or
 *       below it — route.ts:275 is `confidence <= CONFIDENCE_THRESHOLD`, so the bar is
 *       strictly > 0.6), so the SDK floor is REDUNDANT on the directive axis.
 *     - /adapt/description has NO server-side confidence parameter. The client-side
 *       `aboveFloor` DISJUNCTION — confidence >= DOM_ADAPT_CONFIDENCE_FLOOR (0.5) OR
 *       signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT (2), index.ts:827-829 — is the only
 *       confidence-shaped gate for description fetches. (This header previously called
 *       the 0.5 floor the "SOLE" gate — the exact wording PR #692 withdrew from
 *       adapt-floor.ts, contradicted by AC-1 below; corrected 2026-08-07, FOLLOW-887.
 *       Whether the signal_count branch SHOULD hold on this axis is OPEN in ESC-054.)
 *
 * These tests use a DISTINCT stub that checks `url.includes('/adapt/description')` BEFORE
 * the generic `url.includes('/adapt')` check, isolating the two endpoints.
 *
 * Acceptance criteria:
 *   AC-1: No /adapt/description fetch when confidence < DOM_ADAPT_CONFIDENCE_FLOOR AND
 *         signal_count < DOM_ADAPT_MIN_SIGNAL_COUNT. RED without the FOLLOW-343 floor gate.
 *   AC-2: /adapt/description fetch IS issued at/above the floor (positive control).
 *
 * DOM setup rationale:
 *   Both AC-1 and AC-2 set up [data-estalara-slot="description"] AND [data-estalara-listing-id]
 *   in the DOM. This ensures that if applyDescriptionAdaptation() WERE called (i.e. if the
 *   aboveFloor gate were absent), the description fetch WOULD happen. The only variable
 *   between the two test groups is whether confidence meets the floor — not whether the
 *   inner guards inside applyDescriptionAdaptation() allow the fetch.
 *
 * Environment: jsdom (real DOM, real sessionStorage, real localStorage).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _initForTest, DOM_ADAPT_CONFIDENCE_FLOOR, DOM_ADAPT_MIN_SIGNAL_COUNT } from '../index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pre-seeded session ID — bypasses fingerprint generation in getOrCreateSession(). */
const SESSION_ID = '3'.repeat(64);

const LISTING_ID = 'listing-354-test';
const DECISION_API_URL = 'https://decision.estalara.com/api';

/**
 * Minimal valid AdaptResponse matching the SDK's Zod schema.
 * `confidence` is NOT included here — each stub function adds it per-test.
 *
 * Uses 'yield_hunter' (non-neutral) so applyDescriptionAdaptation() is not
 * short-circuited by the archetype === 'neutral' guard.
 */
const BASE_ADAPT_RESPONSE = {
  adapt_decision_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  session_id: SESSION_ID,
  archetype: 'yield_hunter',
  similarity: 0.88,
  page_context: 2 as const,
  source: 'playbook' as const,
  generated_at: '2026-06-26T00:00:00.000Z',
  directives: [] as [],
  variant: 'control',
};

/**
 * Minimal valid DescriptionResponse that passes fetchDescription()'s guards.
 * source==='ai_cached' AND description non-null are both required for the
 * response to be accepted (adapt-description.ts line 253).
 */
const DESCRIPTION_RESPONSE = {
  source: 'ai_cached' as const,
  description: 'AI-adapted long-form description for yield hunter investors.',
  locale: 'en',
  generated_at: '2026-06-26T00:00:00.000Z',
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

function insertScriptTag(decisionUrl = DECISION_API_URL): HTMLScriptElement {
  const script = document.createElement('script');
  script.dataset.apiKey = 'test-follow354-api-key';
  script.dataset.decisionUrl = decisionUrl;
  script.dataset.tenantId = 'follow354-tenant-id';
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
  document.querySelectorAll('[data-estalara-listing-id]').forEach((el) => {
    el.remove();
  });
}

/**
 * Insert the DOM elements required by applyDescriptionAdaptation() to reach the fetch:
 *   1. [data-estalara-slot="description"] — the description slot the SDK targets
 *   2. [data-estalara-listing-id]        — the per-listing ID included in the fetch URL
 *
 * Both are needed so the fetch is gated ONLY by the aboveFloor check in index.ts, not by
 * the inner slot-presence or listing-id guards in applyDescriptionAdaptation(). If either
 * were absent, the function would return early regardless of confidence, making the test
 * unable to distinguish "floor blocked it" from "inner guard blocked it".
 */
function insertDescriptionDom(listingId = LISTING_ID): void {
  const container = document.createElement('div');
  container.setAttribute('data-estalara-listing-id', listingId);

  const slot = document.createElement('div');
  slot.setAttribute('data-estalara-slot', 'description');
  slot.textContent = 'Original listing description text.';

  container.appendChild(slot);
  document.body.appendChild(container);
}

/**
 * Stub fetch with a DISTINCT handler that separates /adapt/description from /adapt.
 *
 * Order matters: the '/adapt/description' check comes BEFORE the generic '/adapt' check.
 * If the order were reversed (as in follow-343's url.includes('/adapt')), the description
 * endpoint would receive the directive response format — the collision the ticket fixes.
 *
 * Returns the vi.fn mock so tests can inspect .mock.calls for URL tracking.
 */
function stubFetchDistinct(confidence: number): ReturnType<typeof vi.fn> {
  const adaptResponse = { ...BASE_ADAPT_RESPONSE, confidence };

  const mockFn = vi.fn().mockImplementation((url: string) => {
    // DISTINCT: description check FIRST to avoid the /adapt collision.
    if (url.includes('/adapt/description')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(DESCRIPTION_RESPONSE),
      });
    }
    if (url.includes('/adapt')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(adaptResponse),
      });
    }
    // Ingest, /quiz/public-config, /intent/config, and other SDK endpoints.
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });

  vi.stubGlobal('fetch', mockFn);
  return mockFn;
}

/**
 * Extract /adapt/description fetch calls from a mock.
 *
 * applyDescriptionAdaptation() calls fetch(url, options) where `url` is the first
 * argument. The call happens SYNCHRONOUSLY within the fire-and-forget async chain
 * started by `void applyDescriptionAdaptation(...)` in refreshDirectives(), so the
 * call is registered in mock.calls before _initForTest() resolves — no additional
 * Promise.resolve() flushes are required.
 */
function descriptionFetches(mockFn: ReturnType<typeof vi.fn>): string[] {
  return (mockFn.mock.calls as unknown as [string, ...unknown[]][])
    .map(([url]) => url)
    .filter((url) => url.includes('/adapt/description'));
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
// Stub collision documentation
// ===========================================================================

describe('stub collision: url.includes("/adapt") vs url.includes("/adapt/description")', () => {
  it('documents why the old colliding stub cannot isolate the description axis', () => {
    const directiveUrl = `${DECISION_API_URL}/adapt`;
    const descriptionUrl = `${DECISION_API_URL}/adapt/description?listing_id=x&archetype=y`;

    // Old (colliding) pattern — BOTH endpoints match:
    expect(directiveUrl.includes('/adapt')).toBe(true);
    expect(descriptionUrl.includes('/adapt')).toBe(true); // collision

    // Distinct (new) pattern — only description matches:
    expect(directiveUrl.includes('/adapt/description')).toBe(false);
    expect(descriptionUrl.includes('/adapt/description')).toBe(true);
  });
});

// ===========================================================================
// AC-1 — below floor: /adapt/description NOT fetched
// ===========================================================================

describe('AC-1 — below floor: /adapt/description NOT fetched (FOLLOW-354)', () => {
  it('does NOT call /adapt/description when confidence is 0 (cold-start prior)', async () => {
    // Setup: description DOM present so inner guards in applyDescriptionAdaptation()
    // would NOT block the fetch — only the aboveFloor gate can block it.
    insertDescriptionDom();
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    const mockFetch = stubFetchDistinct(0.0); // well below floor (0.5)

    await _initForTest();

    // aboveFloor = false (0.0 < 0.5 AND signal_count=0 < 2) → applyDescriptionAdaptation
    // is never called → fetch is never called with /adapt/description.
    // RED before the FOLLOW-343 `if (aboveFloor)` gate existed.
    expect(descriptionFetches(mockFetch)).toHaveLength(0);
  });

  it('does NOT call /adapt/description at exactly one step below the floor (0.499)', async () => {
    insertDescriptionDom();
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    // DOM_ADAPT_CONFIDENCE_FLOOR - 0.001 = 0.499
    const mockFetch = stubFetchDistinct(DOM_ADAPT_CONFIDENCE_FLOOR - 0.001);

    await _initForTest();

    expect(descriptionFetches(mockFetch)).toHaveLength(0);
  });

  it('does NOT call /adapt/description when confidence is 0.37 (typical Bayesian neutral prior)', async () => {
    insertDescriptionDom();
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    const mockFetch = stubFetchDistinct(0.37);

    await _initForTest();

    expect(descriptionFetches(mockFetch)).toHaveLength(0);
  });
});

// ===========================================================================
// AC-2 — at/above floor: /adapt/description IS fetched
// ===========================================================================

describe('AC-2 — at/above floor: /adapt/description fetched (FOLLOW-354)', () => {
  it('DOES call /adapt/description when confidence is exactly at the floor (0.5)', async () => {
    insertDescriptionDom(LISTING_ID);
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    const mockFetch = stubFetchDistinct(DOM_ADAPT_CONFIDENCE_FLOOR); // exactly 0.5

    await _initForTest();

    // aboveFloor = true (0.5 >= 0.5) → applyDescriptionAdaptation IS called
    // → fetchDescription IS called → fetch('/adapt/description?...') IS called.
    const calls = descriptionFetches(mockFetch);
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('DOES call /adapt/description with correct query params when confidence is above floor (0.75)', async () => {
    insertDescriptionDom(LISTING_ID);
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    const mockFetch = stubFetchDistinct(0.75);

    await _initForTest();

    const calls = descriptionFetches(mockFetch);
    expect(calls.length).toBeGreaterThanOrEqual(1);

    const [calledUrl] = calls;
    // Verify the URL carries listing_id, archetype, and locale (adapt-description.ts line 227).
    expect(calledUrl).toContain(`listing_id=${LISTING_ID}`);
    expect(calledUrl).toContain('archetype=yield_hunter');
    expect(calledUrl).toContain('locale=en');
  });

  it('DOES call /adapt/description at quiz-leaf confidence (0.85) — regression guard', async () => {
    // Ensures quiz-leaf confidence (0.85) always clears the description floor (0.5).
    // If DOM_ADAPT_CONFIDENCE_FLOOR is raised above 0.85 in the future, this test
    // goes RED along with AC-3 in follow-343.test.ts — both must fail together.
    insertDescriptionDom(LISTING_ID);
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    const mockFetch = stubFetchDistinct(0.85);

    await _initForTest();

    expect(descriptionFetches(mockFetch).length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Constants cross-check
// ===========================================================================

describe('floor constants (FOLLOW-354 reference)', () => {
  it('DOM_ADAPT_CONFIDENCE_FLOOR is 0.5 — one of two disjunctive gates for /adapt/description', () => {
    // The server-side directive gate is 0.6; the floor here is lower (value rationale
    // in adapt-floor.ts). The other disjunctive gate is DOM_ADAPT_MIN_SIGNAL_COUNT —
    // see adapt-floor.ts and MASTER_DESIGN §E.7 gating ladder note. (Test name
    // previously said "the sole gate" — corrected 2026-08-07, FOLLOW-887.)
    expect(DOM_ADAPT_CONFIDENCE_FLOOR).toBe(0.5);
  });

  it('DOM_ADAPT_MIN_SIGNAL_COUNT is 2 — the signal-count alternative gate', () => {
    expect(DOM_ADAPT_MIN_SIGNAL_COUNT).toBe(2);
  });

  it('floor (0.5) is strictly below the server directive gate (0.6)', () => {
    // Asymmetry: description fetch possible at 0.5–0.59 when server returns [] for directives.
    expect(DOM_ADAPT_CONFIDENCE_FLOOR).toBeLessThan(0.6);
  });
});
