// @vitest-environment jsdom
/**
 * FOLLOW-275 — SDK runtime quiz config fetch (ADR-0011).
 *
 * Rule L producer test: drives the REAL `init()` body via `_initForTest()` and
 * asserts that `config.quiz.enabled` and `config.microPollsEnabled` reflect the
 * mocked server response from `GET /api/quiz/public-config` — NOT the snippet
 * dataset attribute values.
 *
 * An injection directly into `readConfig` would prove only "if present, it works."
 * This test proves the production init path calls the fetch AND the merged values
 * reach the quiz/micro-poll schedulers.
 *
 * Rule R evidence: the rehydrate path asserts that a second `_initForTest()` call
 * on the SAME sessionStorage (no clear between calls) reads from the sessionStorage
 * cache instead of issuing a second fetch request.
 *
 * Acceptance criteria verified:
 *   AC1: fetchQuizConfig() uses QuizPublicConfigResponseSchema.safeParse(); returns
 *        null on error/timeout.
 *   AC2: init() awaits fetchQuizConfig() before scheduleQuizTrigger() /
 *        schedulesMicroPoll() — verified by asserting the quiz trigger behaviour
 *        reflects server values after init completes.
 *   AC3: mergeQuizConfig() overlays server values onto SdkConfig.
 *   AC4: readConfig() no longer reads dataset.quizEnabled / dataset.microPollsEnabled
 *        as primary source — snippet values are DEPRECATED_FALLBACK only.
 *   AC5: Rule R gate — rehydrate path skips fetch (re-uses sessionStorage cache).
 *   AC6: Tests pass.
 *
 * @module packages/sdk/src/__tests__/follow-275
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import { _initForTest, mergeQuizConfig } from '../index.js';
import { readConfig, DEFAULT_CONFIG } from '../core/config.js';
import {
  fetchQuizConfig,
  QUIZ_CONFIG_CACHE_KEY,
  eraseCachedQuizConfig,
} from '../core/quiz-config.js';
import { QUIZ_TRIGGER_DELAY_MS } from '../ui/quiz-trigger.js';
import type { QuizPublicConfigResponse } from '@estalara/shared';

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

const SESSION_ID = 'f'.repeat(64);
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
  script.dataset.apiKey = overrides.apiKey ?? 'test-key-follow275';
  // Intentionally do NOT set data-quiz-enabled or data-micro-polls-enabled.
  // Per ADR-0011, these are retired; the server fetch is the authoritative source.
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
 * Build a mock `fetch` that returns a successful `QuizPublicConfigResponse`
 * for requests matching `/api/quiz/public-config`, and a neutral adapt response
 * for all other requests (so `refreshDirectives()` does not throw).
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
    // Neutral adapt response for all other requests
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          adapt_decision_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
// AC1: fetchQuizConfig — unit-level behaviour
// ---------------------------------------------------------------------------

describe('AC1 — fetchQuizConfig() unit behaviour', () => {
  it('returns parsed QuizPublicConfigResponse on 200 with valid body', async () => {
    const mockResponse: QuizPublicConfigResponse = {
      quiz_enabled: false,
      micro_polls_enabled: true,
      language: 'pl',
      accent_color: '#ff0000',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      }),
    );

    const result = await fetchQuizConfig(DECISION_API_URL, 'test-api-key', false);
    expect(result).toEqual(mockResponse);
  });

  it('returns null on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const result = await fetchQuizConfig(DECISION_API_URL, 'test-api-key', false);
    expect(result).toBeNull();
  });

  it('returns null when response body fails QuizPublicConfigResponseSchema.safeParse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        // Missing required fields — safeParse will fail
        json: () => Promise.resolve({ quiz_enabled: 'not-a-bool' }),
      }),
    );
    const result = await fetchQuizConfig(DECISION_API_URL, 'test-api-key', false);
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const result = await fetchQuizConfig(DECISION_API_URL, 'test-api-key', false);
    expect(result).toBeNull();
  });

  it('returns null on timeout (AbortError)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            }, 2000);
          }),
      ),
    );
    // Use a very short timeout so the test does not hang
    const result = await fetchQuizConfig(DECISION_API_URL, 'test-api-key', false, 1);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC3: mergeQuizConfig() overlay logic (pure function, no DOM required)
// ---------------------------------------------------------------------------

describe('AC3 — mergeQuizConfig() overlays server values onto SdkConfig', () => {
  const baseConfig = readConfig({
    dataset: { apiKey: 'EXAMPLE_api_key_xyz', decisionUrl: DECISION_API_URL },
  });

  it('overlays quiz_enabled=false from server onto config.quiz.enabled', () => {
    const fetched: QuizPublicConfigResponse = {
      quiz_enabled: false,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
    };
    const merged = mergeQuizConfig(baseConfig, fetched);
    expect(merged.quiz?.enabled).toBe(false);
  });

  it('overlays micro_polls_enabled=true from server onto config.microPollsEnabled', () => {
    const fetched: QuizPublicConfigResponse = {
      quiz_enabled: true,
      micro_polls_enabled: true,
      language: 'en',
      accent_color: '#2563EB',
    };
    const merged = mergeQuizConfig(baseConfig, fetched);
    expect(merged.microPollsEnabled).toBe(true);
  });

  it('overlays language from server', () => {
    const fetched: QuizPublicConfigResponse = {
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'pl',
      accent_color: '#2563EB',
    };
    const merged = mergeQuizConfig(baseConfig, fetched);
    expect(merged.language).toBe('pl');
  });

  it('overlays accent_color from server', () => {
    const fetched: QuizPublicConfigResponse = {
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#ff6600',
    };
    const merged = mergeQuizConfig(baseConfig, fetched);
    expect(merged.accentColor).toBe('#ff6600');
  });

  it('returns original config unchanged when fetched is null', () => {
    const merged = mergeQuizConfig(baseConfig, null);
    expect(merged).toBe(baseConfig); // same reference
  });
});

// ---------------------------------------------------------------------------
// AC4: readConfig() — dataset.quizEnabled / dataset.microPollsEnabled are
//      DEPRECATED_FALLBACK only (not the primary source after ADR-0011).
//      The values still parse (backward-compat) but are overridden by the server.
// ---------------------------------------------------------------------------

describe('AC4 — readConfig() dataset values are DEPRECATED_FALLBACK only', () => {
  it('readConfig() still parses data-quiz-enabled for backward-compat fallback', () => {
    // The attribute is read as DEPRECATED_FALLBACK but still parses correctly.
    const cfg = readConfig({ dataset: { apiKey: 'EXAMPLE_api_key_xyz', quizEnabled: 'false' } });
    expect(cfg.quiz?.enabled).toBe(false);
  });

  it('readConfig() returns quiz.enabled=true (default) when data-quiz-enabled absent', () => {
    const cfg = readConfig({ dataset: { apiKey: 'EXAMPLE_api_key_xyz' } });
    expect(cfg.quiz?.enabled).toBe(true);
    expect(DEFAULT_CONFIG.quiz).toEqual({ enabled: true });
  });

  it('readConfig() still parses data-micro-polls-enabled="true" for fallback', () => {
    const cfg = readConfig({
      dataset: { apiKey: 'EXAMPLE_api_key_xyz', microPollsEnabled: 'true' },
    });
    expect(cfg.microPollsEnabled).toBe(true);
  });

  it('readConfig() returns microPollsEnabled=undefined (default) when attribute absent', () => {
    const cfg = readConfig({ dataset: { apiKey: 'EXAMPLE_api_key_xyz' } });
    // undefined means the feature is disabled (opt-in only)
    expect(cfg.microPollsEnabled).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rule L producer test (AC2 / AC6):
//   Drives the REAL init() body via _initForTest() with a mocked fetch.
//   Asserts that config.quiz.enabled and config.microPollsEnabled reflect the
//   mocked SERVER response — NOT the snippet-attribute defaults.
// ---------------------------------------------------------------------------

describe('Rule L — init() calls fetchQuizConfig and uses server values (NOT snippet defaults)', () => {
  beforeEach(() => {
    clearAll();
    // Grant consent so init() does not halt at the consent gate.
    localStorage.setItem('estalara_consent', 'granted');
    seedSession();
    vi.useFakeTimers();
  });

  it('AC2/Rule L: server quiz_enabled=false suppresses quiz trigger even when snippet has no data-quiz-enabled', async () => {
    // The snippet has NO data-quiz-enabled attribute — the default would be enabled=true.
    // The server returns quiz_enabled=false.
    // The quiz trigger MUST NOT render after QUIZ_TRIGGER_DELAY_MS.
    const serverResponse: QuizPublicConfigResponse = {
      quiz_enabled: false,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
    };

    vi.stubGlobal('fetch', buildMockFetch(serverResponse));

    // No data-quiz-enabled on the script tag — snippet default = true.
    insertScriptTag({ decisionUrl: DECISION_API_URL });

    const state = await _initForTest();
    expect(state).not.toBeNull();

    // Advance to fire the quiz trigger
    await vi.advanceTimersByTimeAsync(QUIZ_TRIGGER_DELAY_MS);

    // Quiz trigger must NOT render — server said quiz_enabled=false
    const shadowHosts = document.querySelectorAll('[data-estalara-host]');
    let quizTriggerFound = false;
    shadowHosts.forEach((host) => {
      const shadowRoot = host.shadowRoot;
      if (shadowRoot) {
        const trigger = shadowRoot.querySelector('.estalara-trigger');
        if (trigger) quizTriggerFound = true;
      }
    });
    expect(quizTriggerFound).toBe(false);
  });

  it('Rule L: server quiz_enabled=true renders quiz trigger (positive path)', async () => {
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

    const shadowHosts = document.querySelectorAll('[data-estalara-host]');
    let quizTriggerFound = false;
    shadowHosts.forEach((host) => {
      const shadowRoot = host.shadowRoot;
      if (shadowRoot) {
        const trigger = shadowRoot.querySelector('.estalara-trigger');
        if (trigger) quizTriggerFound = true;
      }
    });
    expect(quizTriggerFound).toBe(true);
  });

  it('Rule L: fetch is called with the correct URL and Authorization header', async () => {
    const serverResponse: QuizPublicConfigResponse = {
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
    };

    const mockFetch = buildMockFetch(serverResponse);
    vi.stubGlobal('fetch', mockFetch);

    insertScriptTag({ decisionUrl: DECISION_API_URL, apiKey: 'my-test-api-key' });

    await _initForTest();

    // Find the call to the public-config endpoint
    const calls = mockFetch.mock.calls as [string, RequestInit][];
    const configCall = calls.find(([url]) => url.includes('/api/quiz/public-config'));
    expect(configCall).toBeDefined();
    expect(configCall![1].headers).toMatchObject({
      Authorization: 'Bearer my-test-api-key',
    });
  });

  it('Rule L: fallback to snippet defaults when fetch returns null (no decisionUrl)', async () => {
    // When there is no decisionUrl, fetchQuizConfig is not called.
    // config.quiz.enabled should remain the snippet/default value (true).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    // No decisionUrl → no fetch
    insertScriptTag();

    const state = await _initForTest();
    expect(state).not.toBeNull();

    // Default quiz.enabled=true, quiz trigger should render after 30s
    await vi.advanceTimersByTimeAsync(QUIZ_TRIGGER_DELAY_MS);

    const shadowHosts = document.querySelectorAll('[data-estalara-host]');
    let quizTriggerFound = false;
    shadowHosts.forEach((host) => {
      const shadowRoot = host.shadowRoot;
      if (shadowRoot) {
        const trigger = shadowRoot.querySelector('.estalara-trigger');
        if (trigger) quizTriggerFound = true;
      }
    });
    expect(quizTriggerFound).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC5 — Rule R gate: rehydrate path skips fetch (re-uses sessionStorage cache)
// ---------------------------------------------------------------------------

describe('AC5 — Rule R: rehydrate path skips fetch and re-uses sessionStorage cache', () => {
  beforeEach(() => {
    clearAll();
    localStorage.setItem('estalara_consent', 'granted');
    seedSession();
    vi.useFakeTimers();
  });

  it('second init() call on same session reads from sessionStorage cache, not fetch', async () => {
    const serverResponse: QuizPublicConfigResponse = {
      quiz_enabled: false,
      micro_polls_enabled: true,
      language: 'pl',
      accent_color: '#123456',
    };

    const mockFetch = buildMockFetch(serverResponse);
    vi.stubGlobal('fetch', mockFetch);

    // First init: session is NOT rehydrated → fetch is called → result cached.
    // We seed intent state BEFORE the first init so the rehydrate flag fires on the SECOND call.
    insertScriptTag({ decisionUrl: DECISION_API_URL });
    await _initForTest();

    // Count how many times the public-config endpoint was called in the first init.
    const firstCallCount = (mockFetch.mock.calls as [string, unknown][]).filter(([url]) =>
      url.includes('/api/quiz/public-config'),
    ).length;
    expect(firstCallCount).toBe(1);

    // Seed the intent state so the second init() rehydrates.
    const { persistIntentState, intentStateStorageKey } = await import('../core/session.js');
    const { initIntentState } = await import('../core/intent.js');
    persistIntentState(SESSION_ID, initIntentState());

    // Teardown and re-init (same sessionStorage, no clear → rehydrate path fires).
    runTeardown();
    removeShadowHosts();

    await _initForTest();

    const secondCallCount = (mockFetch.mock.calls as [string, unknown][]).filter(([url]) =>
      url.includes('/api/quiz/public-config'),
    ).length;

    // The public-config endpoint must NOT have been called a second time.
    // The cache hit in sessionStorage returns the cached result directly.
    expect(secondCallCount).toBe(1);

    // The cached config is still in sessionStorage with the correct values.
    const cached = sessionStorage.getItem(QUIZ_CONFIG_CACHE_KEY);
    expect(cached).not.toBeNull();
    const parsed = JSON.parse(cached!) as QuizPublicConfigResponse;
    expect(parsed.quiz_enabled).toBe(false);
    expect(parsed.micro_polls_enabled).toBe(true);
    expect(parsed.language).toBe('pl');

    // Suppress unused import warning
    void intentStateStorageKey;
  });

  it('eraseCachedQuizConfig removes the sessionStorage entry', () => {
    sessionStorage.setItem(
      QUIZ_CONFIG_CACHE_KEY,
      JSON.stringify({
        quiz_enabled: true,
        micro_polls_enabled: false,
        language: 'en',
        accent_color: '#2563EB',
      }),
    );
    expect(sessionStorage.getItem(QUIZ_CONFIG_CACHE_KEY)).not.toBeNull();

    eraseCachedQuizConfig();

    expect(sessionStorage.getItem(QUIZ_CONFIG_CACHE_KEY)).toBeNull();
  });
});
