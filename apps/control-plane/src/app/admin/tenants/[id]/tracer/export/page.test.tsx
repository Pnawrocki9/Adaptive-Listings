/**
 * Tests for /admin/tenants/[id]/tracer/export (Export Dashboard, K.3.6.4).
 *
 * Coverage:
 *   T1: renders page heading and tenant ID
 *   T2: renders all three download card titles
 *   T3: renders date-range presets (Last 24h, Last 7d, Last 30d)
 *   T4: download button triggers fetch to /api/admin/tracer/export/decisions
 *   T5: renders error banner on 503 response (ClickHouse unconfigured, Rule K.2)
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/tracer/export/page.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import ExportDashboardPage from './page';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const mockParams = Promise.resolve({ id: TENANT_ID });

function makeFetchResponse(body: unknown, status = 200, ok = true) {
  return {
    ok,
    status,
    blob: () => Promise.resolve(new Blob(['csv data'], { type: 'text/csv' })),
    json: () => Promise.resolve(body),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ExportDashboardPage — rendering + error states', () => {
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
    // URL.createObjectURL stub
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:mock'),
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
  });

  it('T1: renders page heading and tenant ID', async () => {
    render(<ExportDashboardPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText(/Export Dashboard/i)).toBeDefined();
      expect(screen.getByText(new RegExp(TENANT_ID))).toBeDefined();
    });
  });

  it('T2: renders all three download card titles', async () => {
    render(<ExportDashboardPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText(/Decisions — CSV/i)).toBeDefined();
      expect(screen.getAllByText(/Decisions — JSONL/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Events — JSONL/i)).toBeDefined();
    });
  });

  it('T3: renders date-range presets', async () => {
    render(<ExportDashboardPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText('Last 24h')).toBeDefined();
      expect(screen.getByText('Last 7d')).toBeDefined();
      expect(screen.getByText('Last 30d')).toBeDefined();
    });
  });

  it('T4: download button calls /api/admin/tracer/export/decisions', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeFetchResponse(null, 200, true));
    global.fetch = fetchMock;

    render(<ExportDashboardPage params={mockParams} />);

    // Wait for tenant ID to resolve
    await waitFor(() => {
      expect(screen.getByText(new RegExp(TENANT_ID))).toBeDefined();
    });

    const downloadBtn = screen.getAllByText(/Download CSV/i)[0];
    if (downloadBtn) fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      const url = fetchMock.mock.calls[0]?.[0] as string;
      expect(url).toContain('/api/admin/tracer/export/decisions');
      expect(url).toContain(TENANT_ID);
    });
  });

  it('T5: renders error banner on 503 response (ClickHouse unconfigured, Rule K.2)', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      makeFetchResponse(
        {
          error: { code: 'clickhouse_unavailable', message: 'ClickHouse not configured' },
          data_source: 'unconfigured',
        },
        503,
        false,
      ),
    );

    render(<ExportDashboardPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText(new RegExp(TENANT_ID))).toBeDefined();
    });

    const downloadBtns = screen.getAllByText(/Download CSV/i);
    if (downloadBtns[0]) fireEvent.click(downloadBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Export unavailable/i)).toBeDefined();
    });
  });
});
