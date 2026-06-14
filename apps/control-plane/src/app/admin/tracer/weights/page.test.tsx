/**
 * Tests for /admin/tracer/weights (Weight Editor, K.3.6.3).
 *
 * FOLLOW-309 fix: all fixtures are derived from AdminIntentConfigResponseSchema.parse()
 * so the tests cannot pass with a response shape the real route doesn't emit.
 * Previously MOCK_LIVE_RESPONSE had an ad-hoc `id` field and a 200-GET the admin route
 * couldn't produce — see RETRO-077 TG-1 for why that caused CB-1/LG-1 to pass green.
 *
 * Coverage:
 *   T1: renders error banner on non-2xx response (Rule K.2)
 *   T2: renders "Active since" and Config ID when is_active is true (active row)
 *   T3: renders "No active global row" when is_active is false (no row exists)
 *   T4: renders data_source badge from API response
 *   T5: renders simulation stub (D-3 placeholder)
 *   T6: save button label is "Update config" when configId is present (PUT path)
 *   T7: renders save error banner on save failure (non-2xx response, Rule K.2)
 *   T8: page fetches GET /api/admin/intent/config (correct admin URL, not SDK route)
 *   T9: save issues PUT when configId is present (active row exists — fixes LG-1)
 *
 * @module apps/control-plane/src/app/admin/tracer/weights/page.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { AdminIntentConfigResponseSchema } from '@estalara/shared';

import WeightEditorPage from './page';

// ─── Fixtures derived from the REAL shared schema (RETRO-077 TG-1 prevention) ─

const ROW_ID = '3ecd053e-3d2e-4eed-a900-0a42ff8c3f9e';
const CREATED_AT = '2026-06-14T10:00:00.000Z';

/**
 * A valid "active row found" response — constructed via AdminIntentConfigResponseSchema.parse()
 * so the fixture shape is guaranteed to match what the real GET handler emits.
 * This prevents the RETRO-077 TG-1 pattern of hand-typing fields the route never emits.
 */
const ACTIVE_ROW_FIXTURE = AdminIntentConfigResponseSchema.parse({
  id: ROW_ID,
  tenant_id: null,
  is_active: true,
  weights: { behavioral_damping: 0.4 },
  created_at: CREATED_AT,
});

/**
 * A valid "no active row" response — all fields present, id/created_at null (ADR-0013).
 */
const NO_ROW_FIXTURE = AdminIntentConfigResponseSchema.parse({
  id: null,
  tenant_id: null,
  is_active: false,
  weights: {},
  created_at: null,
});

function makeFetchResponse(body: unknown, status = 200, ok = true) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WeightEditorPage — FOLLOW-309 fixes + data rendering + error states', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      writable: true,
    });
  });

  it('T1: renders error banner when API returns non-2xx (Rule K.2)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeFetchResponse({ error: { code: 'db_error', message: 'Postgres failed' } }, 500, false),
      );

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/Error loading config:/i)).toBeDefined();
    });
    // Save button should be disabled on error
    const saveBtn = screen.getByText(/Create config|Update config/i);
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });

  it('T2: renders "Active since" and Config ID when is_active is true', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makeFetchResponse(ACTIVE_ROW_FIXTURE));

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/Active since:/i)).toBeDefined();
      expect(screen.getByText(new RegExp(ROW_ID))).toBeDefined();
    });
  });

  it('T3: renders "No active global row" message when is_active is false', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makeFetchResponse(NO_ROW_FIXTURE));

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/No active global row/i)).toBeDefined();
    });
  });

  it('T4: renders data_source badge reflecting is_active state', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makeFetchResponse(ACTIVE_ROW_FIXTURE));

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/data_source: live/i)).toBeDefined();
    });
  });

  it('T5: renders simulation stub placeholder', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makeFetchResponse(ACTIVE_ROW_FIXTURE));

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/Simulation coming soon/i)).toBeDefined();
      expect(screen.getByText(/FOLLOW-282/i)).toBeDefined();
    });
  });

  it('T6: save button label is "Update config" when configId is present (PUT path, fixes LG-1)', async () => {
    // When an active row exists, configId is set from json.id and the button shows "Update config".
    // Previously the button always showed "Save config" and always took the POST path (LG-1).
    global.fetch = vi.fn().mockResolvedValueOnce(makeFetchResponse(ACTIVE_ROW_FIXTURE));

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/Update config/i)).toBeDefined();
    });
  });

  it('T7: renders save error banner on non-2xx save response (Rule K.2)', async () => {
    // First call: load config (active row → configId set)
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse(ACTIVE_ROW_FIXTURE))
      // Second call: PUT save — fail
      .mockResolvedValueOnce(
        makeFetchResponse({ error: { message: 'DB write failed', code: 'db_error' } }, 500, false),
      );

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/Update config/i)).toBeDefined();
    });

    fireEvent.click(screen.getByText(/Update config/i));

    await waitFor(() => {
      expect(screen.getByText(/Save error:/i)).toBeDefined();
    });
  });

  it('T8: loadConfig fetches GET /api/admin/intent/config (correct admin URL, not SDK /api/intent/config)', async () => {
    // This test would have FAILED against the old broken page (which called /api/intent/config
    // via GET that returned 405 — RETRO-077 CB-1). It proves the route is now correct.
    const fetchMock = vi.fn().mockResolvedValueOnce(makeFetchResponse(NO_ROW_FIXTURE));
    global.fetch = fetchMock;

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      // Must call the ADMIN GET route (ADR-0013 Contract 2), not the SDK-facing route.
      expect(calledUrl).toBe('/api/admin/intent/config');
    });
  });

  it('T9: save issues PUT to /api/admin/intent/config/<id> when configId is present', async () => {
    // Load: active row → configId = ROW_ID
    // Save: must PUT to /api/admin/intent/config/ROW_ID (not POST-create a new row each time)
    // This test proves the fix for LG-1: previously handleSave always took the POST path
    // because configId was always undefined (json.id was not in IntentConfigResponse).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse(ACTIVE_ROW_FIXTURE))
      // PUT save — succeed
      .mockResolvedValueOnce(
        makeFetchResponse({ id: ROW_ID, is_active: true, created_at: CREATED_AT }, 200, true),
      )
      // Reload after save
      .mockResolvedValueOnce(makeFetchResponse(ACTIVE_ROW_FIXTURE));
    global.fetch = fetchMock;

    render(<WeightEditorPage />);

    await waitFor(() => {
      expect(screen.getByText(/Update config/i)).toBeDefined();
    });

    fireEvent.click(screen.getByText(/Update config/i));

    await waitFor(() => {
      // 3 calls: initial load + save PUT + reload
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const saveCall = fetchMock.mock.calls[1];
      // Second call must be PUT to the ID-specific URL (not POST to base route).
      expect(saveCall?.[0]).toBe(`/api/admin/intent/config/${ROW_ID}`);
      expect((saveCall?.[1] as RequestInit).method).toBe('PUT');
    });
  });
});
