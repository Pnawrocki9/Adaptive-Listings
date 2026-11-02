/**
 * FOLLOW-1316 — the returning buyer's SDK half, through the REAL `init()` (`_initForTest`, Rule BD):
 * who may send the xid (R1-R7, R36, R37, R43, the PM's flag gate), what travels with it (R13, R44,
 * the restore), and the withdrawal path (R24-R28, NC-3, NC-7, NC-9). Every request is captured at
 * `fetch` and `sendBeacon`, so "the xid went nowhere else" is asserted on the wire (R3, R4).
 *
 * @module packages/sdk/src/__tests__/follow-1316.test
 */

// @vitest-environment jsdom
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_QUIZ_DEFINITION_V2, EventSchema, XID_RETENTION_DAYS } from '@estalara/shared';

import { _initForTest } from '../index.js';
import { fetchDirectives } from '../core/adapt.js';
import type { SdkConfig } from '../core/config.js';
import { applyQuizLeaf, initIntentState } from '../core/intent.js';
import { eraseCrossSessionId, getOrCreateCrossSessionId } from '../core/xid.js';

const SESSION_ID = 'a'.repeat(64);
const API_KEY = 'test-follow1316-api-key';
const DECISION_API_URL = 'https://api.example.com/api';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const XID = '3f2b8c1e-9a4d-4e6f-8b1a-7c5d2e9f0a11';
const LABEL_RE = /Tier [123]/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The version the served document carries; a grant at this version may send. */
const SERVED_TEXT_VERSION = (
  JSON.parse(
    readFileSync(
      join(__dirname, '../../../../apps/control-plane/public/consent-text.json'),
      'utf8',
    ),
  ) as { text_version: string }
).text_version;

const CONSENT_KEY = 'estalara_consent';
const TEXT_VERSION_KEY = 'estalara_consent_text_version';
const XID_KEY = '__estalara_xid__';
const OPT_OUT_KEY = '__estalara_profiling_opt_out__';
const LEAD_KEY = '__estalara_lead_id__';

const ADAPT_RESPONSE = {
  adapt_decision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  session_id: SESSION_ID,
  archetype: 'neutral',
  confidence: 0.5,
  similarity: 0.5,
  source: 'playbook',
  generated_at: '2026-11-02T00:00:00.000Z',
  directives: [],
  variant: 'control',
};

const LOCALE_TEXT = {
  text: 'We personalize.',
  disclosure13_1: 'one',
  disclosure13_2: 'two',
  disclosurePlatform: 'three',
  learnMore: 'more',
  accept: 'Accept',
  decline: 'Decline',
};

interface Options {
  /** `buyer_profile_enabled` in the public config; `undefined` leaves the field out. */
  flag?: boolean | undefined;
  /** Public config: network failure. */
  configFails?: boolean;
  /** Public config: answered this many ms after the request. */
  configDelayMs?: number;
  /** The `/profile/erase` status, or `'network'` for a rejected fetch. */
  eraseStatus?: number | 'network';
  /** `/adapt` answer. */
  adapt?: Record<string, unknown> | undefined;
  /** Served `text_version` of the consent document. */
  textVersion?: string;
  language?: 'en' | 'pl' | 'es';
}

interface Capture {
  url: string;
  init: RequestInit | undefined;
}

/** The SDK's whole outbound surface: every `fetch` and `sendBeacon`. */
let wire: Capture[] = [];

function stubWire(o: Options): void {
  const ok = (body: unknown, status = 200): Promise<unknown> =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      wire.push({ url, init });
      if (url.includes('consent-text.json')) {
        return ok({
          schema_version: 1,
          text_version: o.textVersion ?? SERVED_TEXT_VERSION,
          locales: { en: LOCALE_TEXT, pl: LOCALE_TEXT, es: LOCALE_TEXT },
        });
      }
      if (url.includes('/quiz/public-config')) {
        if (o.configFails) return Promise.reject(new Error('network'));
        const body = {
          quiz_enabled: true,
          language: o.language ?? 'en',
          accent_color: '#6c5ce7',
          data_source: 'db',
          quiz_definition: DEFAULT_QUIZ_DEFINITION_V2,
          definition_hash: 'f'.repeat(64),
          definition_version: null,
          ...(o.flag !== undefined ? { buyer_profile_enabled: o.flag } : {}),
        };
        if (o.configDelayMs) {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(ok(body));
            }, o.configDelayMs);
          });
        }
        return ok(body);
      }
      if (url.includes('/intent/config')) return ok(null);
      if (url.includes('/profile/erase')) {
        if (o.eraseStatus === 'network') return Promise.reject(new Error('network'));
        return ok({ result: 'deleted' }, o.eraseStatus ?? 200);
      }
      if (url.includes('/adapt/description')) return ok({}, 404);
      if (url.includes('/adapt')) return ok({ ...ADAPT_RESPONSE, ...o.adapt });
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

function seedGranted(version: string | null = SERVED_TEXT_VERSION): void {
  localStorage.setItem(CONSENT_KEY, 'granted');
  if (version !== null) localStorage.setItem(TEXT_VERSION_KEY, version);
}

function seedXid(extra: Record<string, unknown> = {}): void {
  localStorage.setItem(XID_KEY, JSON.stringify({ id: XID, created_at: Date.now(), ...extra }));
}

function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

function insertScript(): void {
  const script = document.createElement('script');
  script.dataset.apiKey = API_KEY;
  script.dataset.decisionUrl = DECISION_API_URL;
  script.dataset.tenantId = TENANT_ID;
  document.head.appendChild(script);
}

/** A fresh page load in the same browser: storage survives, the instance does not. */
function newPage(): void {
  const w = window as Window & { __estalaraTeardown?: () => void };
  w.__estalaraTeardown?.();
  delete w.__estalaraTeardown;
  document.querySelectorAll('script[data-api-key], [data-estalara-host]').forEach((el) => {
    el.remove();
  });
  wire = [];
}

async function bootSdk(o: Options = { flag: true }): Promise<void> {
  seedSession();
  insertScript();
  stubWire(o);
  await _initForTest();
}

function shadowRoots(): ShadowRoot[] {
  return [...document.querySelectorAll('[data-estalara-host]')]
    .map((h) => h.shadowRoot)
    .filter((r): r is ShadowRoot => r !== null);
}

function query(selector: string): HTMLElement | null {
  for (const root of shadowRoots()) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

const withdrawControl = (): HTMLElement | null => query('[data-estalara-withdraw]');

const adaptBodies = (): Record<string, unknown>[] =>
  wire
    .filter((c) => /\/adapt(\?|$)/.test(c.url))
    .map((c) => JSON.parse(c.init?.body as string) as Record<string, unknown>);

const eraseCalls = (): Capture[] => wire.filter((c) => c.url.includes('/profile/erase'));

/** Every ingest event sent so far. */
function ingestEvents(): Record<string, unknown>[] {
  return wire
    .filter((c) => c.url.includes('/v1/events'))
    .flatMap(
      (c) => (JSON.parse(c.init?.body as string) as { events: Record<string, unknown>[] }).events,
    );
}

/** R3, R4: where the xid value may appear, over everything the SDK sent. */
function expectXidOnlyInAllowedBodies(value: string): void {
  for (const { url, init } of wire) {
    expect(url, url).not.toContain(value);
    const body = typeof init?.body === 'string' ? init.body : '';
    if (!url.endsWith('/adapt') && !url.endsWith('/profile/erase')) {
      expect(body, url).not.toContain(value);
    }
    expect(JSON.stringify(init?.headers ?? {}), url).not.toContain(value);
    expect(body, url).not.toContain('cross_session_id');
  }
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
  delete (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── The send ────────────────────────────────────────────────────────────────

describe('FOLLOW-1316 send path', () => {
  it('flag on, consented: the xid, its time and canonical consent ride the POST body', async () => {
    seedGranted();
    seedXid();
    await bootSdk();

    const body = adaptBodies()[0];
    expect(body?.xid).toBe(XID);
    expect(typeof body?.xid_created_at).toBe('number');
    expect(Number.isInteger(body?.xid_created_at)).toBe(true);
    expect(body?.consent_state).toBe('consented');
    expectXidOnlyInAllowedBodies(XID);
  });

  it('R2: a fresh grant mints an id the first /api/adapt sends', async () => {
    seedGranted();
    await bootSdk();
    const stored = JSON.parse(localStorage.getItem(XID_KEY) ?? '{}') as { id?: string };
    expect(stored.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(adaptBodies()[0]?.xid).toBe(stored.id);
  });

  it.each<[string, () => void, Options]>([
    ['the flag is absent', () => undefined, {}],
    ['the flag is false', () => undefined, { flag: false }],
    ['the public config failed', () => undefined, { flag: true, configFails: true }],
    [
      'the id is older than the retention',
      () => {
        seedXid({ created_at: Date.now() - (XID_RETENTION_DAYS + 1) * DAY_MS });
        // The boot rotation would mint a replacement; pin the read to the expired record.
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
      },
      { flag: true },
    ],
    [
      'the text version is absent (R6)',
      () => {
        localStorage.removeItem(TEXT_VERSION_KEY);
      },
      { flag: true },
    ],
    [
      'the unscoped opt-out key is set (R36)',
      () => {
        localStorage.setItem(OPT_OUT_KEY, 'true');
      },
      { flag: true },
    ],
    [
      'an opt-out scoped to another lead is set (R37)',
      () => {
        localStorage.setItem(`${OPT_OUT_KEY}:abcdef0123456789`, 'true');
      },
      { flag: true },
    ],
    [
      'GPC is on (R7, NC-7)',
      () => {
        (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl = true;
      },
      { flag: true },
    ],
    [
      'the id belongs to another logged-in lead (R43)',
      () => {
        seedXid({ lead: 'aaaaaaaaaaaaaaaa' });
        sessionStorage.setItem(LEAD_KEY, 'bbbbbbbbbbbbbbbb');
      },
      { flag: true },
    ],
  ])('no xid when %s', async (_name, arrange, options) => {
    seedGranted();
    seedXid();
    arrange();
    await bootSdk(options);

    for (const body of adaptBodies()) {
      expect(body.xid).toBeUndefined();
      expect(body.xid_created_at).toBeUndefined();
      expect(body.archetype_source).toBeUndefined();
    }
    for (const { url, init } of wire) {
      expect(url).not.toContain(XID);
      expect(typeof init?.body === 'string' ? init.body : '').not.toContain(XID);
    }
  });

  it('R2: without SubtleCrypto no xid is sent: it could never be deleted again', async () => {
    seedGranted();
    seedXid();
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      randomUUID: () => realCrypto.randomUUID(),
      getRandomValues: (a: Uint8Array) => realCrypto.getRandomValues(a),
    });
    await bootSdk();
    expect(adaptBodies().length).toBeGreaterThan(0);
    expect(adaptBodies()[0]?.xid).toBeUndefined();
  });

  it('R36: opted out sends no xid, and opting back in sends it again', async () => {
    seedGranted();
    seedXid();
    await bootSdk();
    expect(adaptBodies()[0]?.xid).toBe(XID);

    const checkbox = query('[data-estalara-toggle-checkbox]') as HTMLInputElement | null;
    if (!checkbox) throw new Error('toggle missing');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(localStorage.getItem(OPT_OUT_KEY)).toBe('true');
    expect(localStorage.getItem(XID_KEY)).not.toBeNull();

    wire = [];
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(adaptBodies().length).toBeGreaterThan(0);
    });
    expect(adaptBodies()[0]?.xid).toBe(XID);
  });

  it('R2: a second tab withdrawing stops this tab on its very next send', async () => {
    seedGranted();
    seedXid();
    await bootSdk();
    const checkbox = query('[data-estalara-toggle-checkbox]') as HTMLInputElement | null;
    if (!checkbox) throw new Error('toggle missing');

    // Not through this instance: exactly what another tab's withdrawal leaves in storage.
    localStorage.setItem(CONSENT_KEY, 'denied');
    wire = [];
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(adaptBodies().length).toBeGreaterThan(0);
    });
    expect(adaptBodies()[0]?.xid).toBeUndefined();
    expect(adaptBodies()[0]?.consent_state).toBe('none');
  });

  // FOLLOW-1458: the first decision used to go without the xid here and the next with it. The server
  // keyed the two on different units, so one visit could land in both arms.
  it('a config answering after the 1 s budget: no decision until it answers, the first carries the xid', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    seedGranted();
    seedXid();
    seedSession();
    insertScript();
    stubWire({ flag: true, configDelayMs: 3_000 });
    const init = _initForTest();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(adaptBodies()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2_500);
    await init;
    expect(adaptBodies().length).toBeGreaterThan(0);
    for (const body of adaptBodies()) expect(body.xid).toBe(XID);
    expect(withdrawControl()).not.toBeNull();
  });

  it('a late config without the flag: the first decision goes then, without the xid', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    seedGranted();
    seedXid();
    seedSession();
    insertScript();
    stubWire({ configDelayMs: 3_000 });
    const init = _initForTest();
    await vi.advanceTimersByTimeAsync(4_000);
    await init;
    expect(adaptBodies().length).toBeGreaterThan(0);
    for (const body of adaptBodies()) expect(body.xid).toBeUndefined();
    expect(withdrawControl()).toBeNull();
  });

  it('a config that never answers: the decision still goes, without the xid (fail closed)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    seedGranted();
    seedXid();
    seedSession();
    insertScript();
    stubWire({ flag: true, configFails: true });
    const init = _initForTest();
    await vi.advanceTimersByTimeAsync(1_500);
    await init;
    expect(adaptBodies().length).toBeGreaterThan(0);
    for (const body of adaptBodies()) expect(body.xid).toBeUndefined();
  });

  it('R4: a whole session, events and flushes included, carries the xid only where allowed', async () => {
    seedGranted();
    seedXid();
    await bootSdk();
    window.dispatchEvent(new Event('beforeunload'));
    await vi.waitFor(() => {
      expect(ingestEvents().length).toBeGreaterThan(0);
    });
    for (const event of ingestEvents()) {
      expect(JSON.stringify(event)).not.toContain(XID);
    }
    expectXidOnlyInAllowedBodies(XID);
  });
});

// ─── What travels with it ────────────────────────────────────────────────────

describe('FOLLOW-1316 archetype_source and the restore', () => {
  /** Boot, walk the real quiz to `family_buyer`, and confirm it. */
  async function walkQuiz(): Promise<void> {
    await vi.waitFor(() => {
      expect(query('.estalara-quiz-card')).not.toBeNull();
    });
    const clickNth = (selector: string, i = 0): void => {
      const root = shadowRoots().find((r) => r.querySelector(selector));
      const el = root?.querySelectorAll<HTMLElement>(selector)[i];
      if (!el) throw new Error(`${selector} missing`);
      el.click();
    };
    clickNth('.estalara-quiz-answer', 0);
    clickNth('.estalara-quiz-answer', 1);
    clickNth('.estalara-quiz-cta');
    clickNth('.estalara-quiz-cta');
    clickNth('.estalara-quiz-confirm');
    await vi.waitFor(() => {
      expect(adaptBodies().at(-1)?.archetype_hint).toBe('family_buyer');
    });
  }

  it('R13, R44: a quiz result is `quiz`, and a restored buyer can still overwrite with it', async () => {
    seedGranted();
    seedXid();
    await bootSdk({
      flag: true,
      adapt: {
        profile_restore: 'restored',
        archetype: 'yield_hunter',
        confidence: 0.85,
      },
    });
    await walkQuiz();
    const body = adaptBodies().at(-1);
    expect(body?.archetype_source).toBe('quiz');
    expect(body?.xid).toBe(XID);
    expect(body?.confidence as number).toBeGreaterThan(0.6);
  });

  it('R13: a behaviour-derived label is `behavior`', async () => {
    seedGranted();
    seedXid();
    sessionStorage.setItem(
      `estalara_intent_${SESSION_ID}`,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        state: {
          archetype: 'yield_hunter',
          confidence: 0.7,
          probabilities: { yield_hunter: 0.7, neutral: 0.3 },
          signal_count: 9,
          last_updated_at: Date.now(),
          quiz_answered: false,
        },
      }),
    );
    await bootSdk();
    expect(adaptBodies()[0]?.archetype_source).toBe('behavior');
  });

  it('R13: a neutral label names no source', async () => {
    seedGranted();
    seedXid();
    sessionStorage.setItem(
      `estalara_intent_${SESSION_ID}`,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        state: {
          archetype: 'neutral',
          confidence: 0.3,
          probabilities: { neutral: 1 },
          signal_count: 0,
          last_updated_at: Date.now(),
          quiz_answered: false,
        },
      }),
    );
    await bootSdk();
    expect(adaptBodies()[0]?.xid).toBe(XID);
    expect(adaptBodies()[0]?.archetype_source).toBeUndefined();
  });

  it('R13: once the chat prior moved the label, the source is omitted', async () => {
    seedGranted();
    seedXid();
    sessionStorage.setItem(
      `estalara_intent_${SESSION_ID}`,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        state: {
          archetype: 'yield_hunter',
          confidence: 0.7,
          probabilities: { yield_hunter: 0.7, neutral: 0.3 },
          signal_count: 9,
          last_updated_at: Date.now(),
          quiz_answered: false,
          chatPriorApplied: true,
        },
      }),
    );
    await bootSdk();
    expect(adaptBodies()[0]?.xid).toBe(XID);
    expect(adaptBodies()[0]?.archetype_source).toBeUndefined();
  });

  it('R13: a label re-pinned from the session SoT has no provable source, so none is named', async () => {
    seedGranted();
    seedXid();
    sessionStorage.setItem(
      `estalara_resolved_archetype_${SESSION_ID}`,
      JSON.stringify({ archetype: 'family_buyer', confidence: 0.8 }),
    );
    sessionStorage.setItem(
      `estalara_intent_${SESSION_ID}`,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        state: {
          archetype: 'neutral',
          confidence: 0.3,
          probabilities: { neutral: 1 },
          signal_count: 0,
          last_updated_at: Date.now(),
          quiz_answered: false,
        },
      }),
    );
    await bootSdk();
    expect(adaptBodies()[0]?.archetype_hint).toBe('family_buyer');
    expect(adaptBodies()[0]?.archetype_source).toBeUndefined();
  });

  it('ESC-090 item 3: quiz result, then a chat prior moves the label: no `quiz` on the next call', async () => {
    seedGranted();
    seedXid();
    stubWire({
      adapt: {
        chat_intent_dimensions: { purchase_purpose: 'retirement', family_stage: 'retiree' },
        chat_intent_detected_at: '2026-11-02T10:00:00.000Z',
      },
    });
    const config = {
      apiKey: API_KEY,
      decisionApiUrl: DECISION_API_URL,
      tenantId: TENANT_ID,
      language: 'en',
      buyerProfileEnabled: true,
    } as SdkConfig;
    const session = { sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 };
    const quiz = {
      ...applyQuizLeaf(initIntentState(), 'yield_hunter'),
      quiz_result: 'yield_hunter' as const,
    };

    // The real fold, on the call that first sees the chat.
    const { updatedIntentState: moved } = await fetchDirectives(
      config,
      session,
      'listing_detail',
      quiz,
    );
    expect(adaptBodies().at(-1)?.archetype_source).toBe('quiz');
    expect(moved?.chatPriorApplied).toBe(true);
    expect(moved?.archetype).not.toBe('yield_hunter');

    await fetchDirectives(config, session, 'listing_detail', moved);
    const next = adaptBodies().at(-1);
    expect(next?.xid).toBe(XID);
    expect(next?.archetype_hint).toBe(moved?.archetype);
    expect(next).not.toHaveProperty('archetype_source');
  });

  it('ESC-090 item 3: the label still equals the quiz result after a chat fold: still no `quiz`', async () => {
    seedGranted();
    seedXid();
    sessionStorage.setItem(
      `estalara_intent_${SESSION_ID}`,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        state: {
          archetype: 'family_buyer',
          confidence: 0.8,
          probabilities: { family_buyer: 0.8, neutral: 0.2 },
          signal_count: 3,
          last_updated_at: Date.now(),
          quiz_answered: true,
          quiz_result: 'family_buyer',
          chatPriorApplied: true,
        },
      }),
    );
    await bootSdk();
    expect(adaptBodies()[0]?.archetype_hint).toBe('family_buyer');
    expect(adaptBodies()[0]).not.toHaveProperty('archetype_source');
  });

  it('restored: the description call uses the response archetype and carries no xid', async () => {
    seedGranted();
    seedXid();
    const listing = document.createElement('div');
    listing.setAttribute('data-estalara-listing-id', 'listing-1');
    const description = document.createElement('p');
    description.setAttribute('data-estalara-slot', 'description');
    description.textContent = 'Seller copy.';
    listing.appendChild(description);
    document.body.appendChild(listing);

    await bootSdk({
      flag: true,
      adapt: { profile_restore: 'restored', archetype: 'yield_hunter', confidence: 0.85 },
    });

    await vi.waitFor(() => {
      expect(wire.some((c) => c.url.includes('/adapt/description'))).toBe(true);
    });
    const call = wire.find((c) => c.url.includes('/adapt/description'));
    expect(call?.url).toContain('archetype=yield_hunter');
    expect(call?.url).not.toContain(XID);
    expectXidOnlyInAllowedBodies(XID);
    listing.remove();
  });
});

// ─── Text version ────────────────────────────────────────────────────────────

describe('FOLLOW-1316 R6: the consent text version', () => {
  it('a grant records the served version, consent.granted carries it, and it validates', async () => {
    stubWire({ flag: true });
    seedSession();
    insertScript();
    const init = _initForTest();
    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="accept"]')).not.toBeNull();
    });
    expect(wire.some((c) => /\/adapt(\?|$)/.test(c.url))).toBe(false);
    query('[data-estalara-consent="accept"]')?.click();
    await init;

    expect(localStorage.getItem(TEXT_VERSION_KEY)).toBe(SERVED_TEXT_VERSION);
    window.dispatchEvent(new Event('beforeunload'));
    await vi.waitFor(() => {
      expect(ingestEvents().some((e) => e.type === 'consent.granted')).toBe(true);
    });
    const granted = ingestEvents().find((e) => e.type === 'consent.granted');
    expect((granted?.payload as Record<string, unknown>).text_version).toBe(SERVED_TEXT_VERSION);
    expect(EventSchema.safeParse(granted).success).toBe(true);
    expect(adaptBodies()[0]?.xid).toBe(
      (JSON.parse(localStorage.getItem(XID_KEY) ?? '{}') as { id: string }).id,
    );
  });

  it('a recorded version below the minimum stops sending and re-prompts; Accept resumes', async () => {
    seedGranted('2026-01-01.1');
    seedXid();
    seedSession();
    insertScript();
    stubWire({ flag: true });
    const init = _initForTest();
    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="accept"]')).not.toBeNull();
    });
    expect(adaptBodies()).toEqual([]);
    expect(wire.some((c) => c.url.includes(XID))).toBe(false);

    query('[data-estalara-consent="accept"]')?.click();
    await init;
    expect(localStorage.getItem(TEXT_VERSION_KEY)).toBe(SERVED_TEXT_VERSION);
    expect(adaptBodies()[0]?.xid).toBe(XID);
  });

  it('a legacy grant with no recorded version: no re-prompt, the session runs, no xid', async () => {
    seedGranted(null);
    seedXid();
    await bootSdk();
    expect(query('[data-estalara-consent="accept"]')).toBeNull();
    expect(adaptBodies().length).toBeGreaterThan(0);
    expect(adaptBodies()[0]?.xid).toBeUndefined();
    expect(adaptBodies()[0]?.consent_state).toBe('consented');
  });

  it('the minimum is not above what the document serves, or nobody could ever send', () => {
    const source = readFileSync(join(__dirname, '../core/session.ts'), 'utf8');
    const minimum = /MIN_PROFILE_TEXT_VERSION = '([^']+)'/.exec(source)?.[1];
    expect(minimum).toBeDefined();
    expect(String(minimum) <= SERVED_TEXT_VERSION).toBe(true);
  });
});

// ─── R1 ──────────────────────────────────────────────────────────────────────

describe('FOLLOW-1316 R1: the xid is a credential', () => {
  it('no CSPRNG: no id minted, nothing stored', async () => {
    vi.stubGlobal('crypto', undefined);
    const random = vi.spyOn(Math, 'random');
    await expect(getOrCreateCrossSessionId()).resolves.toBeNull();
    expect(localStorage.getItem(XID_KEY)).toBeNull();
    expect(random).not.toHaveBeenCalled();
  });

  it('Math.random is gone from the modules that mint and read the xid', () => {
    for (const file of ['../core/session.ts', '../core/xid.ts']) {
      expect(readFileSync(join(__dirname, file), 'utf8')).not.toContain('Math.random');
    }
  });

  it('getRandomValues only: a strict v4', async () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) });
    const xid = await getOrCreateCrossSessionId();
    expect(xid?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

// ─── Withdrawal ──────────────────────────────────────────────────────────────

describe('FOLLOW-1316 withdrawal control', () => {
  it.each([
    ['en', 'Withdraw consent'],
    ['pl', 'Wycofaj zgodę'],
    ['es', 'Retirar el consentimiento'],
  ] as const)(
    'R24: visible in %s, a button, one click from the toggle',
    async (language, label) => {
      seedGranted();
      seedXid();
      await bootSdk({ flag: true, language });
      const control = withdrawControl();
      expect(control?.textContent).toBe(label);
      expect(control?.tagName).toBe('BUTTON');
      expect(control?.closest('[data-estalara-profiling-toggle]')).not.toBeNull();
      expect(control?.className ?? '').not.toContain('estalara-quiz-answer');
      expect(control?.textContent ?? '').not.toMatch(LABEL_RE);
    },
  );

  it('flag off, never sent: no control and no network for it', async () => {
    seedGranted();
    seedXid();
    await bootSdk({ flag: false });
    expect(query('[data-estalara-profiling-toggle]')).not.toBeNull();
    expect(withdrawControl()).toBeNull();
    expect(eraseCalls()).toEqual([]);
  });

  it('flag off but this xid already left the browser: the control stays, never stranded', async () => {
    seedGranted();
    seedXid({ sent: true });
    await bootSdk({ flag: false });
    expect(withdrawControl()).not.toBeNull();
    withdrawControl()?.click();
    await vi.waitFor(() => {
      expect(eraseCalls()).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(localStorage.getItem(XID_KEY)).toBeNull();
    });
  });

  it('R25: denied at once, signed delete, local erase on 2xx, DOM reverted, SDK halted', async () => {
    seedGranted();
    seedXid();
    const headline = document.createElement('h1');
    headline.setAttribute('data-estalara-slot', 'headline');
    headline.textContent = 'Seller headline';
    const listing = document.createElement('div');
    listing.setAttribute('data-estalara-listing-id', 'listing-1');
    listing.appendChild(headline);
    document.body.appendChild(listing);
    await bootSdk({
      flag: true,
      adapt: {
        archetype: 'yield_hunter',
        confidence: 0.85,
        directives: [
          {
            type: 'text',
            slot: 'headline',
            value: 'Adapted headline',
            archetype: 'yield_hunter',
            confidence: 0.85,
          },
        ],
      },
    });
    expect(headline.textContent).toBe('Adapted headline');

    wire = [];
    withdrawControl()?.click();
    // Synchronous with the click: the first thing that happens (R25).
    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');

    await vi.waitFor(() => {
      expect(eraseCalls()).toHaveLength(1);
    });
    const [erase] = eraseCalls();
    if (!erase) throw new Error('no erase call');
    const { url, init } = erase;
    expect(url).toBe(`${DECISION_API_URL}/profile/erase`);
    expect(init?.method).toBe('POST');
    expect(init?.keepalive).toBe(true);
    const rawBody = init?.body as string;
    expect(JSON.parse(rawBody)).toEqual({ tenant_id: TENANT_ID, xid: XID });
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['X-Estalara-Signature']).toBe(
      createHmac('sha256', API_KEY).update(rawBody).digest('hex'),
    );

    await vi.waitFor(() => {
      expect(localStorage.getItem(XID_KEY)).toBeNull();
    });
    expect(localStorage.getItem(TEXT_VERSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(`estalara_intent_${SESSION_ID}`)).toBeNull();
    expect(sessionStorage.getItem('estalara_quiz_config_cache')).toBeNull();

    // R28: the tenant's copy is back and the widget is gone.
    expect(headline.textContent).toBe('Seller headline');
    expect(document.querySelector('[data-estalara-host]')).toBeNull();

    // The audit event is the only other request, and it is valid at the ingest boundary.
    await vi.waitFor(() => {
      expect(ingestEvents().map((e) => e.type)).toEqual(['consent.denied']);
    });
    expect(EventSchema.safeParse(ingestEvents()[0]).success).toBe(true);
    expect(adaptBodies()).toEqual([]);
    expectXidOnlyInAllowedBodies(XID);
    listing.remove();
  });

  it.each<[string, number | 'network']>([
    ['503', 503],
    ['429', 429],
    ['a network failure', 'network'],
  ])(
    'R25, NC-9: on %s the xid stays; the next load deletes and only then erases',
    async (_n, s) => {
      seedGranted();
      seedXid();
      await bootSdk({ flag: true, eraseStatus: s });
      withdrawControl()?.click();
      await vi.waitFor(() => {
        expect(eraseCalls()).toHaveLength(1);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');
      expect((JSON.parse(localStorage.getItem(XID_KEY) ?? '{}') as { id: string }).id).toBe(XID);

      // Still failing on the next load: kept again.
      newPage();
      await bootSdk({ flag: true, eraseStatus: s });
      expect(eraseCalls()).toHaveLength(1);
      expect(localStorage.getItem(XID_KEY)).not.toBeNull();

      // R26: the delete, and nothing else, then the erase.
      newPage();
      await bootSdk({ flag: true });
      expect(wire.map((c) => new URL(c.url).pathname)).toEqual(['/api/profile/erase']);
      expect(localStorage.getItem(XID_KEY)).toBeNull();
      expect(document.querySelector('[data-estalara-host]')).toBeNull();
    },
  );

  it('R26: stored denied with an id that never left the browser: erased, nothing on the wire', async () => {
    localStorage.setItem(CONSENT_KEY, 'denied');
    localStorage.setItem(XID_KEY, JSON.stringify({ id: XID, created_at: Date.now() }));
    await bootSdk();
    expect(wire).toEqual([]);
    expect(localStorage.getItem(XID_KEY)).toBeNull();
  });

  it('R21: stored denied with an expired sent id: the server copy is gone too, no call', async () => {
    localStorage.setItem(CONSENT_KEY, 'denied');
    localStorage.setItem(
      XID_KEY,
      JSON.stringify({
        id: XID,
        created_at: Date.now() - (XID_RETENTION_DAYS + 1) * DAY_MS,
        sent: true,
      }),
    );
    await bootSdk();
    expect(wire).toEqual([]);
    expect(localStorage.getItem(XID_KEY)).toBeNull();
  });

  it('R26: declining the banner with a sent id: delete first, erase on 2xx', async () => {
    seedXid({ sent: true });
    stubWire({ flag: true });
    seedSession();
    insertScript();
    const init = _initForTest();
    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="decline"]')).not.toBeNull();
    });
    query('[data-estalara-consent="decline"]')?.click();
    await init;
    expect(eraseCalls()).toHaveLength(1);
    expect(localStorage.getItem(XID_KEY)).toBeNull();
    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');
    expect(ingestEvents().map((e) => e.type)).toEqual(['consent.denied']);
  });

  it('R26: declining the banner, failed delete: kept for the next load', async () => {
    seedXid({ sent: true });
    stubWire({ flag: true, eraseStatus: 500 });
    seedSession();
    insertScript();
    const init = _initForTest();
    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="decline"]')).not.toBeNull();
    });
    query('[data-estalara-consent="decline"]')?.click();
    await init;
    expect(eraseCalls()).toHaveLength(1);
    expect(localStorage.getItem(XID_KEY)).not.toBeNull();
  });

  it('R28: a later grant draws a new id and inherits nothing', async () => {
    seedGranted();
    seedXid();
    await bootSdk();
    withdrawControl()?.click();
    await vi.waitFor(() => {
      expect(localStorage.getItem(XID_KEY)).toBeNull();
    });

    newPage();
    localStorage.removeItem(CONSENT_KEY);
    stubWire({ flag: true });
    seedSession();
    insertScript();
    const init = _initForTest();
    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="accept"]')).not.toBeNull();
    });
    query('[data-estalara-consent="accept"]')?.click();
    await init;
    const fresh = JSON.parse(localStorage.getItem(XID_KEY) ?? '{}') as { id?: string };
    expect(fresh.id).toBeDefined();
    expect(fresh.id).not.toBe(XID);
    expect(adaptBodies()[0]?.xid).toBe(fresh.id);
  });

  it('R28: withdrawal also clears a scoped opt-out key, so a later grant is not silently muted', async () => {
    seedGranted();
    seedXid();
    localStorage.setItem(`${OPT_OUT_KEY}:abcdef0123456789`, 'true');
    await bootSdk();
    withdrawControl()?.click();
    await vi.waitFor(() => {
      expect(localStorage.getItem(XID_KEY)).toBeNull();
    });
    expect(localStorage.getItem(`${OPT_OUT_KEY}:abcdef0123456789`)).toBeNull();
  });

  it('R43: a first logged-in send binds the id to that lead; the same lead keeps sending', async () => {
    seedGranted();
    seedXid();
    sessionStorage.setItem(LEAD_KEY, 'aaaaaaaaaaaaaaaa');
    await bootSdk();
    expect(adaptBodies()[0]?.xid).toBe(XID);
    expect(adaptBodies()[0]?.lead_id).toBe('aaaaaaaaaaaaaaaa');

    newPage();
    await bootSdk();
    expect(adaptBodies()[0]?.xid).toBe(XID);
  });

  it('R38: the toggle copy says nothing of deleting', async () => {
    seedGranted();
    seedXid();
    await bootSdk();
    expect(query('[data-estalara-toggle-status]')?.textContent).toBe('Personalization: active');
  });
});
