/**
 * Load-failure guard tests for GenerationModelSettings (FOLLOW-630, RETRO-206).
 *
 * Panel rendered by /admin/settings (the /dashboard/settings wrapper went with FOLLOW-1335). It
 * previously had NO `!r.ok` guard, so a non-2xx body was parsed as config and
 * the `claude-sonnet-4-6` default rendered as if it were the real stored global
 * model. A staff Save from that state would PUT the default, resetting the
 * GLOBAL generation model and busting the description cache (Rule K.2
 * consumer-side clause). A failed GET must now render a role="alert" state and
 * disable Save.
 *
 * @module apps/control-plane/src/components/generation-model-settings.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import GenerationModelSettings from './generation-model-settings';

const SAMPLE_STATE = {
  generation_model: 'claude-opus-4-8',
  allowed_models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'],
  is_default: false,
  updated_at: '2026-07-24T10:00:00.000Z',
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

describe('GenerationModelSettings — FOLLOW-630 load-failure guard', () => {
  it('shows an error alert, disables Save, and issues no PUT when the initial GET returns 500', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { message: 'Internal error' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<GenerationModelSettings />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    const saveButton = screen.getByRole('button', { name: /save settings/i });
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

    render(<GenerationModelSettings />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save settings/i })).toHaveProperty(
        'disabled',
        false,
      );
    });
  });

  it('behaves unchanged when the GET succeeds (Save enabled, no error alert)', async () => {
    mockFetchOnce(SAMPLE_STATE);
    render(<GenerationModelSettings />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save settings/i })).toHaveProperty(
        'disabled',
        false,
      );
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('GenerationModelSettings — cost and time per model (FOLLOW-1377)', () => {
  const ALL_MODELS = [
    'claude-haiku-4-5-20251001',
    'claude-haiku-5-5',
    'claude-sonnet-4-6',
    'claude-sonnet-5-5',
    'claude-opus-4-8',
    'claude-opus-5-5',
    'claude-fable-5-1',
  ];

  it('renders one comparison row per allowed model with its note, cost and time', async () => {
    mockFetchOnce({ ...SAMPLE_STATE, allowed_models: ALL_MODELS });
    render(<GenerationModelSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('model-hint-claude-fable-5-1')).toBeDefined();
    });
    for (const m of ALL_MODELS) {
      expect(screen.getByTestId(`model-hint-${m}`)).toBeDefined();
    }
    // Measured tokens × llm-pricing list prices; median measured seconds (generation-models.ts).
    const sonnet = screen.getByTestId('model-hint-claude-sonnet-4-6').textContent;
    expect(sonnet).toBe('Sonnet 4.6Previous default; balanced≈ $0.03≈ 13 s');
    // FOLLOW-1387: the default label moved to Sonnet 5.5.
    expect(screen.getByTestId('model-hint-claude-sonnet-5-5').textContent).toContain(
      'Default; thinking off, low effort',
    );
    const haiku55 = screen.getByTestId('model-hint-claude-haiku-5-5').textContent;
    expect(haiku55).toContain('≈ $0.001'); // three decimals below a cent, never "$0.00"
    expect(haiku55).toContain('≈ 4 s');
    expect(screen.getByTestId('model-hint-claude-fable-5-1').textContent).toContain('≈ $0.16');
  });

  it('labels each dropdown option with its cost and time', async () => {
    mockFetchOnce({ ...SAMPLE_STATE, allowed_models: ALL_MODELS });
    render(<GenerationModelSettings />);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /^Opus 5\.5 — / })).toBeDefined();
    });
    expect(screen.getByRole('option', { name: /^Opus 5\.5 — / }).textContent).toBe(
      'Opus 5.5 — ≈ $0.06 / description · ≈ 14 s',
    );
  });

  it('shows an id the catalog does not know as the bare id, with no invented numbers', async () => {
    mockFetchOnce({ ...SAMPLE_STATE, allowed_models: ['claude-unknown-9'] });
    render(<GenerationModelSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('model-hint-claude-unknown-9').textContent).toBe(
        'claude-unknown-9———',
      );
    });
  });
});
