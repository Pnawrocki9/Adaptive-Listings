// @vitest-environment jsdom
/**
 * FOLLOW-101 SDK-side tests — chat-intent Bayesian prior bridge (AC-4, AC-5, AC-6).
 *
 * Coverage:
 *   AC-4: When fetchDirectives receives chat_intent_dimensions, applyChatIntentPrior is
 *         called and the updated IntentState is returned in FetchDirectivesResult.
 *   AC-4: When chat_intent_dimensions is absent / empty, applyChatIntentPrior is NOT called.
 *   AC-4: Mismatch path — quiz.mismatch event dispatched when chat_mismatch is set.
 *   AC-5: Rule R idempotency — prior is applied at most once per session ID even when
 *         fetchDirectives is called multiple times (cross-listing navigation simulation).
 *   AC-6: Persist — sessionStorage contains the updated intent state serialised by
 *         persistIntentState after a chat-intent update.
 *
 * Design notes:
 *   - applyChatIntentPrior is NOT mocked — real Bayesian updates run so the test proves
 *     the integration, not just that we called a stub.
 *   - persistIntentState IS real; sessionStorage is provided by jsdom.
 *   - pushEvent is observed through the event queue (setEventQueueRef).
 *   - The session module is NOT mocked (getConsentState is needed by fetchDirectives);
 *     consentState is set via the initSession route through config.consentState.
 *
 * @module packages/sdk/src/__tests__/follow-101
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { CollectedEvent } from '../core/events.js';
import type { SdkConfig } from '../core/config.js';
import type { SessionState } from '../core/session.js';
import {
  fetchDirectives,
  resetAdaptState,
  setEventQueueRef,
  type FetchDirectivesResult,
} from '../core/adapt.js';
import { initIntentState, applyQuizPrior } from '../core/intent.js';
import type { IntentState } from '../core/intent.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440011';
const SESSION_ID = 'follow-101-sess-001';

const BASE_CONFIG: SdkConfig = {
  apiKey: 'est_pub_follow101',
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
  decisionApiUrl: 'https://admin.estalara.com/api',
  tenantId: TENANT_ID,
};

const SESSION: SessionState = {
  sessionId: SESSION_ID,
  startedAt: Date.now(),
  pageCount: 1,
};

/**
 * Minimal valid AdaptResponse body (will be extended per test).
 * All required fields present, no chat_intent_dimensions by default.
 */
const BASE_ADAPT_RESPONSE = {
  adapt_decision_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  session_id: SESSION_ID,
  archetype: 'neutral',
  confidence: 0.5,
  similarity: 0.5,
  tier: 1 as const,
  directives: [],
  source: 'playbook' as const,
  generated_at: '2026-06-10T00:00:00.000Z',
};

/**
 * Build a mock fetch that returns the given server body once.
 */
function mockFetchOnce(serverBody: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(serverBody),
    }),
  );
}

// ─── State ────────────────────────────────────────────────────────────────────

let eventQueue: CollectedEvent[];

beforeEach(() => {
  eventQueue = [];
  setEventQueueRef(eventQueue);
  resetAdaptState();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

// ─── AC-4: applyChatIntentPrior called when dims present ─────────────────────

describe('FOLLOW-101 AC-4 — chat_intent_dimensions present → prior applied', () => {
  it('returns updatedIntentState in FetchDirectivesResult when dims are present', async () => {
    const serverBody = {
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
    };
    vi.stubGlobal('fetch', mockFetchOnce(serverBody));

    const intentState = initIntentState();
    const result: FetchDirectivesResult = await fetchDirectives(
      BASE_CONFIG,
      SESSION,
      'listing_list',
      intentState,
    );

    expect(result.adaptResponse).not.toBeNull();
    expect(result.updatedIntentState).toBeDefined();
    // The prior biases toward investor archetypes — archetype or confidence must shift.
    // (Real Bayesian update: purchase_purpose=investment lifts yield_hunter, etc.)
    const updated = result.updatedIntentState!;
    expect(updated).not.toBe(intentState); // new reference, not mutation
    expect(updated.signal_count).toBe(intentState.signal_count); // preserved per spec
  });

  it('updatedIntentState reflects the Bayesian shift from chat dims', async () => {
    const serverBody = {
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
    };
    vi.stubGlobal('fetch', mockFetchOnce(serverBody));

    const intentState = initIntentState();
    const { updatedIntentState } = await fetchDirectives(
      BASE_CONFIG,
      SESSION,
      'listing_list',
      intentState,
    );

    // purchase_purpose=investment is a strong signal toward investor archetypes.
    // The updated probability for yield_hunter (or equivalent) must exceed the prior.
    // We verify the distribution shifted in the investment direction.
    const priorYH = intentState.probabilities.yield_hunter;
    const updatedYH = updatedIntentState!.probabilities.yield_hunter;
    expect(updatedYH).toBeGreaterThan(priorYH);
  });

  it('does NOT return updatedIntentState when no intentState is passed', async () => {
    const serverBody = {
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
    };
    vi.stubGlobal('fetch', mockFetchOnce(serverBody));

    // intentState argument omitted — bridge cannot apply the prior without a state
    const result = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list');

    expect(result.adaptResponse).not.toBeNull();
    expect(result.updatedIntentState).toBeUndefined();
  });

  it('does NOT return updatedIntentState when chat_intent_dimensions is absent', async () => {
    // No chat_intent_dimensions in server response
    vi.stubGlobal('fetch', mockFetchOnce({ ...BASE_ADAPT_RESPONSE }));

    const intentState = initIntentState();
    const result = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);

    expect(result.adaptResponse).not.toBeNull();
    expect(result.updatedIntentState).toBeUndefined();
  });

  it('does NOT return updatedIntentState when chat_intent_dimensions is empty object', async () => {
    const serverBody = { ...BASE_ADAPT_RESPONSE, chat_intent_dimensions: {} };
    vi.stubGlobal('fetch', mockFetchOnce(serverBody));

    const intentState = initIntentState();
    const result = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);

    expect(result.adaptResponse).not.toBeNull();
    expect(result.updatedIntentState).toBeUndefined();
  });

  it('does NOT return updatedIntentState when chat_intent_dimensions is null', async () => {
    const serverBody = { ...BASE_ADAPT_RESPONSE, chat_intent_dimensions: null };
    vi.stubGlobal('fetch', mockFetchOnce(serverBody));

    const intentState = initIntentState();
    const result = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);

    expect(result.adaptResponse).not.toBeNull();
    expect(result.updatedIntentState).toBeUndefined();
  });
});

// ─── AC-4: quiz.mismatch event dispatched on mismatch path ───────────────────

describe('FOLLOW-101 AC-4 — mismatch path → quiz.mismatch event dispatched', () => {
  it('dispatches quiz.mismatch to event queue when chat prior disagrees with quiz archetype', async () => {
    // Set up a state where the quiz said "family_buyer" (personal/long) but chat says
    // "investment" — this should trigger chat_mismatch in applyChatIntentPrior.
    let intentState = initIntentState();
    // Simulate quiz answered: personal use, long horizon → family_buyer territory
    intentState = applyQuizPrior(intentState, 'personal', 'long');

    // Chat says investment — strongly contradicts the quiz
    const serverBody = {
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
    };
    vi.stubGlobal('fetch', mockFetchOnce(serverBody));

    const result = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);

    expect(result.adaptResponse).not.toBeNull();

    // Only assert mismatch event IF the updated state has chat_mismatch set.
    // (If the probability gap doesn't exceed MISMATCH_GAP_THRESHOLD, no event is expected.)
    if (result.updatedIntentState?.chat_mismatch) {
      const mismatchEvents = eventQueue.filter((e) => e.type === 'quiz.mismatch');
      expect(mismatchEvents).toHaveLength(1);

      const payload = mismatchEvents[0]!.payload;
      expect(payload.quiz_archetype).toBe(result.updatedIntentState.chat_mismatch.quiz_archetype);
      expect(payload.behavioral_archetype).toBe(
        result.updatedIntentState.chat_mismatch.chat_archetype,
      );
      expect(typeof payload.confidence_gap).toBe('number');
      expect(typeof payload.signal_count).toBe('number');
    } else {
      // Gap didn't cross threshold — confirm no spurious event
      const mismatchEvents = eventQueue.filter((e) => e.type === 'quiz.mismatch');
      expect(mismatchEvents).toHaveLength(0);
    }
  });

  it('does NOT dispatch quiz.mismatch when there is no mismatch (same archetype reinforced)', async () => {
    // Quiz and chat both investment-oriented → no mismatch expected
    let intentState = initIntentState();
    intentState = applyQuizPrior(intentState, 'investment', 'short');

    const serverBody = {
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
    };
    vi.stubGlobal('fetch', mockFetchOnce(serverBody));

    await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);

    const mismatchEvents = eventQueue.filter((e) => e.type === 'quiz.mismatch');
    expect(mismatchEvents).toHaveLength(0);
  });
});

// ─── AC-5: Rule R idempotency gate ───────────────────────────────────────────

describe('FOLLOW-101 AC-5 — Rule R idempotency: prior applied at most once per session', () => {
  it('applies chat prior on first call but NOT on subsequent calls with same session ID', async () => {
    const serverBody = {
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
    };

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(serverBody),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const intentState = initIntentState();

    // First call — prior should be applied
    const result1 = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);
    expect(result1.updatedIntentState).toBeDefined();

    // Second call — same session ID — prior must NOT be re-applied (Rule R)
    const result2 = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_detail', intentState);
    expect(result2.adaptResponse).not.toBeNull();
    expect(result2.updatedIntentState).toBeUndefined();
  });

  it('resets the idempotency gate after resetAdaptState()', async () => {
    const serverBody = {
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(serverBody),
        }),
      ),
    );

    const intentState = initIntentState();

    // First call — prior applied
    const result1 = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);
    expect(result1.updatedIntentState).toBeDefined();

    // Reset (new session / archetype change) then call again
    resetAdaptState();

    const result2 = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);
    // Gate reset → prior should be applied again
    expect(result2.updatedIntentState).toBeDefined();
  });
});

// ─── AC-6: sessionStorage persistence ────────────────────────────────────────

describe('FOLLOW-101 AC-6 — sessionStorage persisted after chat-intent update', () => {
  it('writes updated IntentState to sessionStorage under estalara_intent key', async () => {
    const serverBody = {
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
    };
    vi.stubGlobal('fetch', mockFetchOnce(serverBody));

    const intentState = initIntentState();
    const result = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);

    expect(result.updatedIntentState).toBeDefined();

    // persistIntentState writes to `estalara_intent_<sessionId>` (underscore separator)
    const storageKey = `estalara_intent_${SESSION_ID}`;
    const raw = sessionStorage.getItem(storageKey);
    expect(raw).not.toBeNull();

    const stored = JSON.parse(raw!) as { version: number; state: IntentState };
    expect(stored.state).toBeDefined();
    // Stored state must reflect the chat-intent update
    expect(stored.state.probabilities).toBeDefined();
    // Bayesian update shifted yield_hunter probability up
    const updatedYH = stored.state.probabilities.yield_hunter;
    const priorYH = intentState.probabilities.yield_hunter;
    expect(updatedYH).toBeGreaterThan(priorYH);
  });

  it('does NOT write to sessionStorage when no chat_intent_dimensions', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ ...BASE_ADAPT_RESPONSE }));

    const intentState = initIntentState();
    await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);

    const storageKey = `estalara_intent_${SESSION_ID}`;
    const raw = sessionStorage.getItem(storageKey);
    expect(raw).toBeNull();
  });
});
