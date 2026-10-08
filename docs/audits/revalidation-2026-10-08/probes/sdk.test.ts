// @vitest-environment jsdom
/**
 * Audit reproductions using the existing FOLLOW-1301 real-init fixture.
 * SDK scheduling/state/persistence are real; HTTP and extracted NLP dimensions are controlled.
 * A passing test asserts the defect, not desired post-fix behavior or live model quality.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { _initForTest } from '../../../../packages/sdk/src/index';

/**
 * One session id per test. `init()` registers its chat listener on `document` and teardown does
 * not remove it, so an earlier test's SDK instance still answers later chat events; its adapt
 * calls carry ITS session id and are filtered out of `sentHints` below.
 */
let sessionId = '';
let sessionSeq = 0;
const STAMP_1 = '2026-10-05T10:00:00.000000+00:00';
const STAMP_2 = '2026-10-05T10:05:00.000000+00:00';
/** Dimensions from the repository's FOLLOW-1301 fixture; no live NLP was invoked here. */
const YIELD_DIMS = {
  purchase_purpose: 'investment',
  finance_complexity: 'standard_mortgage',
  decision_role: 'decider',
  risk_appetite: 'balanced',
  tax_aware: 'true',
};

/** What the shadow key currently holds — the route returns it on EVERY call, like prod. */
let shadow: { dims: Record<string, string>; stamp: string } | null = null;
/** `archetype_hint` of every `/api/adapt` request, in order. */
let sentHints: string[] = [];
let sentConfidences: number[] = [];

function adaptResponse(): unknown {
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
  script.dataset.apiKey = 'test-follow1301-key';
  script.dataset.decisionUrl = 'https://decision.estalara.com/api';
  script.dataset.tenantId = 'follow1301-tenant-id';
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
  sentHints = [];
  sentConfidences = [];
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
          sentHints.push(body.archetype_hint ?? '<none>');
          sentConfidences.push(body.confidence ?? 0);
        }
        return Promise.resolve(okJson(adaptResponse()));
      }
      return Promise.resolve(okJson({}));
    }),
  );
});

afterEach(() => {
  const w = window as Window & { __estalaraTeardown?: () => void };
  if (w.__estalaraTeardown) {
    w.__estalaraTeardown();
    delete w.__estalaraTeardown;
  }
  clearAll();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Audit reproductions deliberately assert the defect.
it('F-04: second same-archetype chat leaves last transmitted confidence below the gate', async () => {
  await boot();
  shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
  sendChat('investment message one');
  await vi.advanceTimersByTimeAsync(40000);
  expect(sentHints).toEqual(['neutral', 'neutral', 'yield_hunter']);
  shadow = { dims: YIELD_DIMS, stamp: STAMP_2 };
  sendChat('investment message two');
  // Inspect immediately after the 2.5s chat refresh, before later behavioral timers.
  await vi.advanceTimersByTimeAsync(3000);
  expect(sentHints).toEqual(['neutral', 'neutral', 'yield_hunter', 'yield_hunter']);
  expect(sentConfidences.at(-1)).toBeLessThan(0.6);
  const stored = Object.keys(sessionStorage)
    .map((k) => sessionStorage.getItem(k))
    .filter(Boolean)
    .join(' ');
  expect(stored).toContain(STAMP_2);
  const local = JSON.parse(sessionStorage.getItem(`estalara_intent_${sessionId}`) ?? '{}');
  // This exact repeated-dimensions fixture does NOT cross the server gate.
  // The original report's 0.664 value was not reproduced with these inputs.
  expect(local.state.confidence).toBeCloseTo(0.48404744074873984, 8);
  expect(local.state.confidence).toBeGreaterThan(sentConfidences.at(-1)!);
  console.log('persisted confidence after second chat', local.state.confidence);
  console.log('same-archetype requests', sentHints, 'confidences', sentConfidences);
});
it('F-04: a second extraction specifying an investment vehicle crosses the gate locally but is not sent', async () => {
  await boot();
  shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
  sendChat('I am interested in investment rental yield and taxes.');
  await vi.advanceTimersByTimeAsync(40000);
  const before = sentHints.length;
  shadow = {
    dims: { ...YIELD_DIMS, finance_complexity: 'investment_vehicle' },
    stamp: STAMP_2,
  };
  sendChat('I will use an investment vehicle for this rental investment.');
  await vi.advanceTimersByTimeAsync(3000);
  const local = JSON.parse(sessionStorage.getItem(`estalara_intent_${sessionId}`) ?? '{}');
  expect(local.state.archetype).toBe('yield_hunter');
  expect(local.state.confidence).toBeGreaterThan(0.6);
  expect(sentConfidences.at(-1)).toBeLessThan(0.6);
  expect(sentHints.length).toBe(before + 1);
  expect(local.state.chatPriorAppliedAt).toBe(STAMP_2);
  console.log(
    'investment-vehicle second extraction',
    local.state.confidence,
    'last request',
    sentConfidences.at(-1),
  );
});
it('F-24: host chat recreates requests after teardown', async () => {
  await boot();
  (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown?.();
  const before = sentHints.length;
  shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
  sendChat('after teardown');
  await vi.advanceTimersByTimeAsync(5200);
  expect(sentHints.length).toBeGreaterThan(before);
});
