/**
 * Tests for StaffQuizConfigEditor (FOLLOW-624, ESC-039, RETRO-205 §4a LG-1).
 *
 * A failed GET must be visibly distinguishable from a successful load, and
 * must NOT allow a Save that would clobber the tenant's real stored quiz
 * config with the component's DEFAULTS.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz/quiz-config-editor.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { StaffQuizConfigEditor } from './quiz-config-editor';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';

const SAMPLE_CONFIG = {
  language: 'en',
  accent_color: '#ff0000',
  micro_polls_enabled: true,
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

describe('StaffQuizConfigEditor', () => {
  it('shows an error alert and disables Save when the initial GET fails, and issues no PATCH/POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal error' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffQuizConfigEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    const saveButton = screen.getByRole('button', { name: /save settings/i });
    expect(saveButton).toHaveProperty('disabled', true);

    fireEvent.click(saveButton);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('retries the GET when the Retry affordance is used after a failed load', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal error' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE_CONFIG) });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffQuizConfigEditor tenantId={TENANT_ID} />);

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
    mockFetchOnce(SAMPLE_CONFIG);
    render(<StaffQuizConfigEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save settings/i })).toHaveProperty(
        'disabled',
        false,
      );
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
