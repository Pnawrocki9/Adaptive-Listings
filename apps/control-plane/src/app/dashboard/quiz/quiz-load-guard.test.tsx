/**
 * Load-failure guard tests for /dashboard/quiz (FOLLOW-630, RETRO-206).
 *
 * The tenant-facing twin of the admin StaffQuizConfigEditor fixed in FOLLOW-624.
 * A failed GET must be visibly distinguishable from a successful load, and must
 * NOT allow a Save that would clobber the tenant's real stored quiz config with
 * the page's DEFAULTS (Rule K.2 consumer-side clause).
 *
 * @module apps/control-plane/src/app/dashboard/quiz/quiz-load-guard.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock next/link to avoid router dependency in tests.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import QuizSettingsPage from './page';

const SAMPLE_CONFIG = {
  language: 'en',
  accent_color: '#ff0000',
  micro_polls_enabled: true,
  quiz_enabled: true,
  tenant_id: 'tenant-uuid-001',
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

describe('QuizSettingsPage — FOLLOW-630 load-failure guard', () => {
  it('shows an error alert, disables Save, and issues no POST when the initial GET fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal error' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<QuizSettingsPage />);

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

    render(<QuizSettingsPage />);

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
    render(<QuizSettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save settings/i })).toHaveProperty(
        'disabled',
        false,
      );
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
