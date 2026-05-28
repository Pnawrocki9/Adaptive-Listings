import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  generateSessionId,
  getOrCreateSession,
  getOrCreateCrossSessionId,
  eraseCrossSessionId,
  XSESSION_STORAGE_KEY,
} from '../core/session.js';

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

describe('generateSessionId', () => {
  it('returns a 64-character hex string', async () => {
    const id = await generateSessionId();
    expect(id).toHaveLength(64);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same ID for the same environment inputs (deterministic)', async () => {
    const id1 = await generateSessionId();
    const id2 = await generateSessionId();
    expect(id1).toBe(id2);
  });
});

describe('getOrCreateSession', () => {
  beforeEach(() => {
    mockSessionStorage.clear();
  });

  it('returns a session with sessionId, startedAt, and pageCount=0', async () => {
    const session = await getOrCreateSession();
    expect(typeof session.sessionId).toBe('string');
    expect(session.sessionId).toHaveLength(64);
    expect(typeof session.startedAt).toBe('number');
    expect(session.startedAt).toBeGreaterThan(0);
    expect(session.pageCount).toBe(0);
  });

  it('returns the same session on subsequent calls (from storage)', async () => {
    const first = await getOrCreateSession();
    const second = await getOrCreateSession();
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.startedAt).toBe(first.startedAt);
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
