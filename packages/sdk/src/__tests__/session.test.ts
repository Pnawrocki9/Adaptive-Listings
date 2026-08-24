import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  generateSessionId,
  getOrCreateSession,
  getOrCreateCrossSessionId,
  eraseCrossSessionId,
  XSESSION_STORAGE_KEY,
} from '../core/session.js';
import type { SessionState } from '../core/session.js';

// sessionStorage is not available in Node — stub it at globalThis level
const mockSessionStorage = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
  getItem: (key: string) => mockSessionStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    mockSessionStorage.set(key, value);
  },
  removeItem: (key: string) => {
    mockSessionStorage.delete(key);
  },
  clear: () => {
    mockSessionStorage.clear();
  },
});

// localStorage stub for cross-session id tests
const mockLocalStorage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => mockLocalStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    mockLocalStorage.set(key, value);
  },
  removeItem: (key: string) => {
    mockLocalStorage.delete(key);
  },
  clear: () => {
    mockLocalStorage.clear();
  },
});

/** RFC 4122 v4 layout, as minted by `crypto.randomUUID()`. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('generateSessionId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a randomly-minted UUID v4, not a 64-char device digest [FOLLOW-1106]', async () => {
    const id = await generateSessionId();
    expect(id).toHaveLength(36);
    expect(id).toMatch(UUID_V4);
  });

  // ── INVERTED in FOLLOW-1106. Do not "restore" this to toBe(). ──────────────
  //
  // This assertion previously read `expect(id1).toBe(id2)` under the title
  // "produces the same ID for the same environment inputs (deterministic)".
  // That green test pinned the defect: generateSessionId() was an UNKEYED
  // SHA-256 over (userAgent | screen WxH | timezone | language) — a device
  // fingerprint, identical across tenants and never rotating, which production
  // ClickHouse showed persisting 41-106 hours across 2-5 calendar days, and
  // which collided so that two visitors on one device profile shared an id.
  // Determinism here is the property that made the DPIA, the LIA, the ROPA and
  // the Privacy Notice false. It is now forbidden, not merely unused.
  //
  // Evidence: docs/compliance/FOLLOW-1105-session-identifier-assessment.md
  // Ruling:   backlog/ESCALATIONS.md ESC-070 (Path C, CEO, 2026-08-24)
  it('mints a DIFFERENT id on every call — the id must never be a deterministic device fingerprint (ESC-070 Path C / FOLLOW-1106)', async () => {
    const id1 = await generateSessionId();
    const id2 = await generateSessionId();
    expect(id2).not.toBe(id1);
  });

  it('mints 500 distinct ids in one identical environment [FOLLOW-1106]', async () => {
    const ids = new Set(await Promise.all(Array.from({ length: 500 }, () => generateSessionId())));
    expect(ids.size).toBe(500);
  });

  // Guards the mechanism, not just the outcome: the fingerprint is gone, so no
  // digest is computed at all. A future "optimisation" that re-derives an id
  // from device signals would trip this even if it salted the result.
  it('never hashes anything — crypto.subtle.digest is not called [FOLLOW-1106]', async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest');
    await generateSessionId();
    expect(digest).not.toHaveBeenCalled();
  });

  it('does not read navigator.userAgent, screen or Intl [FOLLOW-1106]', async () => {
    const readSignals: string[] = [];
    // NOTE: restore by re-stubbing the captured original, never with
    // vi.unstubAllGlobals() — that would also drop the sessionStorage and
    // localStorage stubs installed once at module load above, silently
    // breaking every later test in this file.
    const realNavigator = globalThis.navigator;
    const realScreen = (globalThis as { screen?: unknown }).screen;

    vi.stubGlobal('navigator', {
      get userAgent() {
        readSignals.push('userAgent');
        return 'ua';
      },
      get language() {
        readSignals.push('language');
        return 'en';
      },
    });
    vi.stubGlobal('screen', {
      get width() {
        readSignals.push('screen.width');
        return 1280;
      },
      get height() {
        readSignals.push('screen.height');
        return 720;
      },
    });

    try {
      await generateSessionId();
    } finally {
      vi.stubGlobal('navigator', realNavigator);
      vi.stubGlobal('screen', realScreen);
    }

    expect(readSignals).toEqual([]);
  });

  // ── Availability ladder, argued in the session.ts docblock ────────────────
  // crypto.randomUUID() is secure-context gated; crypto.getRandomValues() is
  // not. Rung 2 is what makes a plain-HTTP tenant page work — the old body's
  // crypto.subtle is itself secure-context gated, so it could not.
  describe('availability', () => {
    const realCrypto = globalThis.crypto;

    afterEach(() => {
      vi.stubGlobal('crypto', realCrypto);
    });

    it('falls back to crypto.getRandomValues when randomUUID is absent (insecure context)', async () => {
      // Bind against the captured real crypto: reading globalThis.crypto from
      // inside the stub would recurse into the stub itself.
      vi.stubGlobal('crypto', {
        getRandomValues: (a: Uint8Array) => realCrypto.getRandomValues(a),
      });

      const id = await generateSessionId();

      expect(id).toMatch(UUID_V4);
      expect(await generateSessionId()).not.toBe(id);
    });

    it('rejects loudly rather than minting a weak or device-derived id when no CSPRNG exists', async () => {
      vi.stubGlobal('crypto', {});
      await expect(generateSessionId()).rejects.toThrow(/CSPRNG/);
    });
  });
});

describe('getOrCreateSession', () => {
  beforeEach(() => {
    mockSessionStorage.clear();
  });

  it('returns a session with sessionId, startedAt, and pageCount=0', async () => {
    const session = await getOrCreateSession();
    expect(typeof session.sessionId).toBe('string');
    expect(session.sessionId).toMatch(UUID_V4);
    expect(typeof session.startedAt).toBe('number');
    expect(session.startedAt).toBeGreaterThan(0);
    expect(session.pageCount).toBe(0);
  });

  // ── The property all eight downstream consumers depend on [FOLLOW-1106] ────
  //
  // Intra-session stability is a property of THIS function — it reads
  // sessionStorage first and calls generateSessionId() only on a miss — not of
  // how the id is computed. Before FOLLOW-1106 this test could not tell the
  // two apart: a deterministic generator returns the same value whether it is
  // read from storage or recomputed, so the assertion passed vacuously. Now
  // that the mint is random, a regression in the storage-first read fails here.
  it('returns the same session on subsequent calls (from storage)', async () => {
    const first = await getOrCreateSession();
    const second = await getOrCreateSession();
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.startedAt).toBe(first.startedAt);
  });

  it('survives a full page reload — the id comes from sessionStorage, not a fresh mint [FOLLOW-1106]', async () => {
    const first = await getOrCreateSession();

    // A reload keeps sessionStorage and drops every module-scoped variable.
    // session.ts holds no in-memory session cache, so re-invoking is the
    // faithful simulation: the value must come back out of storage.
    const stored = JSON.parse(
      mockSessionStorage.get('__estalara_session__') ?? '{}',
    ) as SessionState;
    expect(stored.sessionId).toBe(first.sessionId);

    const afterReload = await getOrCreateSession();
    expect(afterReload.sessionId).toBe(first.sessionId);
  });

  it('keeps honouring a 64-hex session written by a pre-FOLLOW-1106 build', async () => {
    const legacyId = 'a'.repeat(64);
    mockSessionStorage.set(
      '__estalara_session__',
      JSON.stringify({ sessionId: legacyId, startedAt: 1_700_000_000_000, pageCount: 3 }),
    );

    const session = await getOrCreateSession();

    // No migration, no re-mint: an id minted by the old build stays valid for
    // the rest of that tab. It is still inside the ingest envelope's
    // z.string().min(32).max(64) bound (packages/shared/src/schemas/event.ts).
    expect(session.sessionId).toBe(legacyId);
    expect(session.pageCount).toBe(3);
  });
});

describe('cross-session id (localStorage)', () => {
  beforeEach(() => {
    // Reset localStorage and flush the module-level in-memory cache between tests
    // by erasing via the public API (which also clears the cache).
    mockLocalStorage.clear();
    eraseCrossSessionId();
  });

  it('creates xid with id + created_at on first call', async () => {
    const xid = await getOrCreateCrossSessionId();
    expect(typeof xid.id).toBe('string');
    expect(xid.id.length).toBeGreaterThan(0);
    expect(typeof xid.created_at).toBe('number');
    expect(xid.created_at).toBeGreaterThan(0);
    // Persisted to localStorage
    const stored = mockLocalStorage.get(XSESSION_STORAGE_KEY);
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!) as { id: string; created_at: number };
    expect(parsed.id).toBe(xid.id);
    expect(parsed.created_at).toBe(xid.created_at);
  });

  it('returns same id within 90 days', async () => {
    const first = await getOrCreateCrossSessionId();
    // Flush in-memory cache to simulate a new page load that reads from localStorage
    eraseCrossSessionId();
    // Re-populate localStorage with the stored value from the first call
    // (eraseCrossSessionId clears it, so we restore it manually)
    mockLocalStorage.set(XSESSION_STORAGE_KEY, JSON.stringify(first));

    const second = await getOrCreateCrossSessionId();
    expect(second.id).toBe(first.id);
    expect(second.created_at).toBe(first.created_at);
  });

  it('rotates id after 90 days (mock Date.now)', async () => {
    const BASE_TIME = 1_000_000_000_000; // arbitrary fixed timestamp
    const NINETY_ONE_DAYS_MS = 91 * 24 * 60 * 60 * 1000;

    // Simulate an old entry created 91 days ago
    const oldXid = { id: 'old-uuid-value', created_at: BASE_TIME };
    mockLocalStorage.set(XSESSION_STORAGE_KEY, JSON.stringify(oldXid));

    // Advance Date.now to 91 days after oldXid.created_at
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME + NINETY_ONE_DAYS_MS);

    const rotated = await getOrCreateCrossSessionId();
    expect(rotated.id).not.toBe(oldXid.id);
    expect(rotated.created_at).toBe(BASE_TIME + NINETY_ONE_DAYS_MS);

    nowSpy.mockRestore();
  });

  it('eraseCrossSessionId removes localStorage key', async () => {
    await getOrCreateCrossSessionId();
    expect(mockLocalStorage.has(XSESSION_STORAGE_KEY)).toBe(true);

    eraseCrossSessionId();
    expect(mockLocalStorage.has(XSESSION_STORAGE_KEY)).toBe(false);
  });

  it('eraseCrossSessionId clears in-memory cache so next call generates a new id', async () => {
    const first = await getOrCreateCrossSessionId();
    eraseCrossSessionId();
    const second = await getOrCreateCrossSessionId();
    // Without storage, a fresh UUID is generated; ids must differ
    expect(second.id).not.toBe(first.id);
  });

  it('eraseCrossSessionId called on consent denied path (integration with index.ts wiring)', async () => {
    // Establish an xid in localStorage
    await getOrCreateCrossSessionId();
    expect(mockLocalStorage.has(XSESSION_STORAGE_KEY)).toBe(true);

    // Simulate what index.ts does on onDenied: call eraseCrossSessionId
    eraseCrossSessionId();

    expect(mockLocalStorage.has(XSESSION_STORAGE_KEY)).toBe(false);
  });
});
