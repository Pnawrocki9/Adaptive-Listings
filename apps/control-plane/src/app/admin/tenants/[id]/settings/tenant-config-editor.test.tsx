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
});
