import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectPageView, collectScrollDepth, dispatchEvents } from '../core/events.js';
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
