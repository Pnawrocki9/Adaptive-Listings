/**
 * Tests for /admin/tracer/weights (Weight Editor, K.3.6.3).
 *
 * Coverage:
 *   T1: renders error banner when data_source is 'error' (Rule K.2)
 *   T2: renders provenance info when data_source is 'live'
 *   T3: renders data_source badge from API response
 *   T4: renders simulation stub (D-3 placeholder)
 *   T5: renders save button (disabled while loading)
 *   T6: renders error banner on save failure (non-2xx POST response)
 *
 * @module apps/control-plane/src/app/admin/tracer/weights/page.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import WeightEditorPage from './page';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_LIVE_RESPONSE = {
  weights: { behavioral_damping: 0.4 },
  effective_at: '2026-06-14T10:00:00.000Z',
  is_tenant_specific: false,
  data_source: 'live',
  id: '3ecd053e-3d2e-4eed-a900-0a42ff8c3f9e',
};

function makeFetchResponse(body: unknown, status = 200, ok = true) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WeightEditorPage — data rendering + error states', () => {
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

  it('T1: renders error banner when data_source is "error" (Rule K.2)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeFetchResponse(
          { data_source: 'error', error: { message: 'Postgres failed' } },
          500,
          false,
        ),
      );

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/Error loading config:/i)).toBeDefined();
    });
    // Save button should be disabled on error (aria disabled attr)
    const saveBtn = screen.getByText(/Save config/i);
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });

  it('T2: renders provenance info when data_source is "live"', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makeFetchResponse(MOCK_LIVE_RESPONSE));

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/Effective at:/i)).toBeDefined();
      expect(screen.getByText(/Global default/i)).toBeDefined();
    });
  });

  it('T3: renders data_source badge', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makeFetchResponse(MOCK_LIVE_RESPONSE));

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/data_source: live/i)).toBeDefined();
    });
  });

  it('T4: renders simulation stub placeholder', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makeFetchResponse(MOCK_LIVE_RESPONSE));

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/Simulation coming soon/i)).toBeDefined();
      expect(screen.getByText(/FOLLOW-282/i)).toBeDefined();
    });
  });

  it('T5: save button is rendered', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makeFetchResponse(MOCK_LIVE_RESPONSE));

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/Save config/i)).toBeDefined();
    });
  });

  it('T6: renders save error banner on non-2xx PUT response (Rule K.2)', async () => {
    // First call: load config
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse(MOCK_LIVE_RESPONSE))
      // Second call: save — fail
      .mockResolvedValueOnce(
        makeFetchResponse({ error: { message: 'DB write failed', code: 'db_error' } }, 500, false),
      );

    render(<WeightEditorPage />);

    // Wait for load to complete
    await waitFor(() => {
      expect(screen.getByText(/Save config/i)).toBeDefined();
    });

    // Click save
    const saveBtn = screen.getByText(/Save config/i);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Save error:/i)).toBeDefined();
    });
  });
});
