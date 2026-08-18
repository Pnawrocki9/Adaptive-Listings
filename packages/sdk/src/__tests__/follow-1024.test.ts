// @vitest-environment jsdom
/**
 * FOLLOW-1024 — chat evidence is folded once per MESSAGE, not once per session.
 *
 * WHY THIS CHANGED (CEO ruling 2026-08-18). Buyers click through the quiz without reading
 * it, or answer it with the property they think they want. The need they actually have
 * surfaces in the questions they then ask. The previous gate — `chatPriorApplied`, a boolean
 * set on the first fold — sampled that conversation at message one and ignored every message
 * after it, which is precisely the evidence worth the most.
 *
 * Rule R is NOT relaxed. Its requirement was never "fold once per session"; it was "never
 * count the SAME extraction twice", which matters because the 24h shadow key is returned on
 * every adapt call. The gate is now the extraction's own `detected_at` stamp.
 *
 * Every test drives the REAL `fetchDirectives` and the REAL `applyChatIntentPrior` — deleting
 * or inverting the watermark in `adapt.ts` turns these red.
 *
 * @module packages/sdk/src/__tests__/follow-1024
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { CollectedEvent } from '../core/events.js';
import type { SdkConfig } from '../core/config.js';
import type { SessionState } from '../core/session.js';
import { fetchDirectives, resetAdaptState, setEventQueueRef } from '../core/adapt.js';
import { applyChatIntentPrior, applyQuizLeaf, initIntentState } from '../core/intent.js';
import type { IntentState } from '../core/intent.js';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440011';
const SESSION_ID = 'follow-1024-sess-001';

const BASE_CONFIG: SdkConfig = {
  apiKey: 'est_pub_follow1024',
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
  decisionApiUrl: 'https://admin.estalara.com/api',
  tenantId: TENANT_ID,
};

const SESSION: SessionState = { sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 };

const BASE_ADAPT_RESPONSE = {
  adapt_decision_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  session_id: SESSION_ID,
  archetype: 'neutral',
  confidence: 0.5,
  similarity: 0.5,
  tier: 1 as const,
  directives: [],
  source: 'playbook' as const,
  generated_at: '2026-08-18T00:00:00.000Z',
};

function stubFetch(serverBody: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(serverBody) })),
  );
}

let eventQueue: CollectedEvent[];

beforeEach(() => {
  eventQueue = [];
  setEventQueueRef(eventQueue);
  resetAdaptState();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

// ─── The behaviour the ruling asked for ──────────────────────────────────────

describe('FOLLOW-1024 — a second buyer message moves the archetype again', () => {
  it('folds a NEW detected_at even though an earlier extraction was already folded', async () => {
    const start = initIntentState();

    stubFetch({
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
      chat_intent_detected_at: '2026-08-18T10:00:00.000Z',
    });
    const first = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_detail', start);
    const afterMsg1 = first.updatedIntentState;
    expect(afterMsg1).toBeDefined();
    expect(afterMsg1?.chatPriorAppliedAt).toBe('2026-08-18T10:00:00.000Z');

    stubFetch({
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { urgency: '0-3mo' },
      chat_intent_detected_at: '2026-08-18T10:01:30.000Z',
    });
    const second = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_detail', afterMsg1);

    // Under the old boolean gate this was `undefined` — the second message changed nothing.
    expect(second.updatedIntentState).toBeDefined();
    expect(second.updatedIntentState?.chatPriorAppliedAt).toBe('2026-08-18T10:01:30.000Z');
    expect(second.updatedIntentState?.probabilities).not.toEqual(afterMsg1?.probabilities);
  });

  it('does NOT re-fold the same extraction, however many times it is returned', async () => {
    const start = initIntentState();
    const body = {
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
      chat_intent_detected_at: '2026-08-18T10:00:00.000Z',
    };

    stubFetch(body);
    const first = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_detail', start);
    const afterMsg1 = first.updatedIntentState;
    expect(afterMsg1).toBeDefined();

    // Cross-listing navigation: same 24h shadow key, same stamp, three more adapt calls.
    for (let i = 0; i < 3; i++) {
      stubFetch(body);
      const again = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_detail', afterMsg1);
      // Rule R: the SAME extraction must never be multiplied in twice, or the posterior
      // saturates at 1.0 on a single message and nothing can move it afterwards.
      expect(again.updatedIntentState).toBeUndefined();
    }
  });

  it('a shadow record with NO stamp keeps the legacy once-per-session behaviour', async () => {
    const start = initIntentState();
    const body = {
      ...BASE_ADAPT_RESPONSE,
      chat_intent_dimensions: { purchase_purpose: 'investment' },
      // no chat_intent_detected_at — a record written before the stamp was read
    };

    stubFetch(body);
    const first = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_detail', start);
    expect(first.updatedIntentState).toBeDefined();
    expect(first.updatedIntentState?.chatPriorApplied).toBe(true);
    expect(first.updatedIntentState?.chatPriorAppliedAt).toBeUndefined();

    stubFetch(body);
    const second = await fetchDirectives(
      BASE_CONFIG,
      SESSION,
      'listing_detail',
      first.updatedIntentState,
    );
    // Without a stamp there is no way to tell a new message from the same one, so re-folding
    // would be the saturation bug. The safe fallback is the old semantics.
    expect(second.updatedIntentState).toBeUndefined();
  });
});

// ─── Accumulation: the actual point of the ruling ────────────────────────────

describe('FOLLOW-1024 — a conversation outweighs a quiz answer clicked through', () => {
  /** Fold a sequence of one-dimension messages, as fetchDirectives now does. */
  function converse(state: IntentState, dims: Record<string, string>[]): IntentState {
    return dims.reduce((acc, d) => applyChatIntentPrior(acc, d), state);
  }

  it('five investor-leaning questions re-classify a buyer who answered "family home"', () => {
    const quizzed = applyQuizLeaf(initIntentState(), 'family_buyer');
    expect(quizzed.archetype).toBe('family_buyer');
    // The quiz enters at p=0.85 — deliberately hard to overturn by accident.
    expect(quizzed.probabilities.family_buyer).toBeGreaterThan(0.8);

    const afterChat = converse(quizzed, [
      { purchase_purpose: 'investment' },
      { urgency: '0-3mo' },
      { purchase_purpose: 'investment' },
      { urgency: '0-3mo' },
      { purchase_purpose: 'investment' },
    ]);

    expect(afterChat.archetype).not.toBe('family_buyer');
    expect(afterChat.probabilities.family_buyer).toBeLessThan(quizzed.probabilities.family_buyer);
  });

  it('a single passing remark does NOT overturn the quiz', () => {
    const quizzed = applyQuizLeaf(initIntentState(), 'family_buyer');
    const afterOne = applyChatIntentPrior(quizzed, { purchase_purpose: 'investment' });
    // One dimension is a remark, not a revealed intent: it moves p(family_buyer) 0.850 → 0.537
    // against yield_hunter's 0.078, so the lead does not change hands. Those numbers are a
    // property of BASE_PRIOR × the quiz leaf × CHAT_INTENT_LIKELIHOODS — reproducible by
    // running this file, not an environment fact, so they belong here and not in the
    // measured-premise register.
    expect(afterOne.archetype).toBe('family_buyer');
  });

  it('never decays a quiz-resolved archetype to neutral (ADR-0014)', () => {
    const quizzed = applyQuizLeaf(initIntentState(), 'family_buyer');
    const afterChat = converse(quizzed, [
      { purchase_purpose: 'investment' },
      { urgency: '0-3mo' },
      { purchase_purpose: 'investment' },
    ]);
    expect(afterChat.archetype).not.toBe('neutral');
  });
});

// ─── Hysteresis, which only mattered once this runs repeatedly ───────────────

describe('FOLLOW-1024 — SWITCH_MARGIN hysteresis is applied on the chat path', () => {
  it('holds the current archetype when the new leader wins by less than SWITCH_MARGIN', () => {
    // Two archetypes deliberately near-tied. Before FOLLOW-1024 `applyChatIntentPrior`
    // called classifyFromProbabilities with no current archetype, so ANY lead re-labelled
    // the buyer — once per session that was invisible; once per message it is copy churn.
    const base = initIntentState();
    const nearTie: IntentState = {
      ...base,
      archetype: 'family_buyer',
      probabilities: { ...base.probabilities, family_buyer: 0.3, upsizer: 0.31 },
      quiz_answered: true,
    };
    // A dimension that touches neither of the two leaves the ordering as-is.
    const after = applyChatIntentPrior(nearTie, { tax_aware: 'true' });
    if (after !== nearTie && after.archetype !== nearTie.archetype) {
      const gap = after.probabilities[after.archetype] - after.probabilities.family_buyer;
      expect(gap).toBeGreaterThanOrEqual(0.05);
    }
  });
});
