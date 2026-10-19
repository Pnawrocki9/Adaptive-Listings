// @vitest-environment jsdom
/**
 * FOLLOW-1351 — one chat-refresh chain at a time.
 *
 * Defect (K3 forensic, AC(8) hop 11): a chat message that arrives while an earlier chat refresh is
 * still awaiting `/api/adapt` armed its own debounce timer; the earlier run then resumed and armed
 * its retry over the newer handle without clearing it. Both timers fired, so two refresh chains ran
 * in parallel: duplicate concurrent `/api/adapt` calls, and latest-wins discarded the fold of the
 * call that lost the race. Observed: the orphaned retry left at (earlier answer + 6000 ms).
 *
 * Contract asserted here: at most ONE chat-refresh timer armed, at most ONE chat-refresh `/adapt`
 * request in flight, and the call after the carrier of a new extraction is drawn only once that
 * carrier was answered and folded — so it sends the folded confidence.
 *
 * Rule Q: driven through the real `init()` via `_initForTest()` and the real
 * `estalara:chat:message-sent` listener. HTTP latency is simulated on the fake clock; the shadow
 * key the route returns is read when the request is made.
 *
 * @module packages/sdk/src/__tests__/follow-1351
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntentState } from '../core/intent.js';
import { _initForTest } from '../index.js';

/** The two chat-refresh delays of `adapt-loop.ts` (debounce, retry); no other SDK timer uses them. */
const CHAT_DELAYS = new Set([2_500, 6_000]);
const STAMP_1 = '2026-10-05T10:00:00.000000+00:00';
const STAMP_2 = '2026-10-05T10:05:00.000000+00:00';
/** The follow-819 chat arm's rental-yield extraction (same fixture as follow-1306 F-04). */
const YIELD_DIMS = {
  purchase_purpose: 'investment',
  finance_complexity: 'standard_mortgage',
  decision_role: 'decider',
  risk_appetite: 'balanced',
  tax_aware: 'true',
};
/** Message two: ONE dimension changes; the fold crosses the gate (0.36684 → 0.66415). */
const VEHICLE_DIMS = { ...YIELD_DIMS, finance_complexity: 'investment_vehicle' };
/** The fold of VEHICLE_DIMS over YIELD_DIMS — the value every green K2/K3 run measured. */
const FOLDED_CONFIDENCE = 0.6641488145588295;

interface AdaptCall {
  seq: number;
  hint: string;
  confidence: number;
  /** The stamp the route returned on this call (`null` = no extraction yet). */
  stamp: string | null;
  requestedAt: number;
  answeredAt: number | null;
}

let sessionId = '';
let sessionSeq = 0;
/** What the shadow key holds when a request is made. */
let shadow: { dims: Record<string, string>; stamp: string } | null = null;
/** `/api/adapt` latency on the fake clock; 0 = answered at once (used while booting). */
let latencyMs = 0;
/** Read the shadow key when the request is answered instead of when it is made. */
let shadowAtAnswer = false;
let calls: AdaptCall[] = [];
let inFlight = 0;
let maxInFlight = 0;
/** Chat-refresh timers currently armed (not yet fired, not cleared). */
let armed = new Set<unknown>();
let maxArmed = 0;

function adaptResponse(): Record<string, unknown> {
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
  script.dataset.apiKey = 'test-follow1351-key';
  script.dataset.decisionUrl = 'https://decision.estalara.com/api';
  script.dataset.tenantId = 'follow1351-tenant-id';
  document.head.appendChild(script);
}

function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  document.querySelectorAll('script[data-api-key], [data-estalara-host]').forEach((el) => {
    el.remove();
  });
}

function sendChat(message: string): void {
  document.dispatchEvent(
    new CustomEvent('estalara:chat:message-sent', { detail: { message, is_agent: false } }),
  );
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

/** Advance the fake clock in 50 ms steps until `done()` holds (fails after `maxMs`). */
async function advanceUntil(done: () => boolean, maxMs = 60_000): Promise<void> {
  for (let t = 0; t < maxMs && !done(); t += 50) {
    await vi.advanceTimersByTimeAsync(50);
  }
  if (!done()) throw new Error('advanceUntil: condition never held — fixture is wrong');
}

/**
 * Send a message the shim has no extraction for (the stamp never moves), and advance until its
 * chain's THIRD attempt is in flight. Returns that attempt.
 */
async function messageAtThirdAttempt(message: string): Promise<AdaptCall> {
  const base = calls.length;
  sendChat(message);
  await advanceUntil(() => calls.length === base + 3);
  const third = calls[base + 2]!;
  expect(third.answeredAt).toBeNull();
  return third;
}

beforeEach(() => {
  clearAll();
  shadow = null;
  latencyMs = 0;
  shadowAtAnswer = false;
  calls = [];
  inFlight = 0;
  maxInFlight = 0;
  armed = new Set();
  maxArmed = 0;
  sessionSeq += 1;
  sessionId = String(sessionSeq).repeat(64).slice(0, 64);
  vi.restoreAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

  // Track the chat-refresh timers on top of the fake clock.
  const fakeSetTimeout = globalThis.setTimeout;
  const fakeClearTimeout = globalThis.clearTimeout;
  vi.stubGlobal('setTimeout', (fn: () => void, ms?: number): unknown => {
    if (ms === undefined || !CHAT_DELAYS.has(ms)) return fakeSetTimeout(fn, ms);
    const handle = fakeSetTimeout(() => {
      armed.delete(handle);
      fn();
    }, ms);
    armed.add(handle);
    maxArmed = Math.max(maxArmed, armed.size);
    return handle;
  });
  vi.stubGlobal('clearTimeout', (handle: ReturnType<typeof setTimeout> | undefined): void => {
    armed.delete(handle);
    fakeClearTimeout(handle);
  });

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: { body?: string }) => {
      if (typeof url !== 'string' || !url.includes('/adapt') || url.includes('/description')) {
        return Promise.resolve(okJson({}));
      }
      const body = JSON.parse(init?.body ?? '{}') as {
        archetype_hint?: string;
        confidence?: number;
        session_id?: string;
      };
      const response = adaptResponse();
      if (body.session_id !== sessionId) return Promise.resolve(okJson(response));
      const call: AdaptCall = {
        seq: calls.length + 1,
        hint: body.archetype_hint ?? '<none>',
        confidence: body.confidence ?? 0,
        stamp: shadow?.stamp ?? null,
        requestedAt: Date.now(),
        answeredAt: null,
      };
      calls.push(call);
      if (latencyMs === 0) {
        call.answeredAt = call.requestedAt;
        return Promise.resolve(okJson(response));
      }
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) => {
        globalThis.setTimeout(() => {
          inFlight -= 1;
          call.answeredAt = Date.now();
          if (shadowAtAnswer) call.stamp = shadow?.stamp ?? null;
          resolve(okJson(shadowAtAnswer ? adaptResponse() : response));
        }, latencyMs);
      });
    }),
  );
});

afterEach(() => {
  teardown();
  clearAll();
  // Unstub first: unstubbing after useRealTimers would put the fake setTimeout back.
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('FOLLOW-1351 — a second message during the first chain', () => {
  it('(a) arriving during the third attempt leaves exactly one armed chat-refresh timer', async () => {
    await boot();
    latencyMs = 1_700;
    const third = await messageAtThirdAttempt('Is the neighbourhood quiet at night?');

    shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
    sendChat('What rental yield does this flat make, and how is the income taxed?');
    expect(armed.size).toBe(1);

    // The earlier chain's third attempt is answered after the newer message armed its timer.
    await advanceUntil(() => third.answeredAt !== null);
    expect(armed.size).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(maxArmed).toBe(1);
    expect(armed.size).toBe(0);
  });

  // Offset 0 with latency > 2500 ms: the newer debounce expires while the earlier call is in flight.
  it.each([
    [1_700, 0],
    [1_700, 1_400],
    [3_000, 0],
    [3_000, 2_700],
    [4_000, 0],
    [4_000, 3_700],
  ])(
    '(b) never two chat-refresh /adapt requests in flight (latency %i ms, message at +%i ms)',
    async (latency, offset) => {
      await boot();
      latencyMs = latency;
      const third = await messageAtThirdAttempt('Is the neighbourhood quiet at night?');

      // The newer message lands while the earlier chain's third attempt is still in flight.
      await vi.advanceTimersByTimeAsync(offset);
      expect(third.answeredAt).toBeNull();
      shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
      sendChat('What rental yield does this flat make, and how is the income taxed?');
      await vi.advanceTimersByTimeAsync(60_000);

      expect(maxInFlight).toBe(1);
      // Each request was issued only after the previous one was answered.
      for (let i = 1; i < calls.length; i += 1) {
        expect(calls[i]!.requestedAt).toBeGreaterThanOrEqual(calls[i - 1]!.answeredAt!);
      }
    },
  );

  it('(d) the orphaned retry at (earlier answer + 6000 ms) no longer fires', async () => {
    await boot();
    latencyMs = 1_700;
    const third = await messageAtThirdAttempt('Is the neighbourhood quiet at night?');

    shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
    const messageAt = Date.now();
    const before = calls.length;
    sendChat('What rental yield does this flat make, and how is the income taxed?');
    await vi.advanceTimersByTimeAsync(60_000);

    const orphanAt = third.answeredAt! + 6_000;
    expect(calls.some((c) => c.requestedAt === orphanAt)).toBe(false);
    // The newer message's chain only: its carrier after the debounce + ONE follow-up.
    const after = calls.slice(before);
    expect(after).toHaveLength(2);
    expect(after[0]!.requestedAt).toBe(messageAt + 2_500);
    expect(after[1]!.requestedAt).toBe(after[0]!.answeredAt! + 2_500);
  });

  it('a fold on the in-flight call while the newer run waits: that run sends it next', async () => {
    await boot();
    latencyMs = 4_000;
    const third = await messageAtThirdAttempt('Is the neighbourhood quiet at night?');
    // The newer debounce expires while the third attempt is in flight, so its run waits; the
    // extraction reaches the shim before that attempt is answered, so the attempt carries it.
    sendChat('What rental yield does this flat make, and how is the income taxed?');
    shadowAtAnswer = true;
    shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
    await vi.advanceTimersByTimeAsync(60_000);

    expect(third.stamp).toBe(STAMP_1);
    const folded = persisted()!;
    expect(folded.archetype).toBe('yield_hunter');
    const after = calls.slice(third.seq);
    // The waiting run goes out the moment the fold lands and sends it — no separate follow-up;
    // it keeps its own bounded retries while it waits for its message's evidence (FOLLOW-1026).
    expect(after[0]!.requestedAt).toBe(third.answeredAt);
    expect(after).toHaveLength(3);
    for (const c of after) {
      expect(c.hint).toBe('yield_hunter');
      expect(c.confidence).toBeCloseTo(folded.confidence, 12);
    }
    expect(maxInFlight).toBe(1);
    expect(maxArmed).toBe(1);
  });

  it('teardown with a chat refresh in flight draws no further request', async () => {
    await boot();
    latencyMs = 1_700;
    const base = calls.length;
    sendChat('Is the neighbourhood quiet at night?');
    await advanceUntil(() => calls.length === base + 1);
    teardown();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(base + 1);
    expect(armed.size).toBe(0);
  });
});

describe('FOLLOW-1351 — (c) the follow-up is drawn after the carrier fold', () => {
  it.each([
    [1_700, 1_400],
    [4_000, 0],
    [4_000, 3_700],
  ])(
    'the call after the carrier sends the folded confidence (latency %i ms, message at +%i ms)',
    async (latency, offset) => {
      await boot();
      // Message one folds to yield_hunter ~0.367 and gets its follow-up (FOLLOW-1301).
      shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
      sendChat('I am interested in investment rental yield and taxes.');
      await vi.advanceTimersByTimeAsync(40_000);
      expect(persisted()?.chatPriorAppliedAt).toBe(STAMP_1);
      expect(persisted()?.confidence).toBeLessThan(0.6);

      // A message with no new extraction runs its chain to the third attempt (the route keeps
      // returning STAMP_1: nothing folds, the watermark does not move).
      latencyMs = latency;
      const third = await messageAtThirdAttempt('Is the neighbourhood quiet at night?');
      await vi.advanceTimersByTimeAsync(offset);
      expect(third.answeredAt).toBeNull();

      // The second consistent message lands; from now on the route returns its extraction.
      shadow = { dims: VEHICLE_DIMS, stamp: STAMP_2 };
      sendChat('I will use an investment vehicle for this rental investment.');
      await vi.advanceTimersByTimeAsync(60_000);

      const state = persisted();
      expect(state?.chatPriorAppliedAt).toBe(STAMP_2);
      expect(state?.confidence).toBeCloseTo(FOLDED_CONFIDENCE, 12);

      // The harness predicate (AC(8) hop 11): the first call by seq after the carrier.
      const carrier = calls.find((c) => c.stamp === STAMP_2)!;
      const next = calls.find((c) => c.seq > carrier.seq)!;
      expect(next.requestedAt).toBeGreaterThanOrEqual(carrier.answeredAt!);
      expect(next.hint).toBe('yield_hunter');
      expect(next.confidence).toBeCloseTo(FOLDED_CONFIDENCE, 12);
      // Carrier + one follow-up; nothing after.
      expect(calls.at(-1)).toBe(next);
    },
  );
});
