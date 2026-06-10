/**
 * Tests for FOLLOW-102 AC5: quiz ON/OFF toggle in /dashboard/quiz.
 *
 * Verifies:
 *   1. Toggle renders current quiz_enabled state from GET /api/quiz/config.
 *   2. Toggle action calls PATCH /api/tenants/:id with the correct payload.
 *
 * @module apps/control-plane/src/app/dashboard/quiz/quiz-toggle.test
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(...responses: { body: unknown; ok?: boolean; status?: number }[]): void {
  let callIndex = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    const response: { body: unknown; ok?: boolean; status?: number } = responses[callIndex] ??
      responses[responses.length - 1] ?? { body: {} };
    callIndex += 1;
    const status = response.status ?? (response.ok !== false ? 200 : 400);
    return Promise.resolve(
      new Response(JSON.stringify(response.body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('QuizSettingsPage — FOLLOW-102 AC5 quiz ON/OFF toggle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // AC5 test 1: toggle renders current state (quiz_enabled=false → OFF)
  it('renders toggle in OFF state when GET /api/quiz/config returns quiz_enabled=false', async () => {
    mockFetch({
      body: {
        enabled: false,
        trigger_after_n_listings: 3,
        sticky_widget: false,
        language: 'en',
        accent_color: '#2563EB',
        quiz_enabled: false,
        tenant_id: 'tenant-uuid-001',
      },
    });

    render(<QuizSettingsPage />);

    const toggle = await screen.findByTestId('quiz-enabled-toggle');
    // When quiz_enabled=false, aria-pressed should be false
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('aria-label', 'Enable quiz widget');
  });

  // AC5 test 1b: toggle renders current state (quiz_enabled=true → ON)
  it('renders toggle in ON state when GET /api/quiz/config returns quiz_enabled=true', async () => {
    mockFetch({
      body: {
        enabled: true,
        trigger_after_n_listings: 3,
        sticky_widget: false,
        language: 'en',
        accent_color: '#2563EB',
        quiz_enabled: true,
        tenant_id: 'tenant-uuid-001',
      },
    });

    render(<QuizSettingsPage />);

    const toggle = await screen.findByTestId('quiz-enabled-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAttribute('aria-label', 'Disable quiz widget');
  });

  // AC5 test 2: toggle action calls PATCH /api/tenants/:id with correct payload
  it('calls PATCH /api/tenants/:id with quiz_enabled=false when toggling OFF', async () => {
    // First call: GET /api/quiz/config (quiz_enabled=true initially)
    // Second call: PATCH /api/tenants/:id
    mockFetch(
      {
        body: {
          quiz_enabled: true,
          tenant_id: 'tenant-uuid-001',
          enabled: true,
          trigger_after_n_listings: 3,
          sticky_widget: false,
          language: 'en',
          accent_color: '#2563EB',
        },
      },
      {
        body: { id: 'tenant-uuid-001', quiz_enabled: false },
        ok: true,
      },
    );

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(<QuizSettingsPage />);

    // Wait for the toggle to load
    const toggle = await screen.findByTestId('quiz-enabled-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // Click to toggle OFF
    fireEvent.click(toggle);

    await waitFor(() => {
      // The PATCH call should be the second fetch call (after the initial GET)
      const patchCall = fetchSpy.mock.calls.find((call) => call[1]?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const [url, options] = patchCall as [string, RequestInit];
      expect(url).toContain('/api/tenants/tenant-uuid-001');
      expect(JSON.parse(options.body as string)).toEqual({ quiz_enabled: false });
    });
  });

  // AC5 test 2b: toggle OFF → ON calls PATCH with quiz_enabled=true
  it('calls PATCH /api/tenants/:id with quiz_enabled=true when toggling ON from OFF', async () => {
    mockFetch(
      {
        body: {
          quiz_enabled: false,
          tenant_id: 'tenant-uuid-002',
          enabled: false,
          trigger_after_n_listings: 3,
          sticky_widget: false,
          language: 'en',
          accent_color: '#2563EB',
        },
      },
      {
        body: { id: 'tenant-uuid-002', quiz_enabled: true },
        ok: true,
      },
    );

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(<QuizSettingsPage />);

    const toggle = await screen.findByTestId('quiz-enabled-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find((call) => call[1]?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const [, options] = patchCall as [string, RequestInit];
      expect(JSON.parse(options.body as string)).toEqual({ quiz_enabled: true });
    });
  });
});
