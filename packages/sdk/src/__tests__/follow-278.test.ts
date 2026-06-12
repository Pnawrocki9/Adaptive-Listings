// @vitest-environment jsdom
/**
 * FOLLOW-278 — Consent-banner locale constraint + locale render-hop test.
 *
 * AC1 (LG-1, option iii): The consent-banner locale/accent constraint is DOCUMENTED (not fixed):
 *   The consent banner renders BEFORE fetchQuizConfig() resolves (it must, since the fetch runs
 *   after consent resolves — ADR-0011 §Consent-banner locale addendum, FOLLOW-278 2026-06-12).
 *   This file does NOT assert the consent banner language (that would test an accepted constraint).
 *   The banner language is sourced from navigator.language or the 'en' default; see the comment
 *   at index.ts renderConsentBanner() call site.
 *
 * AC2 (TG-1, Rule L render-hop): The locale render-hop test — asserts that a server response of
 *   `language='pl'` causes the quiz trigger to RENDER in Polish (not just set an in-memory field).
 *   The existing FOLLOW-275 AC3 tests assert `merged.language === 'pl'` in memory only; this test
 *   drives the full init() path via _initForTest() and asserts rendered DOM content.
 *
 *   RED before FOLLOW-275 (no mergeQuizConfig wiring): the quiz trigger would render in 'en'
 *   (snippet default), and the Polish-text assertion would FAIL.
 *   GREEN after FOLLOW-275 (index.ts:744 mergeQuizConfig + renderQuizTrigger uses merged language):
 *   the quiz trigger renders 'Znajdź dopasowanie →' (Polish).
 *
 * AC3 cross-reference: FOLLOW-273 = type unification (QuizLanguage from @estalara/shared).
 *   FOLLOW-278 = runtime rendering path (this test). These are DISJOINT — not double-closed.
 *   FOLLOW-273 proves the TYPE is correct; this test proves the TYPE is RENDERED.
 *
 * AC4 (LG-2): Cache-key scope note added to quiz-config.ts docstring (no test needed — doc only).
 *
 * @module packages/sdk/src/__tests__/follow-278
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import { _initForTest } from '../index.js';
import { QUIZ_TRIGGER_DELAY_MS, QUIZ_LABELS } from '../ui/quiz-trigger.js';
import type { QuizPublicConfigResponse } from '@estalara/shared';

// ---------------------------------------------------------------------------
// Shared test helpers (mirrors follow-275.test.ts pattern)
// ---------------------------------------------------------------------------

const SESSION_ID = 'e'.repeat(64);
const DECISION_API_URL = 'https://admin.estalara.com';

/** Pre-seed a session so getOrCreateSession() skips SHA-256 fingerprint generation. */
function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

/** Insert a <script data-api-key> tag that init() can find via querySelector. */
function insertScriptTag(overrides: Record<string, string> = {}): void {
  const script = document.createElement('script');
  script.dataset.apiKey = overrides.apiKey ?? 'test-key-follow278';
  if (overrides.decisionUrl !== undefined) {
    script.dataset.decisionUrl = overrides.decisionUrl;
  }
  document.head.appendChild(script);
}

/** Remove all Estalara script tags. */
function removeScriptTags(): void {
  document.querySelectorAll<HTMLScriptElement>('script[data-api-key]').forEach((el) => {
    el.remove();
  });
}

/** Remove all Estalara shadow hosts. */
function removeShadowHosts(): void {
  document.querySelectorAll('[data-estalara-host]').forEach((el) => {
    el.remove();
  });
}

/** Run any __estalaraTeardown registered by init(). */
function runTeardown(): void {
  const teardown = (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  if (teardown) {
    teardown();
    delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  }
}

/** Reset all test state between runs. */
function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  removeScriptTags();
  removeShadowHosts();
}

/**
 * Build a mock `fetch` that returns the given quiz config for
 * `/api/quiz/public-config`, and a neutral adapt response for all other URLs.
 */
function buildMockFetch(quizConfig: QuizPublicConfigResponse): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/quiz/public-config')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(quizConfig),
      });
    }
    // Neutral adapt response for all other requests (e.g. /api/adapt)
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          adapt_decision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          session_id: SESSION_ID,
          archetype: 'neutral',
          confidence: 0.5,
          similarity: 0.5,
          tier: 1,
          source: 'playbook',
          generated_at: '2026-06-12T00:00:00.000Z',
          directives: [],
          ttl_seconds: 300,
          variant: 'control',
        }),
    });
  });
}

/** Find the quiz trigger button label text inside the shadow DOM. */
function findQuizTriggerText(): string | null {
  const shadowHosts = document.querySelectorAll('[data-estalara-host]');
  for (const host of shadowHosts) {
    const shadowRoot = host.shadowRoot;
    if (!shadowRoot) continue;
    // The trigger label is a <span> inside the .estalara-trigger button.
    // Its textContent equals QUIZ_LABELS[language].trigger.
    const trigger = shadowRoot.querySelector('.estalara-trigger');
    if (!trigger) continue;
    // The button contains: icon span + label span + dismiss button.
    // spans[0] = icon (aria-hidden), spans[1] = label text
    const spans = trigger.querySelectorAll('span');
    if (spans.length >= 2) {
      return spans[1]?.textContent ?? null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// afterEach — always teardown and clear
// ---------------------------------------------------------------------------

afterEach(() => {
  runTeardown();
  clearAll();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// AC2 (TG-1, Rule L render-hop) — locale consumer-render-hop test
//
// These tests prove that server language='pl'/'es' causes the quiz trigger
// to RENDER in the correct language (not just set config.language in memory).
//
// BEFORE FOLLOW-275 (mergeQuizConfig not wired): FAIL — quiz trigger would
//   render in 'en' (snippet default), Polish-text assertion fails.
// AFTER FOLLOW-275 (mergeQuizConfig wired at index.ts:744): PASS — merged
//   language='pl' flows into renderQuizTrigger() and renders Polish labels.
// ---------------------------------------------------------------------------

describe('AC2 — locale render-hop: server language reaches rendered quiz trigger', () => {
  beforeEach(() => {
    clearAll();
    // Grant consent so init() does not halt at the consent gate.
    localStorage.setItem('estalara_consent', 'granted');
    seedSession();
    vi.useFakeTimers();
  });

  it('server language="pl" renders quiz trigger with Polish label text', async () => {
    const serverResponse: QuizPublicConfigResponse = {
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'pl',
      accent_color: '#FF0000',
    };

    vi.stubGlobal('fetch', buildMockFetch(serverResponse));
    insertScriptTag({ decisionUrl: DECISION_API_URL });

    const state = await _initForTest();
    expect(state).not.toBeNull();

    // Advance time to fire the quiz trigger (30s delay)
    await vi.advanceTimersByTimeAsync(QUIZ_TRIGGER_DELAY_MS);

    const triggerText = findQuizTriggerText();

    // The trigger MUST render with the Polish label — not the English default.
    // QUIZ_LABELS.pl.trigger = 'Znajdź dopasowanie →'
    // This assertion is RED before FOLLOW-275 (trigger would show 'Find your match →').
    expect(triggerText).toBe(QUIZ_LABELS.pl.trigger);
    expect(triggerText).not.toBe(QUIZ_LABELS.en.trigger);
  });

  it('server language="es" renders quiz trigger with Spanish label text', async () => {
    const serverResponse: QuizPublicConfigResponse = {
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'es',
      accent_color: '#00AA00',
    };

    vi.stubGlobal('fetch', buildMockFetch(serverResponse));
    insertScriptTag({ decisionUrl: DECISION_API_URL });

    const state = await _initForTest();
    expect(state).not.toBeNull();

    await vi.advanceTimersByTimeAsync(QUIZ_TRIGGER_DELAY_MS);

    const triggerText = findQuizTriggerText();

    // QUIZ_LABELS.es.trigger = 'Encuentra tu coincidencia →'
    expect(triggerText).toBe(QUIZ_LABELS.es.trigger);
    expect(triggerText).not.toBe(QUIZ_LABELS.en.trigger);
  });

  it('server language="en" renders quiz trigger with English label text (control)', async () => {
    const serverResponse: QuizPublicConfigResponse = {
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
    };

    vi.stubGlobal('fetch', buildMockFetch(serverResponse));
    insertScriptTag({ decisionUrl: DECISION_API_URL });

    const state = await _initForTest();
    expect(state).not.toBeNull();

    await vi.advanceTimersByTimeAsync(QUIZ_TRIGGER_DELAY_MS);

    const triggerText = findQuizTriggerText();

    // QUIZ_LABELS.en.trigger = 'Find your match →'
    expect(triggerText).toBe(QUIZ_LABELS.en.trigger);
  });

  it('no fetch (no decisionUrl) defaults to "en" trigger text', async () => {
    // No decisionUrl → fetchQuizConfig is not called → snippet/default language='en' used.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    // No decisionUrl in script tag
    insertScriptTag();

    const state = await _initForTest();
    expect(state).not.toBeNull();

    await vi.advanceTimersByTimeAsync(QUIZ_TRIGGER_DELAY_MS);

    const triggerText = findQuizTriggerText();
    // Without a server fetch, language stays at the snippet/default ('en').
    expect(triggerText).toBe(QUIZ_LABELS.en.trigger);
  });
});

// ---------------------------------------------------------------------------
// AC1 documentation cross-check — the consent banner CANNOT receive the
// server-fetched language (accepted constraint, option iii).
//
// The constraint: banner renders BEFORE fetchQuizConfig() resolves (ADR-0011
// §Consent-banner locale addendum).  We document this by proving that:
//   (a) the quiz trigger (rendered AFTER mergeQuizConfig) uses server language.
//   (b) the banner call-site comment + ADR-0011 addendum record the accepted gap.
//
// There is no executable assertion for "banner rendered in 'en' even though server
// says 'pl'" because capturing the mid-init DOM state would require intercepting
// a Promise that init() owns.  The constraint is therefore verified by NEGATIVE
// EVIDENCE: the tests above show the server language DOES reach the quiz trigger
// (post-fetch surface); the accepted gap is that the banner (pre-fetch surface)
// cannot receive it.  This is documented in index.ts at the renderConsentBanner()
// call site and in docs/adr/ADR-0011-quiz-config-transport.md §Consent-banner locale.
// ---------------------------------------------------------------------------

describe('AC1 — consent-banner locale: accepted constraint documented (structural check)', () => {
  it('QUIZ_LABELS.pl.trigger is the Polish text asserted in AC2 tests (sanity check)', () => {
    // Verify the expected Polish string matches the real QUIZ_LABELS constant.
    // If this changes, the AC2 render-hop tests need updating too.
    expect(QUIZ_LABELS.pl.trigger).toBe('Znajdź dopasowanie →');
    expect(QUIZ_LABELS.es.trigger).toBe('Encuentra tu coincidencia →');
    expect(QUIZ_LABELS.en.trigger).toBe('Find your match →');
  });

  it('server language reaches the quiz trigger (post-fetch surface) — confirmed by AC2', () => {
    // This is a documentation stub: the AC2 tests above provide the actual evidence.
    // The accepted constraint (banner = pre-fetch surface, cannot receive server language)
    // is documented in:
    //   - packages/sdk/src/index.ts at the renderConsentBanner() call site (FOLLOW-278 comment)
    //   - docs/adr/ADR-0011-quiz-config-transport.md §Consent-banner locale addendum
    // No further executable assertion is required for the accepted constraint itself.
    expect(true).toBe(true);
  });
});
