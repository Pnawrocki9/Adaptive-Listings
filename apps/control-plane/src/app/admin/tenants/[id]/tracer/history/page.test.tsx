/**
 * Tests for /admin/tenants/[id]/tracer/history (Session History, K.3.6.2).
 *
 * FOLLOW-312 fix: the "Export CSV" button previously used a bare <a href download>
 * with _accept=text/csv as a query param. The export route selects CSV only from
 * the Accept header — a bare navigation cannot set that header, so every CSV export
 * silently returned JSONL. The fix: use fetch() with Accept: text/csv (the same
 * approach the Export Dashboard uses correctly).
 *
 * Coverage:
 *   T1: renders error banner on non-2xx API response (Rule K.2)
 *   T2: renders error banner when data_source is 'error'
 *   T3: renders event table with event_type column
 *   T4: renders data_source provenance badge (mock)
 *   T5: renders empty-state row when no events
 *   T6: "Export CSV" is a <button> that calls fetch with Accept: text/csv (FOLLOW-312 fix)
 *   T7: "Export JSONL" is an <a> link with download attribute (no Accept header needed)
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/tracer/history/page.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

const EMPTY_HISTORY = {
  events: [],
  total: 0,
  limit: 50,
  offset: 0,
  data_source: 'live',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SessionHistoryPage — FOLLOW-312 CSV export fix + data rendering', () => {
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
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:mock'),
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
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

  it('T4: renders data_source provenance badge when data_source is mock', async () => {
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
    global.fetch = vi.fn().mockResolvedValueOnce(makeFetchResponse(EMPTY_HISTORY));

    render(<SessionHistoryPage params={mockParams} searchParams={mockSearchParams} />);

    await waitFor(() => {
      expect(screen.getByText(/No events match/i)).toBeDefined();
    });
  });

  it('T6: "Export CSV" is a <button> that calls fetch with Accept: text/csv (FOLLOW-312 fix)', async () => {
    // FOLLOW-312 proof: this test would FAIL against the old code where Export CSV was an
    // <a href> that set _accept=text/csv as a query param (which the route ignores).
    // After the fix: it must be a <button> that calls fetch() with Accept: text/csv.

    const fetchMock = vi
      .fn()
      // Initial history load
      .mockResolvedValueOnce(makeFetchResponse(EMPTY_HISTORY))
      // CSV export fetch — returns a blob
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(['col1,col2'], { type: 'text/csv' })),
      });
    global.fetch = fetchMock;

    render(<SessionHistoryPage params={mockParams} searchParams={mockSearchParams} />);

    await waitFor(() => {
      expect(screen.getByText(/No events match/i)).toBeDefined();
    });

    // CSV element must be a <button>, not an <a> (bare <a> cannot set Accept header).
    const csvBtn = screen.getByText(/Export CSV/i);
    expect(csvBtn.tagName.toLowerCase()).toBe('button');

    fireEvent.click(csvBtn);

    await waitFor(() => {
      // fetch called at least twice: history load + CSV export.
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Find the CSV export call.
    const csvCall = fetchMock.mock.calls.find((call) => {
      const url = call[0] as string;
      return url.includes('/api/admin/tracer/export/decisions');
    });
    expect(csvCall).toBeDefined();

    // The CSV call MUST set Accept: text/csv header.
    const csvInit = csvCall?.[1] as RequestInit | undefined;
    const acceptHeader = (csvInit?.headers as Record<string, string> | undefined)?.Accept;
    expect(acceptHeader).toBe('text/csv');

    // The URL must NOT contain _accept query param (that was the broken approach).
    const csvUrl = csvCall?.[0] as string;
    expect(csvUrl).not.toContain('_accept');
  });

  it('T7: "Export JSONL" is an <a> link with download attribute (no Accept header needed)', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makeFetchResponse(EMPTY_HISTORY));

    render(<SessionHistoryPage params={mockParams} searchParams={mockSearchParams} />);

    await waitFor(() => {
      expect(screen.getByText(/No events match/i)).toBeDefined();
    });

    const jsonlLink = screen.getByText(/Export JSONL/i);
    // JSONL export uses <a download> — the route default is JSONL, no Accept header needed.
    expect(jsonlLink.tagName.toLowerCase()).toBe('a');
    expect(jsonlLink.hasAttribute('download')).toBe(true);
    const href = jsonlLink.getAttribute('href') ?? '';
    // Must include tenant_id but NOT _accept (JSONL is the route default).
    expect(href).toContain(TENANT_ID);
    expect(href).not.toContain('_accept');
  });
});
