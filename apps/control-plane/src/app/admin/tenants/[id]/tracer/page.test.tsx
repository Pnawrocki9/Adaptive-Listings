/**
 * Tests for /admin/tenants/[id]/tracer (Live Session Monitor, K.3.6.1).
 *
 * Coverage:
 *   T1: renders error banner on non-2xx API response (Rule K.2)
 *   T2: renders error banner when data_source is 'error' (Rule K.2)
 *   T3: renders 'no active sessions' empty state when sessions list is empty
 *   T4: renders session cards with top_archetype badge when sessions returned
 *   T5: renders data_source provenance badge
 *   T6: renders navigation links (History, Export, Weight Editor)
 *
 * These tests drive the page through its data-seam (global.fetch mock) to validate
 * the rendering contract without re-implementing API logic.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/tracer/page.test
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import LiveSessionMonitorPage from './page';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';

const mockParams = Promise.resolve({ id: TENANT_ID });

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'sha256abc123def456',
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

describe('LiveSessionMonitorPage — data rendering + error states', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  beforeEach(() => {
    // localStorage stub (jsdom)
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
    // Should show the error text, not zero-fill
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

  it('T6: renders navigation links', async () => {
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
});
