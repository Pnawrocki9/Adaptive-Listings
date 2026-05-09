import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateSessionId, getOrCreateSession } from '../core/session.js';

// sessionStorage is not available in Node — stub it at globalThis level
const mockStorage = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    mockStorage.set(key, value);
  },
  removeItem: (key: string) => {
    mockStorage.delete(key);
  },
  clear: () => {
    mockStorage.clear();
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
    mockStorage.clear();
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
