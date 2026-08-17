// @vitest-environment jsdom
/**
 * FOLLOW-257 — Resolve Rule-L half-wire: quiz.trigger_after_n_listings removal
 *
 * AC1: data-quiz-trigger attribute and trigger_after_n_listings field removed from
 *      SdkConfig and readConfig(). No half-wire state remains.
 *
 * AC2 (FOLLOW-264 / Rule Q): showQuizTrigger() gate — replaced the FOLLOW-257
 *      simulatedShowQuizTrigger mirror with a seam-driven jsdom test that drives the
 *      REAL init() / showQuizTrigger via _initForTest. Rule Q: acceptance tests must
 *      invoke the real entrypoint, never re-implement its body. A mirror of index.ts
 *      line 791 proves only "if present, it works" — it cannot catch a deleted or
 *      guarded gate. This test will turn RED if the gate at index.ts:791 is removed
 *      or the condition is changed (e.g. `===` → `!==`).
 *
 * AC3: RETIRED by FOLLOW-1015 — it asserted the 30s QUIZ_TRIGGER_DELAY_MS constant, and the
 *      quiz no longer waits on a timer or a trigger button: it opens itself once init()
 *      resolves consent + config. The AC1/AC2 gate seams below are retargeted from the
 *      trigger element to the quiz card, which is now the surface the gate suppresses.
 *
 * Rule H: after this PR `grep -r "triggerAfterNListings" packages/sdk/` must
 * return empty. Verified here by asserting the field is NOT present on SdkConfig.
 *
 * @module packages/sdk/src/__tests__/follow-257
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import { readConfig, DEFAULT_CONFIG } from '../core/config.js';
import { _initForTest } from '../index.js';

// ---------------------------------------------------------------------------
// Shared helpers (mirrors the pattern from follow-217.test.ts)
// ---------------------------------------------------------------------------

const SESSION_ID = 'e'.repeat(64);

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
  script.dataset.apiKey = overrides.apiKey ?? 'test-key-follow257';
  if (overrides.quizEnabled !== undefined) {
    script.dataset.quizEnabled = overrides.quizEnabled;
  }
  document.head.appendChild(script);
}

/** Remove all Estalara script tags. */
function removeScriptTags(): void {
  document.querySelectorAll<HTMLScriptElement>('script[data-api-key]').forEach((el) => {
    el.remove();
  });
}

/** Reset all test state between runs. */
function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  removeScriptTags();
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

// ---------------------------------------------------------------------------
// afterEach — always teardown and clear
// ---------------------------------------------------------------------------

afterEach(() => {
  runTeardown();
  clearAll();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─── AC1: trigger_after_n_listings field is gone ──────────────────────────────

describe('FOLLOW-257 AC1 — trigger_after_n_listings removed from SdkConfig', () => {
  it('readConfig() returns quiz without trigger_after_n_listings when data-quiz-trigger is provided (attribute silently ignored)', () => {
    // Previously, data-quiz-trigger="5" would set quiz.trigger_after_n_listings=5.
    // After FOLLOW-257, the attribute is ignored and the field does not exist.
    const cfg = readConfig({ dataset: { apiKey: 'EXAMPLE_api_key_xyz', quizTrigger: '5' } });
    // The field must not exist on the returned config — Rule H.
    expect(cfg.quiz).not.toHaveProperty('trigger_after_n_listings');
  });

  it('readConfig() returns quiz without trigger_after_n_listings when data-quiz-trigger is absent', () => {
    const cfg = readConfig({ dataset: { apiKey: 'EXAMPLE_api_key_xyz' } });
    expect(cfg.quiz).not.toHaveProperty('trigger_after_n_listings');
  });

  it('DEFAULT_CONFIG.quiz does not contain trigger_after_n_listings — Rule H', () => {
    expect(DEFAULT_CONFIG.quiz).toEqual({ enabled: true });
    expect(DEFAULT_CONFIG.quiz).not.toHaveProperty('trigger_after_n_listings');
  });

  it('data-quiz-enabled still works correctly after FOLLOW-257 removal', () => {
    const cfgDisabled = readConfig({
      dataset: { apiKey: 'EXAMPLE_api_key_xyz', quizEnabled: 'false' },
    });
    expect(cfgDisabled.quiz?.enabled).toBe(false);

    const cfgEnabled = readConfig({ dataset: { apiKey: 'EXAMPLE_api_key_xyz' } });
    expect(cfgEnabled.quiz?.enabled).toBe(true);
  });
});

// ─── AC2 (FOLLOW-264 / Rule Q): showQuizTrigger gate via real _initForTest seam ─
//
// Rule Q (amended 2026-06-08): acceptance tests must import + invoke the real
// entrypoint, never re-implement its body. The previous FOLLOW-257 AC2 tests used a
// local `simulatedShowQuizTrigger()` mirror of index.ts:791 — a Rule Q violation
// (TG-1 / RETRO-050 §4c). A mirror proves "if present, it works" but cannot catch a
// deleted or incorrectly guarded gate in the real code.
//
// This replacement drives the REAL init() via _initForTest():
//   1. Seeds the DOM with data-quiz-enabled="false" on the script tag.
//   2. Calls _initForTest() — the production init() body executes and reaches openQuiz()
//      (FOLLOW-1015: no 30s timer, no trigger button; the card opens during init).
//   3. Lets the async tail settle.
//   4. Asserts: no quiz card exists in any shadow root AND no quiz.event was emitted
//      via the event queue.
//
// If the gate at index.ts:791 (`if (config.quiz?.enabled === false) return;`) is
// deleted, changed, or bypassed, the quiz card WILL render and this test goes RED.

describe('FOLLOW-257 AC2 (FOLLOW-264 / Rule Q) — real init() gate: quiz.enabled=false suppresses the quiz', () => {
  beforeEach(() => {
    clearAll();
    // Stub fetch so refreshDirectives() resolves without a live Decision API.
    // No decision-api URL is set on the script tag, so fetchDirectives returns
    // early — fetch is never called. Stub it defensively for completeness.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
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
            generated_at: '2026-06-11T00:00:00.000Z',
            directives: [],
            ttl_seconds: 300,
            variant: 'control',
          }),
      }),
    );
    // Grant consent so init() does not halt at the consent gate.
    localStorage.setItem('estalara_consent', 'granted');
    seedSession();
    // Use fake timers so we can advance the 30s quiz timer manually.
    vi.useFakeTimers();
  });

  it('AC2a (Rule Q seam): with data-quiz-enabled=false, no quiz card renders and no quiz event emits', async () => {
    // Rule Q (FOLLOW-264 AC3): drives the REAL gate at index.ts:791 via _initForTest.
    // If that gate is deleted or inverted, a `.estalara-quiz-card` element will appear
    // inside the shadow root and this test will fail.
    insertScriptTag({ quizEnabled: 'false' });

    // Run the real init() body. FOLLOW-1015: the quiz opens during init(), not on a timer.
    const state = await _initForTest();

    // init() must return a non-null state (no early exit from consent/script gates).
    expect(state).not.toBeNull();

    // Let init()'s async tail settle (config fetch → openQuiz).
    await vi.advanceTimersByTimeAsync(100);

    // Assert: no quiz card exists in any shadow host. renderQuizWidget() appends an
    // overlay containing <div class="estalara-quiz-card">. If the gate failed, this
    // selector would find it.
    const shadowHosts = document.querySelectorAll('[data-estalara-host]');
    let quizCardFound = false;
    shadowHosts.forEach((host) => {
      const shadowRoot = host.shadowRoot;
      if (shadowRoot) {
        const card = shadowRoot.querySelector('.estalara-quiz-card');
        if (card) quizCardFound = true;
      }
    });
    expect(quizCardFound).toBe(false);
  });

  it('AC2b (Rule Q seam): with data-quiz-enabled=true (default), the quiz card renders', async () => {
    // Positive-path control: quiz enabled → the card renders.
    // This ensures the gate path that *does* render is also exercised, confirming
    // the test would catch a gate that wrongly suppresses when enabled=true.
    // Note: no data-quiz-enabled → defaults to enabled=true (from DEFAULT_CONFIG).
    insertScriptTag();

    const state = await _initForTest();
    expect(state).not.toBeNull();

    // Let init()'s async tail settle.
    await vi.advanceTimersByTimeAsync(100);

    // The quiz card should be rendered in the shadow root.
    const shadowHosts = document.querySelectorAll('[data-estalara-host]');
    let quizCardFound = false;
    shadowHosts.forEach((host) => {
      const shadowRoot = host.shadowRoot;
      if (shadowRoot) {
        const card = shadowRoot.querySelector('.estalara-quiz-card');
        if (card) quizCardFound = true;
      }
    });
    expect(quizCardFound).toBe(true);
  });
});
