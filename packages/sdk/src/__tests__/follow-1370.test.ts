/**
 * FOLLOW-1370 — the quiz card opens ONLY with the served definition, and only waits for it.
 *
 * Through the real `init()` (`_initForTest`):
 *   - the served config never arrives (no answer within 15 s, a fast failure, or a `fallback`
 *     body without a `quiz_definition`) → NO card on this pageview and no `POST /api/quiz/run`
 *     ping; the SDK has no built-in tree any more (CEO rulings: EN + PL with a buyer switch,
 *     accuracy measured only through the confirmation step);
 *   - a slow `/api/adapt` (a cold start) does not hold the card back: it opens as soon as the
 *     served config is in, before the first decision returns.
 *
 * @module packages/sdk/src/__tests__/follow-1370.test
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_QUIZ_DEFINITION_V2 } from '@estalara/shared';

import { _initForTest } from '../index.js';

const SESSION_ID = 'c'.repeat(64);
const HASH = 'd'.repeat(64);

const SERVED = {
  quiz_enabled: true,
  language: 'en',
  accent_color: '#6c5ce7',
  data_source: 'db',
  quiz_definition: DEFAULT_QUIZ_DEFINITION_V2,
  definition_hash: HASH,
  definition_version: null,
};

/** The control plane's `fallback` body: no tenant resolved, so no definition. */
const FALLBACK = {
  quiz_enabled: true,
  language: 'en',
  accent_color: '#2563EB',
  data_source: 'fallback',
};

interface MockOptions {
  /** The `/quiz/public-config` body (`null` = network failure). */
  config: object | null;
  /** Delay before the config answers (honours the abort signal). */
  configDelayMs?: number;
  /** Delay before `/api/adapt` answers. */
  adaptDelayMs?: number;
}

function mockFetch(o: MockOptions): ReturnType<typeof vi.fn> {
  const ok = (body: unknown): unknown => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
  const later = (ms: number, value: () => unknown, signal?: AbortSignal | null): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        const v = value();
        if (v === null) reject(new Error('network'));
        else resolve(v);
      }, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      });
    });
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/quiz/public-config')) {
      return later(o.configDelayMs ?? 0, () => (o.config ? ok(o.config) : null), init?.signal);
    }
    if (url.includes('/intent/config')) return Promise.resolve(ok(null));
    if (url.includes('/adapt/description')) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }
    if (url.includes('/adapt')) return later(o.adaptDelayMs ?? 0, () => ok({}));
    return Promise.resolve(ok({}));
  });
}

const callsTo = (f: ReturnType<typeof vi.fn>, path: string): number =>
  f.mock.calls.filter(([u]) => typeof u === 'string' && u.includes(path)).length;

function quizCard(): Element | null {
  let card: Element | null = null;
  document.querySelectorAll('[data-estalara-host]').forEach((host) => {
    card ??= host.shadowRoot?.querySelector('.estalara-quiz-card') ?? null;
  });
  return card;
}

/** Boot the real SDK (consent granted, seeded session); returns init's promise unawaited. */
function boot(f: ReturnType<typeof vi.fn>): Promise<unknown> {
  localStorage.setItem('estalara_consent', 'granted');
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
  const script = document.createElement('script');
  script.dataset.apiKey = 'test-follow1370-api-key';
  script.dataset.decisionUrl = 'https://api.example.com/api';
  script.dataset.tenantId = '550e8400-e29b-41d4-a716-446655440000';
  document.head.appendChild(script);
  vi.stubGlobal('fetch', f);
  return _initForTest();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  const w = window as Window & { __estalaraTeardown?: () => void };
  w.__estalaraTeardown?.();
  delete w.__estalaraTeardown;
  document.querySelectorAll('script[data-api-key], [data-estalara-host]').forEach((el) => {
    el.remove();
  });
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FOLLOW-1370 no served definition → no card', () => {
  it('no answer within 15 s → no card at all, no run ping, one request', async () => {
    const f = mockFetch({ config: SERVED, configDelayMs: 20_000 });
    await boot(f);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(quizCard()).toBeNull();
    expect(callsTo(f, '/quiz/run')).toBe(0);
    expect(callsTo(f, '/quiz/public-config')).toBe(1);
  });

  it('the request fails fast → no card, no run ping', async () => {
    const f = mockFetch({ config: null });
    await boot(f);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(quizCard()).toBeNull();
    expect(callsTo(f, '/quiz/run')).toBe(0);
  });

  it('a fallback body without a quiz_definition → no card, no run ping', async () => {
    const f = mockFetch({ config: FALLBACK });
    await boot(f);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(quizCard()).toBeNull();
    expect(callsTo(f, '/quiz/run')).toBe(0);
  });

  it('the served config fails late (after the 1 s budget) → still no card', async () => {
    const f = mockFetch({ config: null, configDelayMs: 5_000 });
    await boot(f);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(quizCard()).toBeNull();
    expect(callsTo(f, '/quiz/run')).toBe(0);
  });
});

describe('FOLLOW-1370 the card waits for the served config only, never for /api/adapt', () => {
  it('config in time, /api/adapt still pending → the card is already open', async () => {
    const f = mockFetch({ config: SERVED, adaptDelayMs: 20_000 });
    void boot(f);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(callsTo(f, '/adapt')).toBeGreaterThan(0);
    expect(quizCard()).not.toBeNull();
    // The served tree: its EN | PL switcher is on the card.
    expect(quizCard()?.querySelector('.estalara-quiz-lang')).not.toBeNull();
  });

  it('late config (3 s), /api/adapt pending for 20 s → the card opens at the config', async () => {
    const f = mockFetch({ config: SERVED, configDelayMs: 3_000, adaptDelayMs: 20_000 });
    void boot(f);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(quizCard()).toBeNull();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(quizCard()).not.toBeNull();
    expect(quizCard()?.querySelector('.estalara-quiz-lang')).not.toBeNull();
  });
});
