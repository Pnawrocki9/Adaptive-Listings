/**
 * FOLLOW-1365 / FOLLOW-1369 — ONE quiz-config request (15 s from boot) is raced against the 1 s
 * init budget. Answered in time → merged at init; slower → the same promise is awaited by the quiz
 * card, which renders the SERVED definition (switcher, confirm step, its hash on the run pings),
 * through the real `init()`. Always exactly one request. Never answered → no card at all
 * (FOLLOW-1370, `follow-1370.test.ts`; the built-in tree is gone).
 *
 * @module packages/sdk/src/__tests__/follow-1365.test
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_QUIZ_DEFINITION_V2 } from '@estalara/shared';

import { _initForTest } from '../index.js';

const SESSION_ID = 'b'.repeat(64);
const HASH = 'e'.repeat(64);

const SERVED = {
  quiz_enabled: true,
  language: 'en',
  accent_color: '#6c5ce7',
  data_source: 'db',
  quiz_definition: DEFAULT_QUIZ_DEFINITION_V2,
  definition_hash: HASH,
  definition_version: null,
};

/** `configResults[i]` answers the i-th `/quiz/public-config` call: a body, or null = failure. */
function mockFetch(configResults: (object | null)[]): ReturnType<typeof vi.fn> {
  let n = 0;
  return vi.fn().mockImplementation((url: string) => {
    const json = (body: unknown): Promise<unknown> =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (url.includes('/quiz/public-config')) {
      const r = configResults[Math.min(n, configResults.length - 1)];
      n += 1;
      return r ? json(r) : Promise.reject(new Error('timeout'));
    }
    if (url.includes('/intent/config')) return json(null);
    if (url.includes('/adapt/description')) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }
    return json({});
  });
}

const configCalls = (f: ReturnType<typeof vi.fn>): number =>
  f.mock.calls.filter(([u]) => typeof u === 'string' && u.includes('/quiz/public-config')).length;

/** One `/quiz/public-config` call that answers after `delayMs` (honours the abort signal). */
function mockSlowFetch(delayMs: number): ReturnType<typeof vi.fn> {
  const base = mockFetch([SERVED]);
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (!url.includes('/quiz/public-config')) return base(url, init) as Promise<unknown>;
    base(url, init);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        resolve({ ok: true, status: 200, json: () => Promise.resolve(SERVED) });
      }, delayMs);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      });
    });
  });
}

function runHashes(f: ReturnType<typeof vi.fn>): unknown[] {
  return f.mock.calls
    .filter(([u]) => typeof u === 'string' && u.includes('/quiz/run'))
    .map(
      ([, init]) =>
        (JSON.parse((init as RequestInit).body as string) as { definition_hash: unknown })
          .definition_hash,
    );
}

async function boot(f: ReturnType<typeof vi.fn>, advanceMs = 0): Promise<ShadowRoot> {
  localStorage.setItem('estalara_consent', 'granted');
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
  const script = document.createElement('script');
  script.dataset.apiKey = 'test-follow1365-api-key';
  script.dataset.decisionUrl = 'https://api.example.com/api';
  script.dataset.tenantId = '550e8400-e29b-41d4-a716-446655440000';
  document.head.appendChild(script);
  vi.stubGlobal('fetch', f);
  await _initForTest();
  if (advanceMs > 0) await vi.advanceTimersByTimeAsync(advanceMs);
  let root: ShadowRoot | null = null;
  await vi.waitFor(
    () => {
      document.querySelectorAll('[data-estalara-host]').forEach((host) => {
        if (host.shadowRoot?.querySelector('.estalara-quiz-card')) root = host.shadowRoot;
      });
      expect(root).not.toBeNull();
    },
    { timeout: 5_000 },
  );
  return root as unknown as ShadowRoot;
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

describe('FOLLOW-1365 late quiz config', () => {
  it('response after 1 s but within budget → ONE call, served definition, its hash on the ping', async () => {
    const f = mockSlowFetch(9_000);
    const root = await boot(f, 9_000);
    expect(configCalls(f)).toBe(1);
    expect(root.querySelector('.estalara-quiz-lang')).not.toBeNull();
    await vi.waitFor(() => {
      expect(runHashes(f)).toEqual([HASH]);
    });
    expect(configCalls(f)).toBe(1);
  });

  it('response within 1 s → one call, merged at init (no late wait)', async () => {
    const f = mockFetch([SERVED]);
    const root = await boot(f);
    expect(configCalls(f)).toBe(1);
    expect(root.querySelector('.estalara-quiz-lang')).not.toBeNull();
  });
});
