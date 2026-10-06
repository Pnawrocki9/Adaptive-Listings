// @vitest-environment jsdom
/**
 * FOLLOW-1301 — after a chat-intent fold moves the archetype, the SDK draws the next
 * `/api/adapt` call itself.
 *
 * The chat prior arrives on call N (`chat_intent_dimensions`) and is folded there, but the folded
 * archetype only reaches the server as `archetype_hint` on call N+1. Before this fix the
 * chat-refresh loop stopped on call N (its watermark moved), so a buyer who only chats never saw
 * the effect without a reload (FOLLOW-1299, follow-819 README §5.18).
 *
 * Rule Q: driven through the real `init()` body via `_initForTest()` and the real
 * `estalara:chat:message-sent` listener — the scheduling lives inside `init()`.
 *
 * @module packages/sdk/src/__tests__/follow-1301
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest } from '../index.js';

/**
 * One session id per test. `init()` registers its chat listener on `document` and teardown does
 * not remove it, so an earlier test's SDK instance still answers later chat events; its adapt
 * calls carry ITS session id and are filtered out of `sentHints` below.
 */
let sessionId = '';
let sessionSeq = 0;
const STAMP_1 = '2026-10-05T10:00:00.000000+00:00';
const STAMP_2 = '2026-10-05T10:05:00.000000+00:00';
/** The shim's extraction for the follow-819 chat arm's scripted rental-yield message. */
const YIELD_DIMS = {
  purchase_purpose: 'investment',
  finance_complexity: 'standard_mortgage',
  decision_role: 'decider',
  risk_appetite: 'balanced',
  tax_aware: 'true',
};
const RETIREE_DIMS = { purchase_purpose: 'retirement', family_stage: 'retiree' };
/** A stamped extraction whose dimensions match no likelihood: it folds, the hint does not move. */
const INERT_DIMS = { unknown_dimension: 'unknown_value' };

/** What the shadow key currently holds — the route returns it on EVERY call, like prod. */
let shadow: { dims: Record<string, string>; stamp: string } | null = null;
/** `archetype_hint` of every `/api/adapt` request, in order. */
let sentHints: string[] = [];

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

/** Flip the §H.9 opt-out toggle inside the SDK's open shadow root. */
function setPersonalization(enabled: boolean): void {
  const host = document.querySelector('[data-estalara-host]');
  const checkbox = host?.shadowRoot?.querySelector<HTMLInputElement>(
    '[data-estalara-toggle-checkbox]',
  );
  if (!checkbox) throw new Error('opt-out toggle not mounted — fixture is wrong, not the SDK');
  checkbox.checked = enabled;
  checkbox.dispatchEvent(new Event('change'));
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
          session_id?: string;
        };
        if (body.session_id === sessionId) sentHints.push(body.archetype_hint ?? '<none>');
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

describe('FOLLOW-1301 — the SDK draws the call that carries a folded chat hint', () => {
  it('a fold that moves the hint schedules exactly one more call, which sends it', async () => {
    await boot();
    expect(sentHints).toEqual(['neutral']);

    // The shim has processed the message by the time the debounced refresh fires.
    shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
    sendChat('What rental yield does this flat make, and how is the income taxed?');
    await vi.advanceTimersByTimeAsync(2_600);
    // Call N carried the dimensions; the hint it SENT is still the pre-fold one.
    expect(sentHints).toEqual(['neutral', 'neutral']);

    await vi.advanceTimersByTimeAsync(2_600);
    // Call N+1, drawn by the SDK itself, sends the folded archetype.
    expect(sentHints).toEqual(['neutral', 'neutral', 'yield_hunter']);

    // Call N+1 returned the SAME stamp: nothing folds, nothing is scheduled — no loop.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sentHints).toHaveLength(3);
  });

  it('a fold that leaves the hint where it was schedules nothing', async () => {
    await boot();
    shadow = { dims: INERT_DIMS, stamp: STAMP_1 };
    sendChat('hello there');
    await vi.advanceTimersByTimeAsync(2_600);
    await vi.advanceTimersByTimeAsync(60_000);
    // One chat-refresh call; it folded (watermark moved, so no retry) and did not move the hint.
    expect(sentHints).toEqual(['neutral', 'neutral']);
  });

  it('an opted-out session gets no follow-up, even when the fold moves the hint', async () => {
    await boot();
    shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
    sendChat('What rental yield does this flat make, and how is the income taxed?');
    // Opt out inside the debounce window: the already-scheduled chat refresh still fires.
    setPersonalization(false);
    await vi.advanceTimersByTimeAsync(2_600);
    const afterChatRefresh = sentHints.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sentHints).toHaveLength(afterChatRefresh);
    expect(sentHints).not.toContain('yield_hunter');
  });

  it('two signal-bearing messages draw two follow-ups, never more', async () => {
    await boot();

    shadow = { dims: YIELD_DIMS, stamp: STAMP_1 };
    sendChat('What rental yield does this flat make, and how is the income taxed?');
    await vi.advanceTimersByTimeAsync(2_600 + 2_600 + 30_000);
    expect(sentHints).toEqual(['neutral', 'neutral', 'yield_hunter']);

    shadow = { dims: RETIREE_DIMS, stamp: STAMP_2 };
    sendChat('Actually we are retiring here — is it quiet, and close to a clinic?');
    await vi.advanceTimersByTimeAsync(2_600);
    expect(sentHints).toHaveLength(4);
    expect(sentHints[3]).toBe('yield_hunter');

    await vi.advanceTimersByTimeAsync(2_600 + 60_000);
    expect(sentHints).toHaveLength(5);
    expect(sentHints[4]).not.toBe('yield_hunter');
  });
});
