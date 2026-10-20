/**
 * FOLLOW-1365 — when the 1 s init config fetch fails, the quiz card waits for ONE late 8 s fetch
 * and renders the SERVED definition (switcher, confirm step, its hash on the run pings), through
 * the real `init()`. Both fail → the built-in; init fetch ok → no second fetch.
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

function runHashes(f: ReturnType<typeof vi.fn>): unknown[] {
  return f.mock.calls
    .filter(([u]) => typeof u === 'string' && u.includes('/quiz/run'))
    .map(
      ([, init]) =>
        (JSON.parse((init as RequestInit).body as string) as { definition_hash: unknown })
          .definition_hash,
    );
}

async function boot(f: ReturnType<typeof vi.fn>): Promise<ShadowRoot> {
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
  let root: ShadowRoot | null = null;
  await vi.waitFor(() => {
    document.querySelectorAll('[data-estalara-host]').forEach((host) => {
      if (host.shadowRoot?.querySelector('.estalara-quiz-card')) root = host.shadowRoot;
    });
    expect(root).not.toBeNull();
  });
  return root as unknown as ShadowRoot;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
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
  it('init fetch fails, late fetch succeeds → served definition, its hash on the run ping', async () => {
    const f = mockFetch([null, SERVED]);
    const root = await boot(f);
    expect(configCalls(f)).toBe(2);
    // The served v2 tree carries the EN | PL switcher; the built-in does not.
    expect(root.querySelector('.estalara-quiz-lang')).not.toBeNull();
    await vi.waitFor(() => {
      expect(runHashes(f)).toEqual([HASH]);
    });
  });

  it('both fetches fail → built-in definition, no switcher, exactly two attempts', async () => {
    const f = mockFetch([null]);
    const root = await boot(f);
    expect(configCalls(f)).toBe(2);
    expect(root.querySelector('.estalara-quiz-lang')).toBeNull();
    await vi.waitFor(() => {
      expect(runHashes(f)).toHaveLength(1);
    });
    expect(runHashes(f)).not.toContain(HASH);
  });

  it('init fetch succeeds → no second fetch', async () => {
    const f = mockFetch([SERVED]);
    const root = await boot(f);
    expect(configCalls(f)).toBe(1);
    expect(root.querySelector('.estalara-quiz-lang')).not.toBeNull();
  });
});
