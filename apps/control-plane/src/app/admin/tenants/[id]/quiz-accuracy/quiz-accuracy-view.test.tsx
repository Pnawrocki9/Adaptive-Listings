/**
 * Tests for QuizAccuracyView (FOLLOW-1363; Rule K.2 consumer-side clause). The response is built
 * with the real `buildQuizAccuracyReport`, so the view is exercised against the route's own type.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-accuracy/quiz-accuracy-view.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { buildQuizAccuracyReport, type AccuracyRun } from '@/lib/quiz-accuracy';
import type { QuizAccuracyResponse } from '@/app/api/admin/tenants/quiz-accuracy/route';
import { QuizAccuracyView } from './quiz-accuracy-view';

const TENANT_ID = '44444444-4444-4444-8444-444444444444';

function runs(n: number, correct: number): AccuracyRun[] {
  return Array.from({ length: n }, (_, i) => ({
    status: i < correct ? ('confirmed' as const) : ('corrected' as const),
    resolved_archetype: 'yield_hunter',
    confirmed_archetype: i < correct ? 'yield_hunter' : 'none_of_these',
    language: 'en',
    month: '2026-11',
    step_total_ms: 9000,
    result_ms: 4000,
  }));
}

function response(
  n: number,
  correct: number,
  language: string | null = null,
): QuizAccuracyResponse {
  return {
    available: true,
    data_source: 'quiz_runs',
    tenant_id: TENANT_ID,
    rows_truncated: false,
    ...buildQuizAccuracyReport({
      definitionHash: 'a'.repeat(64),
      hashes: [{ hash: 'a'.repeat(64), version: 2, n }],
      runs: runs(n, correct),
      funnelRows: [
        { month: '2026-11', status: 'completed', neutral: false, last_step: null, count: n },
      ],
      filters: { from: null, to: null, language },
    }),
  };
}

function mockFetch(body: unknown, ok = true): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('QuizAccuracyView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders headline, verdict, funnel, per-leaf, confusion and the none_of_these column', async () => {
    const fetchFn = mockFetch(response(400, 372));
    render(<QuizAccuracyView tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('verdict').textContent).toBe('PASS');
    });
    expect(String(fetchFn.mock.calls[0]![0])).toContain(`tenant_id=${TENANT_ID}`);
    expect(screen.getByTestId('headline').textContent).toContain('372 / 400 confirmed');
    expect(screen.getByTestId('headline').textContent).toContain('n = 400 of 400 required');
    expect(screen.getByTestId('funnel').textContent).toContain('400');
    expect(screen.getByTestId('per-leaf').textContent).toContain('yield_hunter');
    expect(screen.getByTestId('confusion').textContent).toContain('none_of_these');
    expect(screen.getByTestId('response-rate').textContent).toContain('valid');
    expect(screen.getByTestId('fast-yes').textContent).toContain('never excluded');
    expect(screen.getByTestId('monthly').textContent).toContain('2026-11');
  });

  it('shows INSUFFICIENT_N and n vs 400 for a small sample', async () => {
    mockFetch(response(40, 38));
    render(<QuizAccuracyView tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('verdict').textContent).toBe('INSUFFICIENT_N');
    });
    expect(screen.getByTestId('headline').textContent).toContain('n = 40 of 400 required');
  });

  it('marks a filtered subset as not the pre-registered analysis', async () => {
    mockFetch(response(400, 372, 'pl'));
    render(<QuizAccuracyView tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByText(/NOT the pre-registered analysis/)).toBeDefined();
    });
  });

  it('language selector issues a new fenced GET', async () => {
    const fetchFn = mockFetch(response(400, 372));
    render(<QuizAccuracyView tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('verdict')).toBeDefined();
    });
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'pl' } });
    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
    const url = String(fetchFn.mock.calls[1]![0]);
    expect(url).toContain(`tenant_id=${TENANT_ID}`);
    expect(url).toContain('language=pl');
  });

  it('renders an explicit not-set-up state when quiz_runs is missing', async () => {
    mockFetch({
      available: false,
      data_source: 'quiz_runs',
      tenant_id: TENANT_ID,
      code: 'quiz_runs_table_missing',
      message: 'quiz_runs does not exist: apply docs/handover/migrations/H002_quiz_runs.sql',
    });
    render(<QuizAccuracyView tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('H002_quiz_runs.sql');
    });
    expect(screen.queryByTestId('verdict')).toBeNull();
  });

  it('a failed GET renders an alert with Retry, never an empty report', async () => {
    mockFetch({}, false);
    render(<QuizAccuracyView tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Failed to load');
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    expect(screen.queryByTestId('verdict')).toBeNull();
  });
});
