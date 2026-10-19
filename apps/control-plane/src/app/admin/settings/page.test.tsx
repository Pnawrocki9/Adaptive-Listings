/**
 * Tests for /admin/settings (Platform Settings, staff zone).
 *
 * The page is a static server component with no data loader of its own: it renders the heading
 * and mounts the shared {@link GenerationModelSettings} panel, which loads the GLOBAL generation
 * model from `GET /api/admin/generation-model`. The panel is rendered for real here (only `fetch`
 * is stubbed) so the test covers the page as staff see it, including the K.2 rule: a failed load
 * is an error banner with Save disabled — never the default model presented as stored config.
 *
 * @module apps/control-plane/src/app/admin/settings/page.test
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import AdminSettingsPage from './page';

const STORED_STATE = {
  generation_model: 'claude-opus-4-8',
  allowed_models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'],
  is_default: false,
  updated_at: '2026-07-24T10:00:00.000Z',
};

describe('AdminSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the Platform Settings heading, its all-tenants scope note and the model panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(STORED_STATE) }),
    );

    render(<AdminSettingsPage />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Platform Settings');
    expect(screen.getByText('all tenants')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Content Generation Model' })).toBeDefined();
    // Let the panel's mount-time GET settle so state updates stay inside the test.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save settings/i })).toHaveProperty(
        'disabled',
        false,
      );
    });
  });

  it('shows the STORED global model once the GET succeeds, not the built-in default', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(STORED_STATE) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Generation Model')).toHaveProperty('value', 'claude-opus-4-8');
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/generation-model');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders an error banner and disables Save when the GET fails (K.2: no default shown as data)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { message: 'Internal error' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminSettingsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Failed to load the generation model setting');
    expect(alert.textContent).toContain('HTTP 500');
    expect(screen.getByRole('button', { name: /save settings/i })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /retry/i })).toBeDefined();
    // The page itself still renders: only the panel reports the failure.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Platform Settings');
  });

  it('renders the same error banner when the request itself rejects (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    render(<AdminSettingsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('network down');
    expect(screen.getByRole('button', { name: /save settings/i })).toHaveProperty('disabled', true);
  });
});
