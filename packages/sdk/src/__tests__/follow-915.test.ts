// @vitest-environment jsdom
/**
 * FOLLOW-915 / ADR-0021 — the consent-banner text is fetched, not bundled.
 *
 * ESC-051 ruled the copy out of the SDK bundle. The CEO's own framing named the constraint
 * that makes it non-trivial: *"the notice must render before any profiling begins, so 'lazy'
 * cannot mean 'after the first event'."* A design that shaves bytes by letting one event fire
 * pre-notice trades a budget problem for a compliance one.
 *
 * These tests drive the REAL `init()` via `_initForTest()` (Rule Q — never re-implement the
 * entrypoint's body), so dropping the `await` in front of `fetchConsentText()` turns them RED.
 *
 * AC(1) — the invariant, stated by ADR-0021 §D2: no event is pushed, no storage key is
 * written, and no tenant-identified request is issued until the banner — rendered from
 * successfully fetched and validated text — has received the visitor's decision.
 *
 * AC(2) / §D4 — the failure mode is fail-closed and is tested, not asserted: every way the
 * fetch can fail produces no banner, no events, no storage writes, and leaves consent
 * `pending` so the next page load retries. **No fallback text ships in the bundle.**
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CONSENT_TEXT_URL } from '@estalara/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest } from '../index.js';

// jsdom does not give `import.meta.url` a file: scheme, so the served artefact is
// resolved from the package root (vitest's cwd) instead.
const SERVED_CONSENT_TEXT_PATH = resolve(
  process.cwd(),
  '../../apps/control-plane/public/consent-text.json',
);

const CONSENT_TEXT_DOC: unknown = JSON.parse(readFileSync(SERVED_CONSENT_TEXT_PATH, 'utf8'));

const CONSENT_KEY = 'estalara_consent';

function insertScriptTag(): void {
  const script = document.createElement('script');
  script.dataset.apiKey = 'test-key-follow915';
  document.head.appendChild(script);
}

function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  document.querySelectorAll<HTMLScriptElement>('script[data-api-key]').forEach((el) => {
    el.remove();
  });
  document.querySelectorAll('[data-estalara-host]').forEach((el) => {
    el.remove();
  });
}

/** Every URL passed to `fetch`, in call order. */
let calls: { url: string; init?: RequestInit }[] = [];

/**
 * @param consentText - what the consent-text endpoint returns. Two string sentinels stand in for
 *   transport failures: `'reject'` is a network error, `'never'` a hang the 3000 ms budget must
 *   abort. `{ status }` yields a non-2xx. Anything else is served as the document body.
 */
function mockFetch(consentText: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (url === CONSENT_TEXT_URL) {
        if (consentText === 'reject') return Promise.reject(new Error('network down'));
        if (consentText === 'never') {
          // Honour the AbortSignal so the §D4 timeout is exercised for real.
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('AbortError'));
            });
          });
        }
        if (
          typeof consentText === 'object' &&
          consentText !== null &&
          'status' in consentText &&
          typeof (consentText as { status: number }).status === 'number'
        ) {
          const { status } = consentText as { status: number };
          return Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(consentText) });
      }
      // Anything else (quiz config, adapt, ingest) — neutral, and a call we assert never happens
      // before the consent decision.
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }),
  );
}

const bannerInDom = (): boolean =>
  Array.from(document.querySelectorAll('[data-estalara-host]')).some(
    (host) => host.shadowRoot?.querySelector('.estalara-consent-banner') !== null,
  );

beforeEach(() => {
  calls = [];
  clearAll();
  insertScriptTag();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearAll();
});

describe('AC(1) — the consent-text fetch is ordered ahead of everything that could profile', () => {
  it('issues the §D3 request FIRST, before any other network call', async () => {
    mockFetch(CONSENT_TEXT_DOC);
    void _initForTest();
    await vi.waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });
    expect(calls[0]!.url).toBe(CONSENT_TEXT_URL);
  });

  it('renders the banner only AFTER the fetch resolved, from the fetched text', async () => {
    mockFetch(CONSENT_TEXT_DOC);
    expect(bannerInDom()).toBe(false);
    void _initForTest();
    await vi.waitFor(() => {
      expect(bannerInDom()).toBe(true);
    });
    const banner = Array.from(document.querySelectorAll('[data-estalara-host]'))
      .map((h) => h.shadowRoot?.querySelector('.estalara-consent-banner'))
      .find((b) => b != null);
    const en = (CONSENT_TEXT_DOC as { locales: Record<string, { text: string }> }).locales.en!;
    expect(banner!.textContent).toContain(en.text);
  });

  it('the §D3 request shape is identifier-free: exact URL, no query, no credentials, no auth', async () => {
    mockFetch(CONSENT_TEXT_DOC);
    void _initForTest();
    await vi.waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });
    const [{ url, init }] = calls as [{ url: string; init?: RequestInit }];
    expect(url).toBe(CONSENT_TEXT_URL);
    expect(url).not.toContain('?');
    expect(init?.credentials).toBe('omit');
    expect(init?.headers).toBeUndefined();
  });

  it('writes NO storage key and dispatches NO event while the banner awaits a decision', async () => {
    mockFetch(CONSENT_TEXT_DOC);
    void _initForTest();
    await vi.waitFor(() => {
      expect(bannerInDom()).toBe(true);
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(calls.map((c) => c.url)).toEqual([CONSENT_TEXT_URL]);
  });
});

describe('AC(2) / §D4 — every failure mode fails CLOSED, with no fallback text', () => {
  const expectFailedClosed = async (): Promise<void> => {
    const result = await _initForTest();
    expect(result).toBeNull();
    expect(bannerInDom()).toBe(false);
    // consent is NOT recorded as denied — the next page load retries.
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    // Nothing beyond the consent-text attempt itself was ever requested.
    expect(calls.map((c) => c.url)).toEqual([CONSENT_TEXT_URL]);
  };

  it('network error', async () => {
    mockFetch('reject');
    await expectFailedClosed();
  });

  it('non-2xx response', async () => {
    mockFetch({ status: 503 });
    await expectFailedClosed();
  });

  it('a document that fails schema validation', async () => {
    mockFetch({ schema_version: 1, text_version: 'x', locales: { en: { text: 'only this' } } });
    await expectFailedClosed();
  });

  it('a wrong schema_version', async () => {
    mockFetch({ ...(CONSENT_TEXT_DOC as object), schema_version: 99 });
    await expectFailedClosed();
  });

  it('a valid document that is missing the visitor locale', async () => {
    const { locales } = CONSENT_TEXT_DOC as { locales: Record<string, unknown> };
    const rest = { ...locales };
    delete rest.en;
    mockFetch({ ...(CONSENT_TEXT_DOC as object), locales: rest });
    await expectFailedClosed();
  });

  it('a hang, aborted at the 3000 ms budget', async () => {
    vi.useFakeTimers();
    mockFetch('never');
    const pending = _initForTest();
    await vi.advanceTimersByTimeAsync(3001);
    const result = await pending;
    expect(result).toBeNull();
    expect(bannerInDom()).toBe(false);
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();
  });
});

describe('§D2 — the granted and denied paths pay no extra request', () => {
  it('skips the consent-text fetch entirely when consent is already granted', async () => {
    localStorage.setItem(CONSENT_KEY, 'granted');
    mockFetch(CONSENT_TEXT_DOC);
    await _initForTest();
    expect(calls.map((c) => c.url)).not.toContain(CONSENT_TEXT_URL);
  });

  it('skips the consent-text fetch entirely when consent is already denied', async () => {
    localStorage.setItem(CONSENT_KEY, 'denied');
    mockFetch(CONSENT_TEXT_DOC);
    const result = await _initForTest();
    expect(result).toBeNull();
    expect(calls.map((c) => c.url)).not.toContain(CONSENT_TEXT_URL);
  });
});
