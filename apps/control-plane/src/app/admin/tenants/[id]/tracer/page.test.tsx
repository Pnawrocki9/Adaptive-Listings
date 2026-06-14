/**
 * Tests for /admin/tenants/[id]/tracer (Live Session Monitor, K.3.6.1).
 *
 * FOLLOW-310 fix: asserts the SSE EventSource URL does NOT include a ?token= query param.
 * Previously the page passed ?token=<localStorage> to the SSE endpoint, which caused
 * every stream to 401 because verifyTracerAdminAuth reads the token only from headers
 * (RETRO-077 CB-2). The fix: cookie-only auth — no token in the URL.
 *
 * Coverage:
 *   T1: renders error banner on non-2xx API response (Rule K.2)
 *   T2: renders error banner when data_source is 'error' (Rule K.2)
 *   T3: renders 'no active sessions' empty state when sessions list is empty
 *   T4: renders session cards with top_archetype badge when sessions returned
 *   T5: renders data_source provenance badge
 *   T6: renders navigation links (History, Export, Weight Editor)
 *   T7: sessions fetch does NOT include ?token= or Authorization (cookie-only, FOLLOW-310)
 *   T8: EventSource URL for SSE stream does NOT include ?token= or ?admin_token= (FOLLOW-310)
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/tracer/page.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import LiveSessionMonitorPage from './page';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const SESSION_ID = 'sha256abc123def456';

const mockParams = Promise.resolve({ id: TENANT_ID });

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: SESSION_ID,
    tenant_id: TENANT_ID,
    signal_count: 7,
    top_archetype: 'yield_hunter',
    confidence: 0.78,
    last_event_at: new Date().toISOString(),
    quiz_completed: true,
    chat_turns: 2,
    ...overrides,
  };
}

function makeFetchResponse(body: unknown, status = 200, ok = true) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LiveSessionMonitorPage — FOLLOW-310 SSE auth fix + data rendering', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  beforeEach(() => {
    // localStorage stub — should NOT be read for SSE URL construction after FOLLOW-310.
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: () => 'test-admin-token', setItem: vi.fn(), removeItem: vi.fn() },
      writable: true,
    });
  });

  it('T1: renders error banner on non-2xx API response (Rule K.2)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeFetchResponse(
          { error: { message: 'DB unavailable' }, data_source: 'error' },
          503,
          false,
        ),
      );

    render(<LiveSessionMonitorPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText(/Error:/i)).toBeDefined();
    });
    expect(screen.queryByText(/No active sessions/)).toBeNull();
  });

  it('T2: renders error banner when data_source is "error" (Rule K.2)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeFetchResponse(
          { sessions: [], data_source: 'error', error: { message: 'Postgres failed' } },
          200,
          true,
        ),
      );

    render(<LiveSessionMonitorPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText(/Error:/i)).toBeDefined();
    });
  });

  it('T3: renders empty state when session list is empty', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ sessions: [], data_source: 'live' }));

    render(<LiveSessionMonitorPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText(/No active sessions/i)).toBeDefined();
    });
  });

  it('T4: renders session card with top_archetype badge', async () => {
    const session = makeSession({ tenant_id: TENANT_ID });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ sessions: [session], data_source: 'live' }));

    render(<LiveSessionMonitorPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText('yield_hunter')).toBeDefined();
    });
  });

  it('T5: renders data_source provenance badge', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ sessions: [], data_source: 'mock' }));

    render(<LiveSessionMonitorPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText(/data_source: mock/i)).toBeDefined();
    });
  });

  it('T6: renders navigation links (History, Export, Weight Editor)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ sessions: [], data_source: 'live' }));

    render(<LiveSessionMonitorPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText(/Session History/i)).toBeDefined();
      expect(screen.getByText(/Export Dashboard/i)).toBeDefined();
      expect(screen.getByText(/Weight Editor/i)).toBeDefined();
    });
  });

  it('T7: sessions fetch does NOT include Authorization header (cookie-only auth, FOLLOW-310)', async () => {
    // After FOLLOW-310: page must rely on the sb-access-token cookie automatically
    // sent by the browser — NOT manually attaching a localStorage token to fetch headers.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ sessions: [], data_source: 'live' }));
    global.fetch = fetchMock;

    render(<LiveSessionMonitorPage params={mockParams} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    // The sessions fetch must NOT pass an Authorization header with a localStorage token.
    const callArgs = fetchMock.mock.calls[0];
    // fetch(url) — no init object, or init without Authorization header.
    const initArg = callArgs?.[1] as RequestInit | undefined;
    const authHeader = (initArg?.headers as Record<string, string> | undefined)?.Authorization;
    expect(authHeader).toBeUndefined();
  });

  it('T8: SSE EventSource URL does NOT contain ?token= or ?admin_token= (FOLLOW-310)', async () => {
    // This test proves the fix for RETRO-077 CB-2: the page previously constructed
    //   /api/admin/tracer/sessions/<id>/stream?tenant_id=...&token=<localStorage>
    // which caused every SSE connection to 401 (verifyTracerAdminAuth ignores query params).
    // After FOLLOW-310, the URL must NOT contain any token query param.

    // Stub EventSource to capture the URL it was called with.
    const capturedUrls: string[] = [];
    const MockEventSource = vi.fn().mockImplementation((url: string) => {
      capturedUrls.push(url);
      return {
        onopen: null,
        onmessage: null,
        onerror: null,
        close: vi.fn(),
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).EventSource = MockEventSource;

    // Render with a session so the SessionCard with SessionStream appears.
    const session = makeSession({ tenant_id: TENANT_ID });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ sessions: [session], data_source: 'live' }));

    render(<LiveSessionMonitorPage params={mockParams} />);

    // Wait for the session card to render.
    await waitFor(() => {
      expect(screen.getByText('yield_hunter')).toBeDefined();
    });

    // Expand the session to trigger SessionStream mount (and EventSource creation).
    const expandBtn = screen.getByText(/expand/i);
    fireEvent.click(expandBtn);

    // Wait for EventSource to be created.
    await waitFor(() => {
      expect(capturedUrls.length).toBeGreaterThan(0);
    });

    const sseUrl = capturedUrls[0]!;
    // Must contain tenant_id (the stream route needs it for ClickHouse scoping).
    expect(sseUrl).toContain(`tenant_id=${TENANT_ID}`);
    expect(sseUrl).toContain(SESSION_ID);
    // Must NOT contain a token query param — auth via cookie only (ADR-0013 §Decision 1).
    expect(sseUrl).not.toContain('token=');
    expect(sseUrl).not.toContain('admin_token=');
  });
});
