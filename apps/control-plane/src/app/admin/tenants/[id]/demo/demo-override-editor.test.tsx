/**
 * Tests for StaffDemoOverrideEditor (FOLLOW-624, ESC-039, RETRO-205 §4a LG-1).
 *
 * A failed GET must be visibly distinguishable from a successful load, and
 * must NOT allow a Save that would clobber the tenant's real stored demo
 * override with the component's DEFAULTS.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/demo/demo-override-editor.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { StaffDemoOverrideEditor } from './demo-override-editor';

const TENANT_ID = '33333333-3333-4333-8333-333333333333';

const SAMPLE_STATE = {
  enabled: false,
  override_archetype: null,
  override_model: 'claude-sonnet-4-6',
  archetypes: ['neutral', 'family_buyer'],
  models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
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

describe('StaffDemoOverrideEditor', () => {
  it('shows an error alert and disables Save when the initial GET fails, and issues no PUT', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { code: 'internal_error', message: 'boom' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffDemoOverrideEditor tenantId={TENANT_ID} />);

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
        json: () => Promise.resolve({ error: { code: 'internal_error', message: 'boom' } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE_STATE) });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffDemoOverrideEditor tenantId={TENANT_ID} />);

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
    render(<StaffDemoOverrideEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save settings/i })).toHaveProperty(
        'disabled',
        false,
      );
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
