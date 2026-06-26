/**
 * FOLLOW-409 — Real-handler test for the micro-poll onAnswer §H.9 guard.
 *
 * RETRO-109 ADDENDUM: follow-385.test.ts AC-4 contains a modeled re-implementation
 * of the onAnswer guard (follow-385.test.ts:220) that never calls the real handler
 * (Rule L violation). This file closes that gap by driving the REAL path:
 *
 *   _initForTest() → init() registers the 90s tryShowMicroPoll() setTimeout
 *   → vi.advanceTimersByTimeAsync(90_000) fires it
 *   → tryShowMicroPoll() calls renderMicroPoll() (real DOM mutation)
 *   → click ".estalara-micro-poll__btn-yes" in shadow DOM
 *   → real onAnswer callback at index.ts:1233 fires
 *   → §H.9 guard at index.ts:1243 branches on `profilingOptedOut`
 *
 * The test FAILS if the guard at index.ts:1243 is deleted or relocated because:
 *   - opted-out / intent check: sessionStorage would be mutated after click
 *   - opted-out / ingest check: quiz.event(trigger:micro_poll) would appear in batch
 *
 * Rule L compliance: micro_polls_enabled: true comes from the mock /quiz/public-config
 * response (mirrors the real server config field). The §H.9 opt-out flag is read from
 * localStorage via isProfilingOptedOut() — NOT injected by the test. Setting
 * PROFILING_OPT_OUT_KEY in localStorage is not "injecting the guard value"; it is
 * exercising the production localStorage-read path that profilingOptedOut is derived from.
 *
 * @module packages/sdk/src/__tests__/follow-409.test
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROFILING_OPT_OUT_KEY } from '../core/profiling-opt-out.js';
import { _initForTest } from '../index.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const SESSION_ID = 'a'.repeat(64);
const DECISION_API_URL = 'https://api.example.com/api';
const INGEST_URL = 'https://ingest.estalara.com/v1/events';

/** 90-second micro-poll trigger delay (inline constant at index.ts:1300). */
const MICRO_POLL_TIMER_MS = 90_000;

// ---------------------------------------------------------------------------
// Test helpers — mirror the patterns from follow-389.test.ts
// ---------------------------------------------------------------------------

function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({
      sessionId: SESSION_ID,
      startedAt: Date.now(),
      pageCount: 1,
    }),
  );
}

function insertScriptTag(): void {
  const script = document.createElement('script');
  script.dataset.apiKey = 'test-follow409-api-key';
  script.dataset.decisionUrl = DECISION_API_URL;
  script.dataset.tenantId = '550e8400-e29b-41d4-a716-446655440000';
  document.head.appendChild(script);
}

function removeScriptTags(): void {
  document.querySelectorAll<HTMLScriptElement>('script[data-api-key]').forEach((el) => {
    el.remove();
  });
}

function removeShadowHosts(): void {
  document.querySelectorAll('[data-estalara-host]').forEach((el) => {
    el.remove();
  });
}

function runTeardown(): void {
  const td = (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  if (td) {
    td();
    delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  }
}

function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  removeScriptTags();
  removeShadowHosts();
  document.body.innerHTML = '';
}

/**
 * Mock fetch returning micro_polls_enabled: true from /quiz/public-config.
 * This causes init() to set config.microPollsEnabled = true, which registers
 * the 90s setTimeout(() => tryShowMicroPoll(), 90_000) at index.ts:1299-1303.
 * The §H.9 opt-out guard under test (profilingOptedOut) is independent: it
 * is read from localStorage via isProfilingOptedOut(), not from this response.
 */
function buildMockFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/quiz/public-config')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            quiz_enabled: true,
            micro_polls_enabled: true,
            language: 'en',
            accent_color: '#6c5ce7',
          }),
      });
    }
    if (url.includes('/intent/config')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) });
    }
    if (url.includes('/adapt/description')) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }
    if (url.includes('/adapt')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            adapt_decision_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            session_id: SESSION_ID,
            archetype: 'neutral',
            confidence: 0.5,
            similarity: 0.5,
            tier: 1,
            source: 'playbook',
            generated_at: '2026-06-26T00:00:00.000Z',
            directives: [],
            ttl_seconds: 300,
            variant: 'control',
          }),
      });
    }
    // Default: 200 OK (ingest, quiz/completion, other URLs)
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

/**
 * Find the Yes button rendered by renderMicroPoll inside any shadow host.
 * Returns null if tryShowMicroPoll has not yet fired or was suppressed.
 */
function findMicroPollYesButton(): HTMLButtonElement | null {
  let btn: HTMLButtonElement | null = null;
  document.querySelectorAll('[data-estalara-host]').forEach((host) => {
    const root = host.shadowRoot;
    const found = root?.querySelector<HTMLButtonElement>('.estalara-micro-poll__btn-yes');
    if (found) btn = found;
  });
  return btn;
}

// ---------------------------------------------------------------------------
// REAL-4 opted-out: intent NOT mutated, quiz.event absent from ingest batch
// ---------------------------------------------------------------------------

describe('FOLLOW-409 REAL-4: micro-poll onAnswer real guard — opted-out session', () => {
  beforeEach(() => {
    clearAll();
    localStorage.setItem('estalara_consent', 'granted');
    // §H.9 profiling opt-out: exercises the real isProfilingOptedOut() read path
    localStorage.setItem(PROFILING_OPT_OUT_KEY, 'true');
    seedSession();
    vi.useFakeTimers();
  });

  afterEach(() => {
    runTeardown();
    clearAll();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('opted-out: intent NOT mutated AND quiz.event(trigger:micro_poll) absent from ingest', async () => {
    const mockFetch = buildMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    insertScriptTag();

    // Drive the REAL init() — registers the 90s tryShowMicroPoll() timer
    await _initForTest();

    // Advance 90 s → setTimeout(() => tryShowMicroPoll(), 90_000) fires
    // tryShowMicroPoll() passes all guards (microPollsEnabled, shadowHost, etc.)
    // and calls renderMicroPoll() → shadow DOM gets .estalara-micro-poll__btn-yes
    await vi.advanceTimersByTimeAsync(MICRO_POLL_TIMER_MS);

    const yesButton = findMicroPollYesButton();
    // Micro-poll must have rendered — if tryShowMicroPoll is suppressed (e.g. by
    // a new profilingOptedOut guard added to tryShowMicroPoll itself), this fails.
    expect(yesButton).not.toBeNull();

    // Opted-out: cold-start block (index.ts:854) is skipped when profilingOptedOut=true
    // → persistIntentState is never called during init → intent key is absent.
    const intentKey = `estalara_intent_${SESSION_ID}`;
    expect(sessionStorage.getItem(intentKey)).toBeNull();

    // Click the REAL "Tak" button — drives the onAnswer callback at index.ts:1233.
    // The callback runs: microPollQuestionIndex += 1; microPollShownThisSession = false;
    // then hits `if (profilingOptedOut) return;` at index.ts:1243 and exits.
    yesButton!.click();

    // Intent state must remain absent — applyBehavioralSignal and onIntentUpdate were
    // never reached (the guard at :1243 returned before them).
    // FAILS if the guard is deleted: applyBehavioralSignal would run → onIntentUpdate
    // → persistIntentState → sessionStorage entry would be non-null.
    expect(sessionStorage.getItem(intentKey)).toBeNull();

    // Advance to trigger event queue flush (BATCH_INTERVAL_MS = 5000ms per index.ts:198)
    await vi.advanceTimersByTimeAsync(5001);

    // No quiz.event with trigger:'micro_poll' must appear in the ingest batch.
    // FAILS if the guard is deleted: eventQueue.push({ type: 'quiz.event', trigger: 'micro_poll' })
    // at index.ts:1258 would run and the event would be flushed to ingest.
    const ingestCalls = (mockFetch.mock.calls as [string, RequestInit][]).filter(
      ([url]) => typeof url === 'string' && url.includes('/v1/events'),
    );
    const hasMicroPollEvent = ingestCalls.some(([, init]) => {
      try {
        const body = JSON.parse(init.body as string) as {
          events: { type: string; payload?: { trigger?: string } }[];
        };
        return body.events.some(
          (e) => e.type === 'quiz.event' && e.payload?.trigger === 'micro_poll',
        );
      } catch {
        return false;
      }
    });
    expect(hasMicroPollEvent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REAL-4 opted-in: intent IS mutated, quiz.event present in ingest batch
// ---------------------------------------------------------------------------

describe('FOLLOW-409 REAL-4: micro-poll onAnswer real guard — opted-in session', () => {
  beforeEach(() => {
    clearAll();
    localStorage.setItem('estalara_consent', 'granted');
    // No PROFILING_OPT_OUT_KEY → profilingOptedOut = false
    seedSession();
    vi.useFakeTimers();
  });

  afterEach(() => {
    runTeardown();
    clearAll();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('opted-in: intent signal_count incremented AND quiz.event(trigger:micro_poll) in ingest', async () => {
    const mockFetch = buildMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    insertScriptTag();

    await _initForTest();

    // Opted-in: cold-start block ran → persistIntentState called → intent key present
    const intentKey = `estalara_intent_${SESSION_ID}`;
    const intentBefore = sessionStorage.getItem(intentKey);
    expect(intentBefore).not.toBeNull();
    const signalCountBefore = (JSON.parse(intentBefore!) as { state: { signal_count: number } })
      .state.signal_count;

    // Advance 90 s → tryShowMicroPoll() fires → renderMicroPoll() → shadow DOM updated
    await vi.advanceTimersByTimeAsync(MICRO_POLL_TIMER_MS);

    const yesButton = findMicroPollYesButton();
    expect(yesButton).not.toBeNull();

    // Click the REAL "Tak" button — drives the onAnswer callback at index.ts:1233.
    // profilingOptedOut=false → guard at :1243 does NOT return early.
    // applyBehavioralSignal runs → onIntentUpdate → persistIntentState → sessionStorage updated.
    yesButton!.click();

    const intentAfter = sessionStorage.getItem(intentKey);
    expect(intentAfter).not.toBeNull();
    const signalCountAfter = (JSON.parse(intentAfter!) as { state: { signal_count: number } }).state
      .signal_count;
    // signal_count MUST increase — applyBehavioralSignal('micro_poll.answered') ran
    expect(signalCountAfter).toBeGreaterThan(signalCountBefore);

    // Advance to flush the event queue (BATCH_INTERVAL_MS = 5000ms per index.ts:198)
    await vi.advanceTimersByTimeAsync(5001);

    // quiz.event with trigger:'micro_poll' MUST be in the ingest batch
    const ingestCalls = (mockFetch.mock.calls as [string, RequestInit][]).filter(
      ([url]) => typeof url === 'string' && url.includes(INGEST_URL),
    );
    expect(ingestCalls.length).toBeGreaterThan(0);

    const hasMicroPollEvent = ingestCalls.some(([, init]) => {
      try {
        const body = JSON.parse(init.body as string) as {
          events: { type: string; payload?: { trigger?: string } }[];
        };
        return body.events.some(
          (e) => e.type === 'quiz.event' && e.payload?.trigger === 'micro_poll',
        );
      } catch {
        return false;
      }
    });
    expect(hasMicroPollEvent).toBe(true);
  });
});
