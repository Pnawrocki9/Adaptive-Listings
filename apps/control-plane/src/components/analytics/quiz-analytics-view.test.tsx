/**
 * Tests for the real quiz analytics dashboard page (FOLLOW-1000; Rule K.2
 * consumer-side clause).
 *
 * Replaces the deleted mock-data suite (`quiz.test.ts`), whose only subject was
 * the fabricated QUIZ_STATS/DAILY_COMPLETIONS constants. This suite drives the
 * page against a mocked `GET /api/quiz/analytics`:
 *   - failed GET → visible error + Retry, never zeroes (K.2)
 *   - happy path → real numbers rendered; NO impressions/completion-rate
 *     fabrications anywhere in the output
 *   - zero-day gap filling → the daily chart always renders the full window
 *
 * @module apps/control-plane/src/app/dashboard/quiz/analytics/page.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import QuizAnalyticsPage from './page';

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const SAMPLE: unknown = {
  tenant_id: 'tenant-uuid',
  total_completions: 89,
  completions_30d: 34,
  daily: [
    { day: isoDaysAgo(1), count: 5 },
    { day: isoDaysAgo(0), count: 7 },
  ],
  by_archetype: [
    { archetype: 'yield_hunter', count: 59 },
    { archetype: 'family_buyer', count: 30 },
  ],
  by_branch: [
    { branch: 'INWESTOR', count: 80 },
    { branch: null, count: 9 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('QuizAnalyticsPage (real data, FOLLOW-1000)', () => {
  it('failed GET → error alert + Retry, never zeroes rendered as data (Rule K.2)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { code: 'internal_error', message: 'boom' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<QuizAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    // No stat tiles rendered from a failed load.
    expect(screen.queryByText('Completions (all time)')).toBeNull();
    expect(screen.getByRole('button', { name: /retry/i })).toBeDefined();
  });

  it('Retry re-issues the GET and renders real numbers after recovery', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { code: 'internal_error', message: 'boom' } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE) });
    vi.stubGlobal('fetch', fetchMock);

    render(<QuizAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByText('89')).toBeDefined();
    });
  });

  it('renders real totals and distributions; NO fabricated impressions/rate/lift', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE) }),
    );

    render(<QuizAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByText('89')).toBeDefined();
    });
    expect(screen.getByText('34')).toBeDefined();
    expect(screen.getByText('yield_hunter')).toBeDefined();
    expect(screen.getByText('Investor')).toBeDefined();
    expect(screen.getByText('Neutral (Q1 skip)')).toBeDefined();

    // The mock's fabricated metrics must NOT reappear as stat tiles. The word
    // "Impressions" appears only inside the explanatory note about WHY there is
    // no such metric — assert the tile labels are gone.
    expect(screen.queryByText('Completion Rate')).toBeNull();
    expect(screen.queryByText('Inquiry Lift')).toBeNull();
    expect(screen.queryByText(/mock data/i)).toBeNull();
  });

  it('fills zero-count days so the daily chart covers the full 14-day window', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE) }),
    );

    render(<QuizAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Daily Completions/)).toBeDefined();
    });
    // 14 day columns rendered even though the API returned only 2 non-zero days:
    // each column carries its day as a title attribute.
    const columns = document.querySelectorAll('[title]');
    expect(columns.length).toBe(14);
  });
});
