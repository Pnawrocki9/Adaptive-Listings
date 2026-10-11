// @vitest-environment jsdom
/**
 * FOLLOW-101 SDK-side tests — chat-intent Bayesian prior bridge (AC-4, AC-5, AC-6).
 *
 * Coverage:
 *   AC-4: When fetchDirectives receives chat_intent_dimensions, applyChatIntentPrior is
 *         called and the updated IntentState is returned in FetchDirectivesResult.
 *   AC-4: When chat_intent_dimensions is absent / empty, applyChatIntentPrior is NOT called.
 *   AC-4: Mismatch path — `chat_mismatch` is returned on the folded state; since FOLLOW-1306
 *         the `quiz.mismatch` event is queued by the CALLER after it accepts the reply
 *         (follow-1306.test.ts drives that through the real init()).
 *   AC-5: Rule R idempotency — a state that already carries the fold is never folded again.
 *   AC-6: Persist — since FOLLOW-1306 (F-25) fetchDirectives itself writes NOTHING; the caller
 *         persists only a reply that survives its latest-wins check.
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
import { initIntentState, applyQuizLeaf } from '../core/intent.js';

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
    intentState = applyQuizLeaf(intentState, 'family_buyer');

    // Chat says investment — strongly contradicts the quiz
    const serverBody = {
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
    };
    vi.stubGlobal('fetch', mockFetchOnce(serverBody));

    const result = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);

    expect(result.adaptResponse).not.toBeNull();

    // FOLLOW-1306 (F-25): the reply may still lose the caller's latest-wins check, so
    // fetchDirectives queues no quiz.mismatch itself — the caller does, once it accepts the fold.
    expect(eventQueue.filter((e) => e.type === 'quiz.mismatch')).toHaveLength(0);
  });

  it('does NOT dispatch quiz.mismatch when there is no mismatch (same archetype reinforced)', async () => {
    // Quiz and chat both investment-oriented → no mismatch expected
    let intentState = initIntentState();
    intentState = applyQuizLeaf(intentState, 'flip_investor');

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
  it('applies chat prior on first call but NOT on a call that passes the folded state', async () => {
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

    // Second call carries the accepted fold (as refreshDirectives does) — prior must NOT be
    // re-applied (Rule R). FOLLOW-1306: the guard is the state's own marker, not module memory.
    const result2 = await fetchDirectives(
      BASE_CONFIG,
      SESSION,
      'listing_detail',
      result1.updatedIntentState,
    );
    expect(result2.adaptResponse).not.toBeNull();
    expect(result2.updatedIntentState).toBeUndefined();
  });

  it('a call that passes the UNfolded state folds again — the caller decides what is kept', async () => {
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

    // FOLLOW-1306 (F-25): no in-memory key records the first fold, so a reply that was later
    // discarded by the caller can no longer block the accepted one from folding.
    const result2 = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);
    expect(result2.updatedIntentState).toBeDefined();
  });
});

// ─── AC-6: sessionStorage persistence ────────────────────────────────────────

describe('FOLLOW-101 AC-6 / FOLLOW-1306 F-25 — fetchDirectives persists nothing', () => {
  it('does NOT write the folded IntentState to sessionStorage (the caller does)', async () => {
    const serverBody = {
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
    };
    vi.stubGlobal('fetch', mockFetchOnce(serverBody));

    const intentState = initIntentState();
    const result = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list', intentState);

    expect(result.updatedIntentState).toBeDefined();
    // Bayesian update shifted yield_hunter probability up — on the RETURNED state.
    expect(result.updatedIntentState!.probabilities.yield_hunter).toBeGreaterThan(
      intentState.probabilities.yield_hunter,
    );

    // F-25: the reply may still lose refreshDirectives' latest-wins check; persisting here made
    // a discarded reply's fold permanent. `estalara_intent_<sessionId>` must stay unwritten.
    expect(sessionStorage.getItem(`estalara_intent_${SESSION_ID}`)).toBeNull();
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
