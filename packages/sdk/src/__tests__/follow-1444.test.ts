/**
 * FOLLOW-1444 (FOLLOW-1316 signed review P-2, ESC-092 C-b), through the REAL `init()`
 * (`_initForTest`, Rule Q):
 *
 * 1. The withdrawal control renders with the flag off, and when the flag is never set.
 * 2. It explains itself in one sentence, `withdrawWhy` from the served `consent-text.json`.
 * 3. After the click it confirms the result (`withdrawDone`) or reports a failed delete
 *    (`withdrawFail`), in a `role="status"` container.
 * 4. If the consent text cannot be fetched, the button keeps its in-bundle label and still
 *    withdraws; the result falls back to the in-bundle state text.
 * 5. The granted-path fetch is the same §D3 identifier-free GET (ADR-0021 amendment 2026-11-06),
 *    and nothing new is sent before a grant.
 *
 * The consent-text stub serves the REAL `apps/control-plane/public/consent-text.json`, so these
 * tests also prove the served file carries the three sentences in every locale. Every request is
 * captured at `fetch` and `sendBeacon`.
 *
 * @module packages/sdk/src/__tests__/follow-1444.test
 */

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONSENT_TEXT_URL,
  ConsentTextDocumentSchema,
  type ConsentTextLocale,
} from '@estalara/shared';

import { _initForTest } from '../index.js';
import { eraseCrossSessionId } from '../core/xid.js';

const SESSION_ID = 'd'.repeat(64);
const API_KEY = 'test-follow1444-api-key';
const DECISION_API_URL = 'https://api.example.com/api';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const XID = '3f2b8c1e-9a4d-4e6f-8b1a-7c5d2e9f0a11';
const CONSENT_KEY = 'estalara_consent';
const TEXT_VERSION_KEY = 'estalara_consent_text_version';
const XID_KEY = '__estalara_xid__';

const SERVED = ConsentTextDocumentSchema.parse(
  JSON.parse(
    readFileSync(
      join(__dirname, '../../../../apps/control-plane/public/consent-text.json'),
      'utf8',
    ),
  ),
);

type Language = 'en' | 'pl' | 'es';

/** One locale of the served document. */
function served(language: Language): ConsentTextLocale {
  const copy = SERVED.locales[language];
  if (!copy) throw new Error(`served consent text lacks ${language}`);
  return copy;
}

interface Options {
  /** `buyer_profile_enabled` in the public config; `undefined` leaves the field out. */
  flag?: boolean | undefined;
  /** The `/profile/erase` status, or `'network'` for a rejected fetch. */
  eraseStatus?: number | 'network';
  /** How the consent-text GET answers. */
  consentText?: 'served' | 'network' | 500 | 'hang';
  language?: Language;
}

interface Capture {
  url: string;
  init: RequestInit | undefined;
}

let wire: Capture[] = [];

function stubWire(o: Options): void {
  const ok = (body: unknown, status = 200): Promise<unknown> =>
    Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      wire.push({ url, init });
      if (url.includes('consent-text.json')) {
        const mode = o.consentText ?? 'served';
        if (mode === 'network') return Promise.reject(new Error('network'));
        if (mode === 500) return ok({}, 500);
        if (mode === 'hang') {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          });
        }
        return ok(SERVED);
      }
      if (url.includes('/quiz/public-config')) {
        return ok({
          quiz_enabled: false,
          language: o.language ?? 'en',
          accent_color: '#6c5ce7',
          data_source: 'db',
          ...(o.flag !== undefined ? { buyer_profile_enabled: o.flag } : {}),
        });
      }
      if (url.includes('/intent/config')) return ok(null);
      if (url.includes('/profile/erase')) {
        if (o.eraseStatus === 'network') return Promise.reject(new Error('network'));
        return ok({ result: 'deleted' }, o.eraseStatus ?? 200);
      }
      if (url.includes('/adapt/description')) return ok({}, 404);
      if (url.includes('/adapt')) {
        return ok({
          adapt_decision_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          session_id: SESSION_ID,
          archetype: 'neutral',
          confidence: 0.5,
          similarity: 0.5,
          source: 'playbook',
          generated_at: '2026-11-06T00:00:00.000Z',
          directives: [],
          variant: 'control',
        });
      }
      return ok({});
    }),
  );
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: vi.fn((url: string, data?: BodyInit) => {
      wire.push({ url, init: { body: data ?? null } });
      return true;
    }),
  });
}

function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

function seedGranted(): void {
  localStorage.setItem(CONSENT_KEY, 'granted');
  localStorage.setItem(TEXT_VERSION_KEY, SERVED.text_version);
}

function seedXid(extra: Record<string, unknown> = {}): void {
  localStorage.setItem(XID_KEY, JSON.stringify({ id: XID, created_at: Date.now(), ...extra }));
}

function insertScript(): void {
  const script = document.createElement('script');
  script.dataset.apiKey = API_KEY;
  script.dataset.decisionUrl = DECISION_API_URL;
  script.dataset.tenantId = TENANT_ID;
  document.head.appendChild(script);
}

function query(selector: string): HTMLElement | null {
  for (const host of document.querySelectorAll('[data-estalara-host]')) {
    const el = host.shadowRoot?.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

const withdrawControl = (): HTMLElement | null => query('[data-estalara-withdraw]');
const toggle = (): HTMLElement | null => query('[data-estalara-profiling-toggle]');
const consentTextCalls = (): Capture[] => wire.filter((c) => c.url.includes('consent-text.json'));
const eraseCalls = (): Capture[] => wire.filter((c) => c.url.includes('/profile/erase'));

async function bootSdk(o: Options = {}): Promise<void> {
  seedSession();
  insertScript();
  stubWire(o);
  await _initForTest();
}

function newPage(): void {
  const w = window as Window & { __estalaraTeardown?: () => void };
  w.__estalaraTeardown?.();
  delete w.__estalaraTeardown;
  document.querySelectorAll('script[data-api-key], [data-estalara-host]').forEach((el) => {
    el.remove();
  });
  wire = [];
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  eraseCrossSessionId();
  wire = [];
});

afterEach(() => {
  newPage();
  sessionStorage.clear();
  localStorage.clear();
  eraseCrossSessionId();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FOLLOW-1444 the control renders whatever the flag', () => {
  it.each<[string, boolean | undefined]>([
    ['off', false],
    ['never set', undefined],
    ['on', true],
  ])('flag %s, the id never sent: the control is in the toggle', async (_n, flag) => {
    seedGranted();
    seedXid();
    await bootSdk({ flag });
    const control = withdrawControl();
    expect(control?.tagName).toBe('BUTTON');
    expect(control?.textContent).toBe('Withdraw consent');
    expect(control?.closest('[data-estalara-profiling-toggle]')).not.toBeNull();
  });

  it('flag off: one click withdraws; the id that never left is erased with no request', async () => {
    seedGranted();
    seedXid();
    await bootSdk({ flag: false });
    withdrawControl()?.click();
    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');
    await vi.waitFor(() => {
      expect(toggle()?.textContent).toBe(served('en').withdrawDone);
    });
    expect(localStorage.getItem(XID_KEY)).toBeNull();
    expect(eraseCalls()).toEqual([]);
  });
});

describe('FOLLOW-1444 the control explains itself and reports the result', () => {
  it.each<Language>(['en', 'pl', 'es'])(
    '%s: one served sentence says what the control does',
    async (language) => {
      seedGranted();
      seedXid();
      await bootSdk({ flag: true, language });
      const why = served(language).withdrawWhy;
      expect(why).toBeTruthy();
      await vi.waitFor(() => {
        expect(toggle()?.textContent).toContain(why);
      });
      // One sentence: a single terminal stop, at the end.
      expect(why?.trim()).toMatch(/^[^.!?]+[.!?]$/);
    },
  );

  it.each<Language>(['en', 'pl', 'es'])(
    '%s: a successful delete is confirmed in a status region',
    async (language) => {
      seedGranted();
      seedXid({ sent: true });
      await bootSdk({ flag: true, language });
      await vi.waitFor(() => {
        expect(toggle()?.textContent).toContain(served(language).withdrawWhy);
      });
      withdrawControl()?.click();
      const container = toggle();
      expect(container?.getAttribute('role')).toBe('status');
      // The toggle's own controls go at once: nothing can write after the denial.
      expect(query('[data-estalara-toggle-checkbox]')).toBeNull();
      expect(withdrawControl()).toBeNull();
      await vi.waitFor(() => {
        expect(container?.textContent).toBe(served(language).withdrawDone);
      });
      expect(eraseCalls()).toHaveLength(1);
      expect(localStorage.getItem(XID_KEY)).toBeNull();
      // The status stays on the page; the rest of the SDK is torn down.
      expect(container?.isConnected).toBe(true);
    },
  );

  it.each<[string, number | 'network']>([
    ['503', 503],
    ['429', 429],
    ['a network failure', 'network'],
  ])('on %s the buyer is told the delete failed; the id is kept for the retry', async (_n, s) => {
    seedGranted();
    seedXid({ sent: true });
    await bootSdk({ flag: true, eraseStatus: s });
    await vi.waitFor(() => {
      expect(toggle()?.textContent).toContain(served('en').withdrawWhy);
    });
    withdrawControl()?.click();
    await vi.waitFor(() => {
      expect(toggle()?.textContent).toBe(served('en').withdrawFail);
    });
    expect(toggle()?.getAttribute('role')).toBe('status');
    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');
    expect((JSON.parse(localStorage.getItem(XID_KEY) ?? '{}') as { id?: string }).id).toBe(XID);
  });
});

describe('FOLLOW-1444 withdrawal never depends on the text', () => {
  it.each<['network' | 500]>([['network'], [500]])(
    'consent text %s on the granted path: in-bundle label, withdrawal works, fallback result',
    async (mode) => {
      seedGranted();
      seedXid({ sent: true });
      await bootSdk({ flag: true, consentText: mode });
      // The granted path does not fail closed on this fetch: the product and the toggle run.
      expect(toggle()).not.toBeNull();
      expect(wire.some((c) => /\/adapt(\?|$)/.test(c.url))).toBe(true);
      expect(withdrawControl()?.textContent).toBe('Withdraw consent');
      await new Promise((r) => setTimeout(r, 0));
      expect(toggle()?.textContent).not.toContain(served('en').withdrawWhy);

      withdrawControl()?.click();
      expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');
      await vi.waitFor(() => {
        expect(eraseCalls()).toHaveLength(1);
      });
      await vi.waitFor(() => {
        expect(localStorage.getItem(XID_KEY)).toBeNull();
      });
      expect(toggle()?.textContent).toBe('Personalization: disabled');
      expect(toggle()?.getAttribute('role')).toBe('status');
    },
  );

  it('a hanging text fetch: the control is there at once and withdraws', async () => {
    seedGranted();
    seedXid({ sent: true });
    await bootSdk({ flag: true, consentText: 'hang' });
    expect(withdrawControl()?.textContent).toBe('Withdraw consent');
    withdrawControl()?.click();
    await vi.waitFor(() => {
      expect(localStorage.getItem(XID_KEY)).toBeNull();
    });
    expect(toggle()?.textContent).toBe('Personalization: disabled');
  });
});

describe('FOLLOW-1444 the granted-path fetch (ADR-0021 amendment 2026-11-06)', () => {
  it('one §D3 GET of the same constant URL: no headers, no credentials, no query', async () => {
    seedGranted();
    await bootSdk({ flag: true });
    const calls = consentTextCalls();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(CONSENT_TEXT_URL);
    expect(call?.url).not.toContain('?');
    expect(call?.init?.method).toBe('GET');
    expect(call?.init?.credentials).toBe('omit');
    expect(call?.init?.mode).toBe('cors');
    expect(call?.init?.headers).toBeUndefined();
    expect(call?.init?.body).toBeUndefined();
  });

  it('pending: before the decision, the banner text GET is the only request and no control', async () => {
    seedSession();
    insertScript();
    stubWire({ flag: true });
    const init = _initForTest();
    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="accept"]')).not.toBeNull();
    });
    expect(wire.map((c) => c.url)).toEqual([CONSENT_TEXT_URL]);
    expect(withdrawControl()).toBeNull();

    // After Accept the control renders with its sentence.
    query('[data-estalara-consent="accept"]')?.click();
    await init;
    await vi.waitFor(() => {
      expect(toggle()?.textContent).toContain(served('en').withdrawWhy);
    });
  });

  it('pending, declined: no second text GET and no control', async () => {
    seedSession();
    insertScript();
    stubWire({ flag: true });
    const init = _initForTest();
    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="decline"]')).not.toBeNull();
    });
    query('[data-estalara-consent="decline"]')?.click();
    await init;
    expect(consentTextCalls()).toHaveLength(1);
    expect(withdrawControl()).toBeNull();
  });

  it('stored denied: no text GET', async () => {
    localStorage.setItem(CONSENT_KEY, 'denied');
    await bootSdk({ flag: true });
    expect(consentTextCalls()).toEqual([]);
    expect(withdrawControl()).toBeNull();
  });
});
