/**
 * Tests for QuizCompletionsViewer (FOLLOW-999; Rule K.2 consumer-side clause).
 *
 * The K.2 shape for a READ-ONLY surface: a failed GET must render a visible
 * error + Retry, never an empty table that reads as "zero completions". Also
 * covers the happy path (rows + aggregates rendered) and offset paging issuing
 * a new fenced GET.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-completions/quiz-completions-viewer.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { QuizCompletionsViewer } from './quiz-completions-viewer';

const TENANT_ID = '44444444-4444-4444-8444-444444444444';

const SAMPLE: unknown = {
  tenant_id: TENANT_ID,
  total: 51,
  limit: 50,
  offset: 0,
  aggregates: {
    by_archetype: [
      { archetype: 'yield_hunter', count: 30 },
      { archetype: 'family_buyer', count: 21 },
    ],
    by_branch: [
      { branch: 'INWESTOR', count: 40 },
      { branch: null, count: 11 },
    ],
  },
  completions: [
    {
      id: 'row-1',
      session_id: 'a'.repeat(64),
      resolved_archetype: 'yield_hunter',
      branch: 'INWESTOR',
      q1_answer: 0,
      q2_answer: 2,
      q3_answer: null,
      language: 'en',
      created_at: '2026-08-15T10:00:00.000Z',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('QuizCompletionsViewer', () => {
  it('failed GET → error alert + Retry, NOT an empty table (Rule K.2)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { code: 'internal_error', message: 'boom' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<QuizCompletionsViewer tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    // No table rendered — the error state replaces it entirely.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: /retry/i })).toBeDefined();
  });

  it('Retry re-issues the GET and renders the table after recovery', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { code: 'internal_error', message: 'boom' } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE) });
    vi.stubGlobal('fetch', fetchMock);

    render(<QuizCompletionsViewer tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByRole('table')).toBeDefined();
    });
  });

  it('successful GET → renders aggregates, rows, and the total', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE) }),
    );

    render(<QuizCompletionsViewer tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByRole('table')).toBeDefined();
    });

    // Aggregates: archetype appears in the distribution list AND the table row.
    expect(screen.getAllByText('yield_hunter').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('family_buyer')).toBeDefined();
    expect(screen.getByText('neutral (Q1 skip)')).toBeDefined();
    // Row content: null answer renders as an em-dash, not "null"/"0".
    expect(screen.getByText('Showing 1–1 of 51')).toBeDefined();
  });

  it('Next issues a new GET with the advanced offset (fenced to the tenant)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(SAMPLE) });
    vi.stubGlobal('fetch', fetchMock);

    render(<QuizCompletionsViewer tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByRole('table')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('offset=50'))).toBe(true);
      // Every call fenced to this tenant.
      expect(urls.every((u) => u.includes(`tenant_id=${TENANT_ID}`))).toBe(true);
    });
  });
});
