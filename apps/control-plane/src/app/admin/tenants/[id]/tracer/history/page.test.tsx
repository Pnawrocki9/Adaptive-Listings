/**
 * Tests for /admin/tenants/[id]/tracer/history (Session History, K.3.6.2).
 *
 * Coverage:
 *   T1: renders error banner on non-2xx API response (Rule K.2)
 *   T2: renders error banner when data_source is 'error'
 *   T3: renders event table with event_type column
 *   T4: renders data_source provenance badge
 *   T5: renders empty-state row when no events
 *   T6: renders export download link buttons
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/tracer/history/page.test
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import SessionHistoryPage from './page';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';

const mockParams = Promise.resolve({ id: TENANT_ID });
const mockSearchParams = Promise.resolve({});

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'sha256abcdef',
    tenant_id: TENANT_ID,
    event_at: new Date().toISOString(),
    event_type: 'intent.snapshot',
    archetype_deltas: '{"yield_hunter":0.1}',
    confidence_before: 0.55,
    confidence_after: 0.67,
    top_archetype: 'yield_hunter',
    event_payload: '{}',
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

describe('SessionHistoryPage — data rendering + error states', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  beforeEach(() => {
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
          { error: { message: 'ClickHouse failed' }, data_source: 'error' },
          500,
          false,
        ),
      );

    render(<SessionHistoryPage params={mockParams} searchParams={mockSearchParams} />);

    await waitFor(() => {
      expect(screen.getByText(/Error:/i)).toBeDefined();
    });
  });

  it('T2: renders error banner when data_source is "error"', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      makeFetchResponse({
        events: [],
        total: 0,
        limit: 50,
        offset: 0,
        data_source: 'error',
        error: { message: 'ClickHouse unavailable' },
      }),
    );

    render(<SessionHistoryPage params={mockParams} searchParams={mockSearchParams} />);

    await waitFor(() => {
      expect(screen.getByText(/Error:/i)).toBeDefined();
    });
  });

  it('T3: renders event rows with event_type', async () => {
    const event = makeEvent();
    global.fetch = vi.fn().mockResolvedValueOnce(
      makeFetchResponse({
        events: [event],
        total: 1,
        limit: 50,
        offset: 0,
        data_source: 'live',
      }),
    );

    render(<SessionHistoryPage params={mockParams} searchParams={mockSearchParams} />);

    await waitFor(() => {
      expect(screen.getByText('intent.snapshot')).toBeDefined();
    });
  });

  it('T4: renders data_source provenance badge', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      makeFetchResponse({
        events: [],
        total: 0,
        limit: 50,
        offset: 0,
        data_source: 'mock',
      }),
    );

    render(<SessionHistoryPage params={mockParams} searchParams={mockSearchParams} />);

    await waitFor(() => {
      expect(screen.getByText(/data_source: mock/i)).toBeDefined();
    });
  });

  it('T5: renders empty state when no events match', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      makeFetchResponse({
        events: [],
        total: 0,
        limit: 50,
        offset: 0,
        data_source: 'live',
      }),
    );

    render(<SessionHistoryPage params={mockParams} searchParams={mockSearchParams} />);

    await waitFor(() => {
      expect(screen.getByText(/No events match/i)).toBeDefined();
    });
  });

  it('T6: renders export links', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      makeFetchResponse({
        events: [],
        total: 0,
        limit: 50,
        offset: 0,
        data_source: 'live',
      }),
    );

    render(<SessionHistoryPage params={mockParams} searchParams={mockSearchParams} />);

    await waitFor(() => {
      expect(screen.getByText(/Export CSV/i)).toBeDefined();
      expect(screen.getByText(/Export JSONL/i)).toBeDefined();
    });
  });
});
