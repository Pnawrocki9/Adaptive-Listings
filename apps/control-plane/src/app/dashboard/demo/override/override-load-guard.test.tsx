/**
 * Load-failure guard tests for /dashboard/demo/override (FOLLOW-630, RETRO-206).
 *
 * The tenant-facing twin of the admin StaffDemoOverrideEditor fixed in
 * FOLLOW-624 — and the WORSE case, because this page previously had NO `!r.ok`
 * guard, so a 500 body was parsed as config and rendered DEMO MODE OFF silently.
 * A failed GET must now render a role="alert" state and disable Save so a
 * subsequent PUT cannot clobber the tenant's real live demo override with
 * DEFAULTS (Rule K.2 consumer-side clause).
 *
 * @module apps/control-plane/src/app/dashboard/demo/override/override-load-guard.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import DemoOverridePage from './page';

const SAMPLE_STATE = {
  enabled: true,
  override_archetype: 'yield_hunter',
  override_model: 'claude-sonnet-4-6',
  archetypes: ['yield_hunter', 'family_buyer', 'neutral'],
  models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'],
};

function mockFetchOnce(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: () => Promise.resolve(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DemoOverridePage — FOLLOW-630 load-failure guard', () => {
  it('shows an error alert, disables Save, and issues no PUT when the initial GET returns 500', async () => {
    // Note: previously this 500 body would have been parsed as config with no
    // guard, silently rendering DEMO MODE OFF. The new `!r.ok` guard prevents it.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { message: 'Internal error' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DemoOverridePage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toHaveProperty('disabled', true);

    fireEvent.click(saveButton);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('retries the GET when the Retry affordance is used after a failed load', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { message: 'Internal error' } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE_STATE) });
    vi.stubGlobal('fetch', fetchMock);

    render(<DemoOverridePage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^save$/i })).toHaveProperty('disabled', false);
    });
  });

  it('behaves unchanged when the GET succeeds (Save enabled, no error alert)', async () => {
    mockFetchOnce(SAMPLE_STATE);
    render(<DemoOverridePage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^save$/i })).toHaveProperty('disabled', false);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
