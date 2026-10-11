// @vitest-environment jsdom
/**
 * FOLLOW-1306 (Codex WP02) — SDK intent state and lifecycle.
 *
 * One red-before/green-after test per defect reproduced by the 2026-10-08 Codex revalidation
 * (`docs/audits/revalidation-2026-10-08/probes/sdk.test.ts` + `boundaries.test.ts` assert the
 * DEFECTS; the tests below assert the product contract instead):
 *
 *   F-05  state transforms keep the chat-prior stamp and the dwell tick counter (Rule R).
 *   F-25  a reply that loses the latest-wins check commits nothing (storage, fold key).
 *   F-12  opting out invalidates a personalised reply still in flight.
 *   F-24  teardown detaches the host listeners; a re-init answers each host event once.
 *   F-04  a fold that moves the confidence across the server gate (same archetype) draws
 *         exactly one follow-up; a fold that stays below it draws none.
 *
 * Rule Q: everything but F-05 is driven through the real `init()` via `_initForTest()` and the
 * real host events. HTTP and the NLP extraction are controlled (the shadow key the route returns).
 *
 * @module packages/sdk/src/__tests__/follow-1306
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyBehavioralSignal,
  applyChatIntentPrior,
  applyDwellSignal,
  applyListingViewRate,
  applyQuizLeaf,
  applyReferrerHints,
  initIntentState,
  type IntentState,
} from '../core/intent.js';
import { persistIntentState } from '../core/session.js';
import { _initForTest } from '../index.js';

let sessionId = '';
let sessionSeq = 0;
const STAMP_1 = '2026-10-05T10:00:00.000000+00:00';
const STAMP_2 = '2026-10-05T10:05:00.000000+00:00';
/** The follow-819 chat arm's rental-yield extraction (README §5.18; Codex F-04 fixture). */
const YIELD_DIMS = {
  purchase_purpose: 'investment',
  finance_complexity: 'standard_mortgage',
  decision_role: 'decider',
  risk_appetite: 'balanced',
  tax_aware: 'true',
};
/** Message two of the F-04 fixture: ONE dimension changes, the archetype does not. */
const VEHICLE_DIMS = { ...YIELD_DIMS, finance_complexity: 'investment_vehicle' };
const ORIGINAL_HEADLINE = 'Charming 4-Bedroom Colonial on Blackberry Lane';
const ADAPTED_HEADLINE = 'Strong Rental Demand — Turnkey Investment';

/** What the shadow key currently holds — the route returns it on EVERY call, like prod. */
let shadow: { dims: Record<string, string>; stamp: string } | null = null;
/** Per `/api/adapt` request of THIS test's session, in order. */
let sent: { hint: string; confidence: number }[] = [];
/** Bodies of every non-adapt request (ingest batches). */
let ingestBodies: string[] = [];
/** When set, the next adapt request is held; resolve it with `release(body)`. */
let holdNext = false;
let release: ((body: unknown) => void) | null = null;

function adaptResponse(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    adapt_decision_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    session_id: sessionId,
    archetype: 'neutral',
    confidence: 0.3,
    similarity: 0.3,
    tier: 1,
    source: 'default',
    generated_at: '2026-10-05T00:00:00.000Z',
    directives: [],
    variant: 'control',
    ...(shadow
      ? { chat_intent_dimensions: shadow.dims, chat_intent_detected_at: shadow.stamp }
      : {}),
    ...over,
  };
}

function okJson(body: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId, startedAt: Date.now(), pageCount: 1 }),
  );
}

function insertScriptTag(): void {
  const script = document.createElement('script');
  script.dataset.apiKey = 'test-follow1306-key';
  script.dataset.decisionUrl = 'https://decision.estalara.com/api';
  script.dataset.tenantId = 'follow1306-tenant-id';
  document.head.appendChild(script);
}

function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  document
    .querySelectorAll(
      'script[data-api-key], [data-estalara-host], [data-estalara-listing], [data-estalara-slot]',
    )
    .forEach((el) => {
      el.remove();
    });
}

function sendChat(message: string): void {
  document.dispatchEvent(
    new CustomEvent('estalara:chat:message-sent', { detail: { message, is_agent: false } }),
  );
}

function setPersonalization(enabled: boolean): void {
  const host = document.querySelector('[data-estalara-host]');
  const checkbox = host?.shadowRoot?.querySelector<HTMLInputElement>(
    '[data-estalara-toggle-checkbox]',
  );
  if (!checkbox) throw new Error('opt-out toggle not mounted — fixture is wrong, not the SDK');
  checkbox.checked = enabled;
  checkbox.dispatchEvent(new Event('change'));
}

function persisted(): IntentState | null {
  const raw = sessionStorage.getItem(`estalara_intent_${sessionId}`);
  return raw ? (JSON.parse(raw) as { state: IntentState }).state : null;
}

function teardown(): void {
  const w = window as Window & { __estalaraTeardown?: () => void };
  w.__estalaraTeardown?.();
  delete w.__estalaraTeardown;
}

class MockIntersectionObserver {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

async function boot(): Promise<void> {
  seedSession();
  localStorage.setItem('estalara_consent', 'granted');
  insertScriptTag();
  await _initForTest();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  clearAll();
  shadow = null;
  sent = [];
  ingestBodies = [];
  holdNext = false;
  release = null;
  sessionSeq += 1;
  sessionId = String(sessionSeq).repeat(64).slice(0, 64);
  vi.restoreAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: { body?: string }) => {
      if (typeof url === 'string' && url.includes('/adapt') && !url.includes('/description')) {
        const body = JSON.parse(init?.body ?? '{}') as {
          archetype_hint?: string;
          confidence?: number;
          session_id?: string;
        };
        if (body.session_id === sessionId) {
          sent.push({ hint: body.archetype_hint ?? '<none>', confidence: body.confidence ?? 0 });
        }
        if (holdNext) {
          holdNext = false;
          return new Promise((resolve) => {
            release = (b: unknown) => {
              resolve(okJson(b));
            };
          });
        }
        return Promise.resolve(okJson(adaptResponse()));
      }
      ingestBodies.push(init?.body ?? '');
      return Promise.resolve(okJson({}));
    }),
  );
});

afterEach(() => {
  teardown();
  clearAll();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('F-05 — state transforms keep the Rule R bookkeeping', () => {
  const marked: IntentState = {
    ...applyChatIntentPrior(initIntentState(), YIELD_DIMS),
    chatPriorApplied: true,
    chatPriorAppliedAt: STAMP_1,
    dwell_ticks_applied: 3,
  };

  const transforms: [string, IntentState][] = [
    ['scroll.depth', applyBehavioralSignal(marked, 'scroll.depth', { depth_pct: 75 })],
    ['listing.bookmarked', applyBehavioralSignal(marked, 'listing.bookmarked', {})],
    [
      'micro_poll.answered',
      applyBehavioralSignal(marked, 'micro_poll.answered', {
        question: 'purpose_investment',
        answer: 'yes',
      }),
    ],
    ['feature.expanded', applyBehavioralSignal(marked, 'feature.expanded', { feature: 'yield' })],
    ['filter.applied', applyBehavioralSignal(marked, 'filter.applied', { facet: 'commercial' })],
    ['quiz leaf', applyQuizLeaf(marked, 'family_buyer')],
    ['referrer', applyReferrerHints(marked, 'https://example.com/investment', '')],
    ['listing-view rate', applyListingViewRate(marked, 6, 60_000)],
  ];

  it.each(transforms)('%s keeps the chat stamp, the chat flag and the dwell ticks', (_n, next) => {
    expect(next).not.toBe(marked); // the transform really rebuilt the state
    expect(next.chatPriorAppliedAt).toBe(STAMP_1);
    expect(next.chatPriorApplied).toBe(true);
    expect(next.dwell_ticks_applied).toBe(3);
  });

  it('dwell keeps the chat stamp and advances its own counter', () => {
    const next = applyDwellSignal(marked, 90_000);
    expect(next).not.toBe(marked);
    expect(next.chatPriorAppliedAt).toBe(STAMP_1);
    expect(next.dwell_ticks_applied).toBe(4);
  });

  it('a quiz leaf after a chat fold does not reopen that fold through the real init', async () => {
    // The persisted state a buyer has after chat fold + quiz leaf: the fold must stay counted.
    persistIntentState(sessionId, applyQuizLeaf(marked, 'yield_hunter'));
    shadow = { dims: YIELD_DIMS, stamp: STAMP_1 }; // the route returns the same record again
    await boot();
    const state = persisted();
    expect(state?.chatPriorAppliedAt).toBe(STAMP_1);
    expect(state?.probabilities.yield_hunter).toBeCloseTo(0.85, 10); // not re-folded
  });
});

describe('F-25 — a reply that loses the latest-wins check commits nothing', () => {
  it('a stale reply carrying a fold neither persists it nor blocks the accepted fold', async () => {
    await boot();

    // Refresh A (chat) goes out and is held.
    holdNext = true;
    sendChat('What rental yield does this flat make?');
    await vi.advanceTimersByTimeAsync(2_600);
    expect(release).not.toBeNull();
    const releaseA = release!;

    // Refresh B (five bookmarks cross one REFETCH interval) supersedes it and returns first.
    for (let i = 0; i < 5; i += 1) {
      window.dispatchEvent(new CustomEvent('estalara:listing:favorited', { detail: {} }));
    }
    await vi.advanceTimersByTimeAsync(0);

    // A arrives late, carrying the extraction.
    shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
    releaseA(adaptResponse());
    await vi.advanceTimersByTimeAsync(0);

    expect(persisted()?.chatPriorAppliedAt).toBeUndefined();

    // The next accepted reply returns the same record and DOES fold it.
    sendChat('And how is the income taxed?');
    await vi.advanceTimersByTimeAsync(2_600);
    expect(persisted()?.chatPriorAppliedAt).toBe(STAMP_1);
  });

  it('an accepted chat/quiz mismatch is queued for ingest exactly once', async () => {
    // A quiz answer (family_buyer) the buyer's behaviour has already eroded: one confident chat
    // fold flips it, which is what `chat_mismatch` records (conf > 0.7, gap > threshold).
    const quiz = applyQuizLeaf(initIntentState(), 'family_buyer');
    const names = Object.keys(quiz.probabilities) as (keyof IntentState['probabilities'])[];
    const eroded = Object.fromEntries(
      names.map((k) => [
        k,
        k === 'yield_hunter' ? 0.45 : k === 'family_buyer' ? 0.4 : 0.15 / (names.length - 2),
      ]),
    ) as IntentState['probabilities'];
    persistIntentState(sessionId, { ...quiz, probabilities: eroded });
    await boot();
    shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
    sendChat('What rental yield does this flat make, and how is the income taxed?');
    await vi.advanceTimersByTimeAsync(2_600 + 2_600 + 1_000);
    expect(persisted()?.chat_mismatch).toEqual({
      quiz_archetype: 'family_buyer',
      chat_archetype: 'yield_hunter',
    });
    const mismatches = ingestBodies.join('\n').match(/"quiz\.mismatch"/g) ?? [];
    expect(mismatches).toHaveLength(1);
  });
});

describe('F-12 — opting out cancels a personalised reply still in flight', () => {
  it('a reply that arrives after opt-out does not repaint the page', async () => {
    const listing = document.createElement('div');
    listing.setAttribute('data-estalara-listing', '');
    listing.setAttribute('data-estalara-listing-id', 'L-1306');
    document.body.appendChild(listing);
    const headline = document.createElement('h2');
    headline.setAttribute('data-estalara-slot', 'headline');
    headline.textContent = ORIGINAL_HEADLINE;
    document.body.appendChild(headline);

    await boot();
    holdNext = true;
    sendChat('What rental yield does this flat make?');
    await vi.advanceTimersByTimeAsync(2_600);
    expect(release).not.toBeNull();

    setPersonalization(false);
    release!(
      adaptResponse({
        archetype: 'yield_hunter',
        confidence: 0.85,
        source: 'playbook',
        directives: [
          {
            type: 'text',
            slot: 'headline',
            value: ADAPTED_HEADLINE,
            archetype: 'yield_hunter',
            confidence: 0.85,
          },
        ],
      }),
    );
    await vi.advanceTimersByTimeAsync(100);

    expect(headline.textContent).toBe(ORIGINAL_HEADLINE);
  });
});

describe('F-24 — teardown detaches the host listeners', () => {
  it('a chat message after teardown issues no request', async () => {
    await boot();
    teardown();
    const before = sent.length;
    shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
    sendChat('after teardown');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(before);
  });

  it('after teardown and re-init, one chat message draws exactly one refresh', async () => {
    await boot();
    teardown();
    await boot(); // same session, new instance
    const before = sent.length;
    sendChat('hello again'); // no shadow record: no fold, no follow-up
    await vi.advanceTimersByTimeAsync(2_600);
    expect(sent).toHaveLength(before + 1);
  });
});

describe('F-04 — a fold that crosses the server gate draws one follow-up', () => {
  /** Message one: folds to yield_hunter at ~0.367 and gets its FOLLOW-1301 follow-up. */
  async function firstMessage(): Promise<void> {
    await boot();
    shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
    sendChat('I am interested in investment rental yield and taxes.');
    await vi.advanceTimersByTimeAsync(40_000);
    expect(sent.map((s) => s.hint)).toEqual(['neutral', 'neutral', 'yield_hunter']);
    expect(sent.at(-1)!.confidence).toBeLessThan(0.6);
  }

  it('changed dimension: same archetype, 0.367 → 0.664, exactly one call sends it', async () => {
    await firstMessage();
    const before = sent.length;
    shadow = { dims: VEHICLE_DIMS, stamp: STAMP_2 };
    sendChat('I will use an investment vehicle for this rental investment.');
    await vi.advanceTimersByTimeAsync(2_600 + 2_600 + 60_000);

    const state = persisted();
    expect(state?.archetype).toBe('yield_hunter');
    expect(state?.chatPriorAppliedAt).toBe(STAMP_2);
    expect(state?.confidence).toBeGreaterThan(0.6);
    // The chat refresh (pre-fold confidence) + ONE follow-up carrying the crossed confidence.
    expect(sent).toHaveLength(before + 2);
    expect(sent.at(-1)!.hint).toBe('yield_hunter');
    expect(sent.at(-1)!.confidence).toBeCloseTo(state!.confidence, 10);
  });

  it('identical extraction: 0.367 → 0.484 stays below the gate, no follow-up', async () => {
    await firstMessage();
    const before = sent.length;
    shadow = { dims: YIELD_DIMS, stamp: STAMP_2 };
    sendChat('investment message two');
    await vi.advanceTimersByTimeAsync(2_600 + 2_600 + 60_000);

    const state = persisted();
    expect(state?.chatPriorAppliedAt).toBe(STAMP_2);
    expect(state?.confidence).toBeCloseTo(0.48404744074873984, 8);
    // Only the chat refresh that carried the extraction.
    expect(sent).toHaveLength(before + 1);
  });
});
