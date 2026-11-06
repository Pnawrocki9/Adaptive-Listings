/**
 * FOLLOW-1445 (FOLLOW-1316 signed review P-3, ESC-092 D and public-surface item 3), through the
 * REAL `init()` (`_initForTest`, Rule Q):
 *
 * 1. One "Download my data" control, a real `<button>` in the toggle, for access and export.
 * 2. Shown only after a grant and only when an xid has left the browser and is still live: with no
 *    sent id there is no server profile to return. Never before a grant, never on a denial.
 * 3. The flag does not gate it, as it does not gate the withdrawal control (FOLLOW-1444): the
 *    server routes outlive the feature being switched off (buyer-profile-route.ts, R8). The flag
 *    only decides whether the id leaves: with it on, the first decision marks a fresh id sent
 *    before the toggle mounts, so the "no profile" cases pin the flag off.
 * 4. The click POSTs `/profile/portability` exactly as the route expects: `{ tenant_id, xid }` in
 *    the body, `Authorization: Bearer`, `X-Estalara-Signature` over the body, no xid in the URL.
 * 5. A 2xx is saved as `estalara-profile.json` through a Blob URL and `<a download>`; the URL is
 *    revoked. Any failure changes the label to a short failure text and sends nothing else.
 *
 * Every request is captured at `fetch` and `sendBeacon`.
 *
 * @module packages/sdk/src/__tests__/follow-1445.test
 */

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsentTextDocumentSchema } from '@estalara/shared';

import { _initForTest } from '../index.js';
import { eraseCrossSessionId } from '../core/xid.js';

const SESSION_ID = 'e'.repeat(64);
const API_KEY = 'test-follow1445-api-key';
const DECISION_API_URL = 'https://api.example.com/api';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const XID = '4a1c9d2e-8b3f-4c5d-9e6f-1a2b3c4d5e6f';
const CONSENT_KEY = 'estalara_consent';
const TEXT_VERSION_KEY = 'estalara_consent_text_version';
const XID_KEY = '__estalara_xid__';
const DAY_MS = 24 * 60 * 60 * 1000;

const SERVED = ConsentTextDocumentSchema.parse(
  JSON.parse(
    readFileSync(
      join(__dirname, '../../../../apps/control-plane/public/consent-text.json'),
      'utf8',
    ),
  ),
);

const PORTABILITY_DOC = JSON.stringify({
  format: 'estalara.buyer_profile',
  format_version: 1,
  exported_at: '2026-11-07T00:00:00.000Z',
  profile: { archetype: 'family_upsizer' },
  expires_at: '2027-02-05T00:00:00.000Z',
  data_source: 'redis',
});

type Language = 'en' | 'pl' | 'es';

interface Options {
  /** `buyer_profile_enabled` in the public config; `undefined` leaves the field out. */
  flag?: boolean | undefined;
  /** The `/profile/portability` status, or `'network'` for a rejected fetch. */
  portabilityStatus?: number | 'network';
  language?: Language;
}

interface Capture {
  url: string;
  init: RequestInit | undefined;
}

let wire: Capture[] = [];
let saved: { href: string; download: string; blob: Blob | undefined }[] = [];
let revoked: string[] = [];

function stubWire(o: Options): void {
  const ok = (body: unknown, status = 200): Promise<unknown> =>
    Promise.resolve({
      ok: status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      wire.push({ url, init });
      if (url.includes('consent-text.json')) return ok(SERVED);
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
      if (url.includes('/profile/portability')) {
        if (o.portabilityStatus === 'network') return Promise.reject(new Error('network'));
        const status = o.portabilityStatus ?? 200;
        return ok(status < 300 ? PORTABILITY_DOC : { result: 'failed' }, status);
      }
      if (url.includes('/profile/erase')) return ok({ result: 'deleted' });
      if (url.includes('/adapt/description')) return ok({}, 404);
      if (url.includes('/adapt')) {
        return ok({
          adapt_decision_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          session_id: SESSION_ID,
          archetype: 'neutral',
          confidence: 0.5,
          similarity: 0.5,
          source: 'playbook',
          generated_at: '2026-11-07T00:00:00.000Z',
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
  // jsdom has no object URLs and does not download: record what would be saved.
  const blobs = new Map<string, Blob>();
  let n = 0;
  Object.assign(URL, {
    createObjectURL: (blob: Blob): string => {
      const href = `blob:test/${String(++n)}`;
      blobs.set(href, blob);
      return href;
    },
    revokeObjectURL: (href: string): void => {
      revoked.push(href);
    },
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const href = this.getAttribute('href') ?? '';
    saved.push({ href, download: this.download, blob: blobs.get(href) });
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

const dataControl = (): HTMLElement | null => query('[data-estalara-data]');
const withdrawControl = (): HTMLElement | null => query('[data-estalara-withdraw]');
const portabilityCalls = (): Capture[] =>
  wire.filter((c) => c.url.includes('/profile/portability'));

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

/** Lower-case hex HMAC-SHA-256, as the route recomputes it. */
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  eraseCrossSessionId();
  wire = [];
  saved = [];
  revoked = [];
});

afterEach(() => {
  newPage();
  sessionStorage.clear();
  localStorage.clear();
  eraseCrossSessionId();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  const u = URL as { createObjectURL?: unknown; revokeObjectURL?: unknown };
  delete u.createObjectURL;
  delete u.revokeObjectURL;
});

describe('FOLLOW-1445 the control is offered only with a profile to return', () => {
  it.each<[string, boolean | undefined]>([
    ['on', true],
    ['off', false],
    ['never set', undefined],
  ])('flag %s, a sent live xid: one labelled button in the toggle', async (_n, flag) => {
    seedGranted();
    seedXid({ sent: true });
    await bootSdk({ flag });
    const control = dataControl();
    expect(control?.tagName).toBe('BUTTON');
    expect(control?.textContent).toBe('Download my data');
    expect(control?.closest('[data-estalara-profiling-toggle]')).not.toBeNull();
    // The withdrawal control is still there, and still first.
    const withdraw = withdrawControl();
    expect(withdraw).not.toBeNull();
    expect(withdraw && control ? withdraw.compareDocumentPosition(control) & 4 : 0).toBeTruthy();
    // Nothing is fetched until the buyer asks.
    expect(portabilityCalls()).toEqual([]);
  });

  // With the flag off (or never set) the id never leaves the browser, so no profile exists.
  it.each<[string, boolean | undefined]>([
    ['off', false],
    ['never set', undefined],
  ])('flag %s, an xid that never left the browser: no control', async (_n, flag) => {
    seedGranted();
    seedXid();
    await bootSdk({ flag });
    expect(withdrawControl()).not.toBeNull();
    expect(dataControl()).toBeNull();
  });

  it('flag on: the first decision sends the id, so the control follows it', async () => {
    seedGranted();
    seedXid();
    await bootSdk({ flag: true });
    expect((JSON.parse(localStorage.getItem(XID_KEY) ?? '{}') as { sent?: boolean }).sent).toBe(
      true,
    );
    expect(dataControl()).not.toBeNull();
  });

  it('granted with no stored xid: no control', async () => {
    seedGranted();
    await bootSdk({ flag: false });
    expect(withdrawControl()).not.toBeNull();
    expect(dataControl()).toBeNull();
  });

  it('a sent xid that has expired with its profile: no control', async () => {
    seedGranted();
    localStorage.setItem(
      XID_KEY,
      JSON.stringify({ id: XID, created_at: Date.now() - 91 * DAY_MS, sent: true }),
    );
    await bootSdk({ flag: false });
    expect(dataControl()).toBeNull();
  });

  it('pending: no control before the grant, and none after it for a fresh id', async () => {
    seedSession();
    insertScript();
    stubWire({ flag: false });
    const init = _initForTest();
    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="accept"]')).not.toBeNull();
    });
    expect(dataControl()).toBeNull();
    query('[data-estalara-consent="accept"]')?.click();
    await init;
    expect(withdrawControl()).not.toBeNull();
    expect(dataControl()).toBeNull();
    expect(portabilityCalls()).toEqual([]);
  });

  it('stored denied with a sent xid: no control and no portability request', async () => {
    localStorage.setItem(CONSENT_KEY, 'denied');
    seedXid({ sent: true });
    await bootSdk({ flag: true });
    expect(dataControl()).toBeNull();
    expect(portabilityCalls()).toEqual([]);
  });
});

describe('FOLLOW-1445 the click', () => {
  it('POSTs /profile/portability signed, the xid in the body only', async () => {
    seedGranted();
    seedXid({ sent: true });
    await bootSdk({ flag: true });
    dataControl()?.click();
    await vi.waitFor(() => {
      expect(portabilityCalls()).toHaveLength(1);
    });
    const [call] = portabilityCalls();
    expect(call?.url).toBe(`${DECISION_API_URL}/profile/portability`);
    expect(call?.url).not.toContain(XID);
    expect(call?.url).not.toContain('?');
    expect(call?.init?.method).toBe('POST');
    const body = call?.init?.body;
    if (typeof body !== 'string') throw new Error('portability body is not a string');
    expect(JSON.parse(body)).toEqual({ tenant_id: TENANT_ID, xid: XID });
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['X-Estalara-Signature']).toBe(await hmacHex(API_KEY, body));
    expect(JSON.stringify(headers)).not.toContain(XID);
  });

  it('a 2xx is saved as estalara-profile.json and the object URL is revoked', async () => {
    seedGranted();
    seedXid({ sent: true });
    await bootSdk({ flag: true });
    dataControl()?.click();
    await vi.waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    const [file] = saved;
    expect(file?.download).toBe('estalara-profile.json');
    expect(file?.blob?.type).toBe('application/json');
    // jsdom's Blob has no text(); FileReader reads it.
    const text = await new Promise<unknown>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result);
      };
      if (file?.blob) reader.readAsText(file.blob);
    });
    expect(text).toBe(PORTABILITY_DOC);
    await vi.waitFor(() => {
      expect(revoked).toEqual([file?.href]);
    });
    // The anchor never joins the host page's DOM.
    expect(document.querySelector('a[download]')).toBeNull();
    expect(dataControl()?.textContent).toBe('Download my data');
    // Reading changes nothing: consent and the id stay as they were.
    expect(localStorage.getItem(CONSENT_KEY)).toBe('granted');
    expect((JSON.parse(localStorage.getItem(XID_KEY) ?? '{}') as { id?: string }).id).toBe(XID);
  });

  it.each<[string, number | 'network']>([
    ['503', 503],
    ['429', 429],
    ['401', 401],
    ['a network failure', 'network'],
  ])('on %s: a short failure label, no file, nothing else sent', async (_n, status) => {
    seedGranted();
    seedXid({ sent: true });
    await bootSdk({ flag: true, portabilityStatus: status });
    const before = wire.length;
    dataControl()?.click();
    await vi.waitFor(() => {
      expect(dataControl()?.textContent).toBe('Download failed, try again');
    });
    expect(saved).toEqual([]);
    expect(wire.slice(before).map((c) => c.url)).toEqual([
      `${DECISION_API_URL}/profile/portability`,
    ]);
    // Still a button: the buyer can try again.
    expect(dataControl()?.tagName).toBe('BUTTON');
  });

  it.each<[Language, string, string]>([
    ['pl', 'Pobierz moje dane', 'Nie udało się pobrać, spróbuj ponownie'],
    ['es', 'Descargar mis datos', 'No se pudo descargar, inténtalo de nuevo'],
  ])('%s: the label and the failure text are localised', async (language, label, fail) => {
    seedGranted();
    seedXid({ sent: true });
    await bootSdk({ flag: true, language, portabilityStatus: 503 });
    expect(dataControl()?.textContent).toBe(label);
    dataControl()?.click();
    await vi.waitFor(() => {
      expect(dataControl()?.textContent).toBe(fail);
    });
  });

  it('withdrawing removes the control with the rest of the toggle', async () => {
    seedGranted();
    seedXid({ sent: true });
    await bootSdk({ flag: true });
    expect(dataControl()).not.toBeNull();
    withdrawControl()?.click();
    expect(dataControl()).toBeNull();
    expect(portabilityCalls()).toEqual([]);
  });
});
