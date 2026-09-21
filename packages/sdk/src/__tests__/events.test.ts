import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectPageView, collectScrollDepth, dispatchEvents } from '../core/events.js';
import type { EventBatch } from '../core/events.js';
import type { SdkConfig } from '../core/config.js';
import type { SessionState } from '../core/session.js';

const MOCK_CONFIG: SdkConfig = {
  apiKey: 'est_live_test_key',
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
};

const MOCK_SESSION: SessionState = {
  sessionId: 'a'.repeat(64),
  startedAt: 1_700_000_000_000,
  pageCount: 1,
};

describe('collectPageView', () => {
  it('returns an event with type="page.view"', () => {
    const event = collectPageView();
    expect(event.type).toBe('page.view');
    expect(typeof event.ts).toBe('number');
    expect(event.ts).toBeGreaterThan(0);
    expect(typeof event.payload).toBe('object');
  });
});

describe('collectScrollDepth', () => {
  it('returns an event with type="scroll.depth" and the correct depth', () => {
    const event = collectScrollDepth(50);
    expect(event.type).toBe('scroll.depth');
    // Field name is `pct` per ScrollDepthPayloadSchema — renamed from depth_percent (B3 fix)
    expect(event.payload.pct).toBe(50);
  });
});

describe('dispatchEvents', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it('calls fetch with the correct URL and X-Estalara-API-Key header', async () => {
    const events = [collectPageView()];
    await dispatchEvents(events, MOCK_CONFIG, MOCK_SESSION);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(MOCK_CONFIG.ingestUrl);
    const headers = init.headers as Record<string, string>;
    // Canonical auth header — ingest Worker reads X-Estalara-API-Key (B3 fix)
    expect(headers['X-Estalara-API-Key']).toBe(MOCK_CONFIG.apiKey);
    expect(headers['x-session-id']).toBe(MOCK_SESSION.sessionId);
  });

  it('does NOT throw when fetch rejects (fail silently)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const events = [collectPageView()];
    await expect(dispatchEvents(events, MOCK_CONFIG, MOCK_SESSION)).resolves.toBeUndefined();
  });

  it('skips the fetch call when events array is empty', async () => {
    await dispatchEvents([], MOCK_CONFIG, MOCK_SESSION);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('dispatchEvents retry policy (FOLLOW-1242)', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  function keyOf(call: unknown[]): string {
    return ((call[1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'] ?? '';
  }

  /** Runs `flushes` unforced flushes of an initially one-event queue; returns send count. */
  async function sendsOver(flushes: number, pending: EventBatch[]): Promise<number> {
    const queue = [collectPageView()];
    for (let i = 0; i < flushes; i++) {
      await dispatchEvents(queue, MOCK_CONFIG, MOCK_SESSION, pending);
    }
    return mockFetch.mock.calls.length;
  }

  it.each([401, 403, 400, 413])('drops (never re-sends) a batch rejected with %i', async (s) => {
    mockFetch.mockResolvedValue(new Response('{}', { status: s }));
    const pending: EventBatch[] = [];
    expect(await sendsOver(20, pending)).toBe(1);
    expect(pending).toHaveLength(0);
  });

  it('backs off in flushes: re-sends on the 2nd, 4th, 8th and 16th flush, then drops', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const pending: EventBatch[] = [];
    const sentOn: number[] = [];
    const queue = [collectPageView()];
    for (let flushNo = 1; flushNo <= 40; flushNo++) {
      const before = mockFetch.mock.calls.length;
      await dispatchEvents(queue, MOCK_CONFIG, MOCK_SESSION, pending);
      if (mockFetch.mock.calls.length > before) sentOn.push(flushNo);
    }
    expect(sentOn).toEqual([1, 2, 4, 8, 16]);
    expect(pending).toHaveLength(0);
    // Every send of the batch carried the same key and byte-identical body.
    const keys = new Set(mockFetch.mock.calls.map(keyOf));
    const bodies = new Set(mockFetch.mock.calls.map((c) => (c[1] as RequestInit).body));
    expect(keys.size).toBe(1);
    expect(bodies.size).toBe(1);
  });

  it('retries 5xx and 429, and stops as soon as ingest accepts', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const pending: EventBatch[] = [];
    expect(await sendsOver(20, pending)).toBe(3);
    expect(pending).toHaveLength(0);
  });

  it('a forced flush (hide/unload) re-sends a held batch without waiting out the backoff', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const pending: EventBatch[] = [];
    await dispatchEvents([collectPageView()], MOCK_CONFIG, MOCK_SESSION, pending); // n=1: send
    await dispatchEvents([], MOCK_CONFIG, MOCK_SESSION, pending); // n=2: send
    await dispatchEvents([], MOCK_CONFIG, MOCK_SESSION, pending); // n=3: backing off
    expect(mockFetch).toHaveBeenCalledTimes(2);

    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    await dispatchEvents([], MOCK_CONFIG, MOCK_SESSION, pending, true); // n=4, forced: send
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(pending).toHaveLength(0);
  });

  it('sends the newest batch first, so it gets the keepalive quota on unload', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    const pending: EventBatch[] = [];
    await dispatchEvents([collectPageView()], MOCK_CONFIG, MOCK_SESSION, pending);
    const heldKey = keyOf(mockFetch.mock.calls[0] as unknown[]);
    await dispatchEvents([collectPageView()], MOCK_CONFIG, MOCK_SESSION, pending, true);
    const [newest, retried] = mockFetch.mock.calls.slice(1) as unknown[][];
    expect(keyOf(retried ?? [])).toBe(heldKey);
    expect(keyOf(newest ?? [])).not.toBe(heldKey);
  });

  it('never holds more than 16 batches when ingest stays down (memory bound)', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const pending: EventBatch[] = [];
    let max = 0;
    for (let i = 0; i < 200; i++) {
      // A new batch every flush, with hide/unload forced flushes mixed in.
      await dispatchEvents([collectPageView()], MOCK_CONFIG, MOCK_SESSION, pending, i % 7 === 0);
      max = Math.max(max, pending.length);
    }
    expect(max).toBeLessThanOrEqual(16);
    expect(pending.every((b) => b.n < 16)).toBe(true);
  });

  it('never rejects when fetch rejects or ingest is down, across many flushes', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const pending: EventBatch[] = [];
    for (let i = 0; i < 5; i++) {
      await expect(
        dispatchEvents([collectPageView()], MOCK_CONFIG, MOCK_SESSION, pending, i % 2 === 0),
      ).resolves.toBeUndefined();
    }
  });

  it('with no pending list (consent.denied audit path) a failed batch is attempted once only', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await dispatchEvents([collectPageView()], MOCK_CONFIG, MOCK_SESSION);
    await dispatchEvents([], MOCK_CONFIG, MOCK_SESSION);
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
