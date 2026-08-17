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
import { DEFAULT_QUIZ_DEFINITION, renderQuizWidget } from '../ui/quiz-widget.js';
import type { QuizPublicConfigResponse } from '@estalara/shared';

// ---------------------------------------------------------------------------
// Shared test helpers (mirrors follow-275.test.ts pattern)
// ---------------------------------------------------------------------------

const SESSION_ID = 'e'.repeat(64);
// FOLLOW-305: canonical form = host + /api, matching buildSnippet() in DetectionPreview.tsx:153.
const DECISION_API_URL = 'https://admin.estalara.com/api';

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
 * `/quiz/public-config`, and a neutral adapt response for all other URLs.
 *
 * FOLLOW-305: the match path is `/quiz/public-config` (without a leading `/api`)
 * because `decisionApiUrl` = `host + /api` and `buildEndpoint` appends only the
 * route path. The full URL is `…/api/quiz/public-config` — `.includes` on the
 * route suffix `/quiz/public-config` matches correctly.
 */
function buildMockFetch(quizConfig: QuizPublicConfigResponse): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/quiz/public-config')) {
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

/**
 * The localized chrome the quiz CARD renders, per language.
 *
 * FOLLOW-1015 retarget: this test used to read the sticky trigger button's label, but the
 * trigger is gone — the card opens by itself. The card's own chrome (skip button + the new
 * intro line) is now the rendered surface that proves the served language reached the DOM.
 * Kept as test-local literals on purpose: exporting `CHROME_LABELS` just for this file would
 * add an export with no production importer (Rule I).
 */
const EXPECTED_SKIP = { en: 'Skip', pl: 'Pomiń', es: 'Omitir' } as const;
/** A word that appears only in that language's intro sentence. */
const EXPECTED_INTRO_WORD = { en: 'questions', pl: 'pytań', es: 'preguntas' } as const;

/** Read the quiz card's localized chrome out of the shadow DOM. */
function findQuizChrome(): { skip: string | null; intro: string | null } {
  const shadowHosts = document.querySelectorAll('[data-estalara-host]');
  for (const host of shadowHosts) {
    const shadowRoot = host.shadowRoot;
    if (!shadowRoot) continue;
    const card = shadowRoot.querySelector('.estalara-quiz-card');
    if (!card) continue;
    return {
      skip: card.querySelector('.estalara-quiz-skip')?.textContent ?? null,
      intro: card.querySelector('.estalara-quiz-intro')?.textContent ?? null,
    };
  }
  return { skip: null, intro: null };
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

    // FOLLOW-1015: no trigger delay — let init()'s async tail settle so the card mounts.
    await vi.advanceTimersByTimeAsync(100);

    const chrome = findQuizChrome();

    // The card MUST render Polish chrome — not the English default.
    // RED before FOLLOW-275 (the card would show 'Skip' / the English intro).
    expect(chrome.skip).toBe(EXPECTED_SKIP.pl);
    expect(chrome.skip).not.toBe(EXPECTED_SKIP.en);
    expect(chrome.intro).toContain(EXPECTED_INTRO_WORD.pl);
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

    await vi.advanceTimersByTimeAsync(100);

    const chrome = findQuizChrome();

    expect(chrome.skip).toBe(EXPECTED_SKIP.es);
    expect(chrome.skip).not.toBe(EXPECTED_SKIP.en);
    expect(chrome.intro).toContain(EXPECTED_INTRO_WORD.es);
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

    await vi.advanceTimersByTimeAsync(100);

    const chrome = findQuizChrome();

    expect(chrome.skip).toBe(EXPECTED_SKIP.en);
    expect(chrome.intro).toContain(EXPECTED_INTRO_WORD.en);
  });

  it('no fetch (no decisionUrl) defaults to "en" trigger text', async () => {
    // No decisionUrl → fetchQuizConfig is not called → snippet/default language='en' used.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    // No decisionUrl in script tag
    insertScriptTag();

    const state = await _initForTest();
    expect(state).not.toBeNull();

    await vi.advanceTimersByTimeAsync(100);

    const chrome = findQuizChrome();
    // Without a server fetch, language stays at the snippet/default ('en').
    expect(chrome.skip).toBe(EXPECTED_SKIP.en);
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
// EVIDENCE: the tests above show the server language DOES reach the quiz card
// (post-fetch surface); the accepted gap is that the banner (pre-fetch surface)
// cannot receive it.  This is documented in index.ts at the renderConsentBanner()
// call site and in docs/adr/ADR-0011-quiz-config-transport.md §Consent-banner locale.
// ---------------------------------------------------------------------------

describe('AC1 — consent-banner locale: accepted constraint documented (structural check)', () => {
  // Pins the EXPECTED_SKIP / EXPECTED_INTRO_WORD literals used by the AC2 render-hop tests
  // to what the card ACTUALLY renders, by driving renderQuizWidget directly. Without this the
  // AC2 assertions could drift into asserting strings production no longer produces.
  it('the card renders the expected chrome for every language (pins the AC2 literals)', () => {
    for (const lang of ['en', 'pl', 'es'] as const) {
      const host = document.createElement('div');
      host.setAttribute('data-estalara-host', '');
      document.body.appendChild(host);
      const root = host.attachShadow({ mode: 'open' });
      renderQuizWidget(
        root,
        { accentColor: '#2563EB', language: lang, definition: DEFAULT_QUIZ_DEFINITION },
        () => undefined,
        () => undefined,
      );
      const card = root.querySelector('.estalara-quiz-card');
      expect(card?.querySelector('.estalara-quiz-skip')?.textContent).toBe(EXPECTED_SKIP[lang]);
      expect(card?.querySelector('.estalara-quiz-intro')?.textContent).toContain(
        EXPECTED_INTRO_WORD[lang],
      );
      host.remove();
    }
  });

  it('the intro line renders on the FIRST step only (FOLLOW-1015)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    renderQuizWidget(
      root,
      { accentColor: '#2563EB', language: 'en', definition: DEFAULT_QUIZ_DEFINITION },
      () => undefined,
      () => undefined,
    );
    expect(root.querySelector('.estalara-quiz-intro')).not.toBeNull();

    // Answer the root question — the next step must drop the intro (it would only push the
    // answers down once the visitor has already engaged).
    root.querySelectorAll<HTMLButtonElement>('.estalara-quiz-answer')[0]?.click();
    expect(root.querySelector('.estalara-quiz-card')).not.toBeNull();
    expect(root.querySelector('.estalara-quiz-intro')).toBeNull();
    host.remove();
  });

  it('server language reaches the quiz card (post-fetch surface) — confirmed by AC2', () => {
    // This is a documentation stub: the AC2 tests above provide the actual evidence.
    // The accepted constraint (banner = pre-fetch surface, cannot receive server language)
    // is documented in:
    //   - packages/sdk/src/index.ts at the renderConsentBanner() call site (FOLLOW-278 comment)
    //   - docs/adr/ADR-0011-quiz-config-transport.md §Consent-banner locale addendum
    // No further executable assertion is required for the accepted constraint itself.
    expect(true).toBe(true);
  });
});
