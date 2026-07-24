/**
 * Tests for StaffTenantConfigEditor (FOLLOW-600).
 *
 * MANDATORY (CEO Q1, ADR-0018 §5): `generation_model` is GLOBAL-only and MUST NOT
 * appear on this per-tenant surface (the dropped FOLLOW-601). The first test below
 * asserts this directly against the rendered DOM of the REAL component (not a
 * mock) after it has loaded its fetched config — the strongest form of this
 * assertion available without a full E2E browser test.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/settings/tenant-config-editor.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { StaffTenantConfigEditor } from './tenant-config-editor';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

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

const SAMPLE_CONFIG = {
  tenant_id: TENANT_ID,
  plan: 'observer',
  brand: { primary_color: '#1a73e8', logo_url: null, white_label: false },
  sdk: { allowed_origins: ['https://listings.example.com'] },
  updated_at: '2026-07-22T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StaffTenantConfigEditor', () => {
  it('renders plan, brand, and allowed-origins controls after loading', async () => {
    mockFetchOnce(SAMPLE_CONFIG);
    render(<StaffTenantConfigEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('observer')).toBeDefined();
    });
    expect(screen.getByTestId('white-label-toggle')).toBeDefined();
    expect(screen.getByTestId('allowed-origins-textarea')).toHaveProperty(
      'value',
      'https://listings.example.com',
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MANDATORY: no generation-model control anywhere in the rendered DOM
  // (CEO Q1, ADR-0018 §5 — the dropped FOLLOW-601).
  // ═══════════════════════════════════════════════════════════════════════
  it('never renders a generation-model control, label, or model name', async () => {
    mockFetchOnce(SAMPLE_CONFIG);
    render(<StaffTenantConfigEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('observer')).toBeDefined();
    });

    const bodyText = document.body.textContent;
    expect(bodyText).not.toMatch(/generation.model/i);
    expect(bodyText).not.toMatch(/claude-(sonnet|opus|haiku)/i);
    expect(screen.queryByRole('combobox', { name: /model/i })).toBeNull();
    expect(screen.queryByLabelText(/generation model/i)).toBeNull();
  });

  it('PATCHes brand + sdk.allowed_origins on save', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE_CONFIG) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            ...SAMPLE_CONFIG,
            brand: { ...SAMPLE_CONFIG.brand, white_label: true },
          }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffTenantConfigEditor tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByText('observer')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('white-label-toggle'));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const patchCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(patchCall[1].method).toBe('PATCH');
    const sentBody = JSON.parse(patchCall[1].body as string) as {
      brand: { white_label: boolean };
      sdk: { allowed_origins: string[] };
    };
    expect(sentBody.brand.white_label).toBe(true);
    expect(sentBody.sdk.allowed_origins).toEqual(['https://listings.example.com']);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FOLLOW-624 (ESC-039, RETRO-205 §4a LG-1): a failed GET must NOT be
  // swallowed into DEFAULTS-as-if-real, and must NOT allow a Save that would
  // clobber the tenant's real stored config.
  // ═══════════════════════════════════════════════════════════════════════
  it('shows an error alert and disables Save when the initial GET fails, and issues no PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { code: 'internal_error', message: 'boom' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffTenantConfigEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    const saveButton = screen.getByRole('button', { name: /save settings/i });
    expect(saveButton).toHaveProperty('disabled', true);

    // Attempting to submit the form must not reach the network with a PATCH.
    fireEvent.click(saveButton);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'PATCH' }),
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
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE_CONFIG) });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffTenantConfigEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText('observer')).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /save settings/i })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('surfaces route validation `details` in the save error banner', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE_CONFIG) })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: {
              code: 'validation_failed',
              message: 'Invalid request body',
              details: {
                formErrors: [],
                fieldErrors: { brand: ['logo_url must be a valid URL'] },
              },
            },
          }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffTenantConfigEditor tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByText('observer')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/logo_url must be a valid URL/);
    });
  });

  it('behaves unchanged when the GET succeeds (Save enabled, no error alert)', async () => {
    mockFetchOnce(SAMPLE_CONFIG);
    render(<StaffTenantConfigEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('observer')).toBeDefined();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /save settings/i })).toHaveProperty(
      'disabled',
      false,
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FOLLOW-627: the route's `data_source` provenance flag must be surfaced,
  // not merely received — a staff user must be able to tell defaults from
  // real stored config.
  // ═══════════════════════════════════════════════════════════════════════
  it('shows a defaults notice when GET returns data_source: "default" (no stored tenants row)', async () => {
    mockFetchOnce({ ...SAMPLE_CONFIG, plan: 'free', data_source: 'default' });
    render(<StaffTenantConfigEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('free')).toBeDefined();
    });
    expect(screen.getByRole('status').textContent).toMatch(/no stored configuration/i);
  });

  it('does NOT show the defaults notice when GET returns data_source: "stored"', async () => {
    mockFetchOnce({ ...SAMPLE_CONFIG, data_source: 'stored' });
    render(<StaffTenantConfigEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('observer')).toBeDefined();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
