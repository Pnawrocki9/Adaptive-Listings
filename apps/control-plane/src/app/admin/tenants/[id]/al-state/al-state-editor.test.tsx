/**
 * Tests for StaffAlStateEditor (FOLLOW-633; Rule K.2 consumer-side clause,
 * mirroring FOLLOW-624/630 editors).
 *
 * A failed GET must be visibly distinguishable from a successful load and must
 * NOT allow a Save that would clobber the tenant's real stored `al_enabled` with
 * the component's default — the exact swallow-then-Save-defaults class the repo
 * eliminated (scripts/check-k2-consumer-swallow.cjs enforces the shape).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/al-state/al-state-editor.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { StaffAlStateEditor } from './al-state-editor';

const TENANT_ID = '44444444-4444-4444-8444-444444444444';

const SAMPLE_STATE = { al_enabled: true, status: 'active' };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StaffAlStateEditor', () => {
  it('failed GET → error alert, Save disabled, and NO mutating PUT is issued', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { code: 'internal_error', message: 'boom' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffAlStateEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toHaveProperty('disabled', true);

    fireEvent.click(saveButton);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // No PUT — a failed load must never turn into a Save that writes a default back.
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('Retry re-issues the GET and re-enables Save after a failed load', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { code: 'internal_error', message: 'boom' } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE_STATE) });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffAlStateEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toHaveProperty('disabled', false);
    });
  });

  it('successful GET → Save enabled, no error alert, toggle reflects stored state', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE_STATE) }),
    );
    render(<StaffAlStateEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toHaveProperty('disabled', false);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    const toggle = screen.getByTestId('al-enabled-toggle');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('successful GET → PUT carries the flipped al_enabled value', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE_STATE) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ al_enabled: false, status: 'active' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffAlStateEditor tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toHaveProperty('disabled', false);
    });

    fireEvent.click(screen.getByTestId('al-enabled-toggle')); // true → false
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'PUT',
      );
      expect(putCall).toBeDefined();
      expect(JSON.parse((putCall![1] as { body: string }).body)).toEqual({ al_enabled: false });
    });
  });
});
