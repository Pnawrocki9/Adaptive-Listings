/**
 * FOLLOW-389 — Real-handler tests for §H.9 opt-out guards.
 *
 * Rationale (RETRO-109 TG-1): follow-385.test.ts contains 9 modeled re-implementations
 * that never call real handlers (Rule L violation). This file AUGMENTS those tests with
 * real-handler tests that would fail if the guards were removed from production code.
 *
 * Tests:
 *   REAL-1 — postQuizCompletionPing appends profiling_opt_out=1 when profilingOptedOut=true.
 *             Drives the REAL exported function from core/adapt.ts (HW-1 wire test).
 *             The route gate at apps/control-plane/.../quiz/completion/route.ts:363 is
 *             now reachable by real SDK traffic (defense-in-depth, FOLLOW-389 HW-1).
 *
 *   REAL-2 — estalara:listing:favorited CustomEvent drives the REAL window event handler
 *             wired by init() (via _initForTest seam). Asserts:
 *               opted-out → eventQueue push (listing.bookmarked) present in ingest batch;
 *                           intent state in sessionStorage NOT updated.
 *               opted-in  → eventQueue push present; intent state signal_count increments.
 *
 *   REAL-3 — showQuizTrigger at index.ts:1103 drives the REAL quiz-trigger path via
 *             _initForTest + vi.advanceTimersByTimeAsync. Asserts:
 *               opted-out → .estalara-trigger NOT in shadow DOM after 30 s.
 *               opted-in  → .estalara-trigger IS in shadow DOM after 30 s.
 *
 * Rule L compliance: no guard logic is re-implemented inline. Every assertion drives
 * the real handler/function from production modules.
 *
 * @module packages/sdk/src/__tests__/follow-389.test
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postQuizCompletionPing } from '../core/adapt.js';
import { PROFILING_OPT_OUT_KEY } from '../core/profiling-opt-out.js';
import { QUIZ_TRIGGER_DELAY_MS } from '../ui/quiz-trigger.js';
import { _initForTest } from '../index.js';
import type { SdkConfig } from '../core/config.js';
import type { SessionState } from '../core/session.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const SESSION_ID = 'a'.repeat(64);
const DECISION_API_URL = 'https://api.example.com/api';
const INGEST_URL = 'https://ingest.estalara.com/v1/events';

const BASE_CONFIG: SdkConfig = {
  apiKey: 'test-follow389-api-key',
  ingestUrl: INGEST_URL,
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
  decisionApiUrl: DECISION_API_URL,
  tenantId: '550e8400-e29b-41d4-a716-446655440000',
};

const BASE_SESSION: SessionState = {
  sessionId: SESSION_ID,
  startedAt: Date.now(),
  pageCount: 1,
};

// ---------------------------------------------------------------------------
// Integration test helpers
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

function insertScriptTag(): HTMLScriptElement {
  const script = document.createElement('script');
  script.dataset.apiKey = BASE_CONFIG.apiKey;
  script.dataset.decisionUrl = DECISION_API_URL;
  script.dataset.tenantId = BASE_CONFIG.tenantId ?? '';
  document.head.appendChild(script);
  return script;
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
 * Minimal mock fetch that returns OK for all SDK requests.
 * Returns a valid QuizPublicConfigResponse for /quiz/public-config,
 * a minimal intent weights response for /intent/config,
 * a neutral adapt response for /adapt,
 * and 200 OK for everything else (ingest, description, etc.).
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
            micro_polls_enabled: false,
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
            adapt_decision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            session_id: SESSION_ID,
            archetype: 'neutral',
            confidence: 0.5,
            similarity: 0.5,
            tier: 1,
            source: 'playbook',
            generated_at: '2026-06-25T00:00:00.000Z',
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

// ---------------------------------------------------------------------------
// REAL-1: postQuizCompletionPing URL (HW-1)
// Tests the REAL exported function from core/adapt.ts.
//
// Pattern mirrors adapt.test.ts (line 1116-1131): stub crypto.subtle so
// computeHmacSha256Hex resolves as microtasks (not I/O macrotasks), keeping
// the async chain deterministic within the test boundary.
// ---------------------------------------------------------------------------

describe('FOLLOW-389 REAL-1: postQuizCompletionPing appends profiling_opt_out=1 when opted out', () => {
  // Fake CryptoKey and sig used by the stubbed SubtleCrypto
  const fakeKey = {} as CryptoKey;
  const fakeSig = new Uint8Array(32).fill(0xbb).buffer;

  beforeEach(() => {
    vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue(fakeKey);
    vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(fakeSig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends profiling_opt_out=1 to URL when profilingOptedOut=true', async () => {
    const mockFetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal('fetch', mockFetch);

    postQuizCompletionPing(BASE_CONFIG, BASE_SESSION.sessionId, 'yield_seeker', 'en', true);

    // Drain the microtask queue: importKey → sign → .then(fetch) = 3 layers
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.lastCall as [string, RequestInit];
    expect(url).toContain('profiling_opt_out=1');
    expect(url).toContain('/quiz/completion');
  });

  it('does NOT append profiling_opt_out when profilingOptedOut=false', async () => {
    const mockFetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal('fetch', mockFetch);

    postQuizCompletionPing(BASE_CONFIG, BASE_SESSION.sessionId, 'yield_seeker', 'en', false);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.lastCall as [string, RequestInit];
    expect(url).not.toContain('profiling_opt_out');
    expect(url).toContain('/quiz/completion');
  });

  it('does NOT append profiling_opt_out when profilingOptedOut is omitted', async () => {
    const mockFetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal('fetch', mockFetch);

    postQuizCompletionPing(BASE_CONFIG, BASE_SESSION.sessionId, 'yield_seeker', 'en');

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.lastCall as [string, RequestInit];
    expect(url).not.toContain('profiling_opt_out');
    expect(url).toContain('/quiz/completion');
  });
});

// ---------------------------------------------------------------------------
// REAL-2: estalara:listing:favorited real handler via _initForTest + dispatch
// ---------------------------------------------------------------------------

describe('FOLLOW-389 REAL-2: estalara:listing:favorited real handler (opted-out)', () => {
  // Opted-out test runs FIRST to ensure no leftover opted-in handlers from
  // previous tests that could contaminate the sessionStorage assertions.

  beforeEach(() => {
    clearAll();
    // Grant consent so init() does not halt at the consent gate
    localStorage.setItem('estalara_consent', 'granted');
    // Opted-out: set §H.9 profiling opt-out flag
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

  it('opted-out: listing.bookmarked in ingest batch; intent state in sessionStorage NOT set', async () => {
    const mockFetch = buildMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    insertScriptTag();

    // Drive the REAL init() via the test seam — registers the real window handler
    await _initForTest();

    // For opted-out users, the cold-start block is skipped → no intent state in sessionStorage
    const intentKey = `estalara_intent_${SESSION_ID}`;
    expect(sessionStorage.getItem(intentKey)).toBeNull();

    // Dispatch the REAL estalara:listing:favorited CustomEvent on window
    window.dispatchEvent(
      new CustomEvent('estalara:listing:favorited', {
        detail: { listingId: 'listing-opt-out-001', listingType: 'residential', bedroomCount: 3 },
      }),
    );

    // Intent state must remain null — the real handler returned early at line 1425
    // (profilingOptedOut=true → applyBehavioralSignal and onIntentUpdate are skipped)
    expect(sessionStorage.getItem(intentKey)).toBeNull();

    // Advance timers to trigger the 5 s batch flush — the listing.bookmarked push
    // happens BEFORE the opt-out guard (§H.8 preserved), so it must appear in the batch
    await vi.advanceTimersByTimeAsync(5001);

    const ingestCalls = (mockFetch.mock.calls as [string, RequestInit][]).filter(
      ([url]) => typeof url === 'string' && url.includes('/v1/events'),
    );
    expect(ingestCalls.length).toBeGreaterThan(0);

    const hasBookmarked = ingestCalls.some(([, init]) => {
      try {
        const body = JSON.parse(init.body as string) as {
          events: { type: string }[];
        };
        return body.events.some((e) => e.type === 'listing.bookmarked');
      } catch {
        return false;
      }
    });
    expect(hasBookmarked).toBe(true);
  });
});

describe('FOLLOW-389 REAL-2: estalara:listing:favorited real handler (opted-in)', () => {
  beforeEach(() => {
    clearAll();
    localStorage.setItem('estalara_consent', 'granted');
    // Opted-in: no profiling opt-out flag
    seedSession();
    vi.useFakeTimers();
  });

  afterEach(() => {
    runTeardown();
    clearAll();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('opted-in: listing.bookmarked in ingest batch; intent state signal_count increments', async () => {
    const mockFetch = buildMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    insertScriptTag();

    await _initForTest();

    // For opted-in users, cold-start block runs → intent state set in sessionStorage
    const intentKey = `estalara_intent_${SESSION_ID}`;
    const intentBefore = sessionStorage.getItem(intentKey);
    expect(intentBefore).not.toBeNull();

    // Dispatch the REAL estalara:listing:favorited CustomEvent
    window.dispatchEvent(
      new CustomEvent('estalara:listing:favorited', {
        detail: { listingId: 'listing-opt-in-001', listingType: 'residential', bedroomCount: 3 },
      }),
    );

    // Intent state MUST be updated — the real handler called applyBehavioralSignal
    // → onIntentUpdate → persistIntentState (signal_count increases)
    const intentAfter = sessionStorage.getItem(intentKey);
    expect(intentAfter).not.toBeNull();

    const parsedBefore = JSON.parse(intentBefore!) as { state: { signal_count: number } };
    const parsedAfter = JSON.parse(intentAfter!) as { state: { signal_count: number } };
    expect(parsedAfter.state.signal_count).toBeGreaterThan(parsedBefore.state.signal_count);

    // listing.bookmarked must also appear in the ingest batch
    await vi.advanceTimersByTimeAsync(5001);

    const ingestCalls = (mockFetch.mock.calls as [string, RequestInit][]).filter(
      ([url]) => typeof url === 'string' && url.includes('/v1/events'),
    );
    expect(ingestCalls.length).toBeGreaterThan(0);

    const hasBookmarked = ingestCalls.some(([, init]) => {
      try {
        const body = JSON.parse(init.body as string) as {
          events: { type: string }[];
        };
        return body.events.some((e) => e.type === 'listing.bookmarked');
      } catch {
        return false;
      }
    });
    expect(hasBookmarked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REAL-3: showQuizTrigger real guard via _initForTest + fake timers
// Tests that the §H.9 guard at index.ts:1103 prevents renderQuizTrigger.
// ---------------------------------------------------------------------------

describe('FOLLOW-389 REAL-3: showQuizTrigger returns early when profilingOptedOut=true', () => {
  beforeEach(() => {
    clearAll();
    localStorage.setItem('estalara_consent', 'granted');
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

  it('opted-out: .estalara-trigger NOT rendered in shadow DOM after 30 s', async () => {
    vi.stubGlobal('fetch', buildMockFetch());
    insertScriptTag();

    // Drive the REAL init() — registers the real showQuizTrigger scheduler
    await _initForTest();

    // Advance past the quiz trigger delay — fires scheduleQuizTrigger callback
    await vi.advanceTimersByTimeAsync(QUIZ_TRIGGER_DELAY_MS);

    // The REAL showQuizTrigger has `if (profilingOptedOut) return;` as its first statement.
    // If that guard is present, renderQuizTrigger is never called → no .estalara-trigger.
    const shadowHosts = document.querySelectorAll('[data-estalara-host]');
    let triggerFound = false;
    shadowHosts.forEach((host) => {
      const root = host.shadowRoot;
      if (root?.querySelector('.estalara-trigger')) triggerFound = true;
    });
    expect(triggerFound).toBe(false);
  });
});

describe('FOLLOW-389 REAL-3: showQuizTrigger renders when profilingOptedOut=false', () => {
  beforeEach(() => {
    clearAll();
    localStorage.setItem('estalara_consent', 'granted');
    // Opted-in: no profiling opt-out flag
    seedSession();
    vi.useFakeTimers();
  });

  afterEach(() => {
    runTeardown();
    clearAll();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('opted-in: .estalara-trigger IS rendered in shadow DOM after 30 s', async () => {
    vi.stubGlobal('fetch', buildMockFetch());
    insertScriptTag();

    await _initForTest();

    await vi.advanceTimersByTimeAsync(QUIZ_TRIGGER_DELAY_MS);

    const shadowHosts = document.querySelectorAll('[data-estalara-host]');
    let triggerFound = false;
    shadowHosts.forEach((host) => {
      const root = host.shadowRoot;
      if (root?.querySelector('.estalara-trigger')) triggerFound = true;
    });
    expect(triggerFound).toBe(true);
  });
});
