/**
 * RTL tests for ListingAnswersManager — the per-listing FAQ answer UI shared by the agency page and
 * `/admin/tenants/[id]/listings/[listingId]/answers` (FOLLOW-1334).
 *
 * Covers: load (list, empty, error), add, edit, delete, and that EVERY call targets the tenant
 * passed as a prop (`/api/tenants/:tenantId/answers`).
 *
 * @module apps/control-plane/src/components/listing-answers-manager.test
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ListingAnswersManager } from './listing-answers-manager';

const TENANT = '550e8400-e29b-41d4-a716-446655440001';
const LISTING = 'listing-001';

const ROW = {
  id: 'answer-1',
  tenantId: TENANT,
  listingId: LISTING,
  question: 'What is the yield?',
  answer: '6.5% gross.',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
};

function ok(body: unknown, status = 200) {
  return { ok: true, status, json: () => Promise.resolve(body) };
}
function fail(status: number, error: string) {
  return { ok: false, status, json: () => Promise.resolve({ error }) };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ListingAnswersManager', () => {
  it('lists the answers of THIS tenant and listing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([ROW]));
    vi.stubGlobal('fetch', fetchMock);

    render(<ListingAnswersManager tenantId={TENANT} listingId={LISTING} />);

    await waitFor(() => {
      expect(screen.getByText('What is the yield?')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(`/api/tenants/${TENANT}/answers?listing_id=${LISTING}`);
    expect(screen.getByText('6.5% gross.')).toBeInTheDocument();
  });

  it('url-encodes the listing id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([]));
    vi.stubGlobal('fetch', fetchMock);

    render(<ListingAnswersManager tenantId={TENANT} listingId="a/b c" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`/api/tenants/${TENANT}/answers?listing_id=a%2Fb%20c`);
    });
  });

  it('renders the empty state when the listing has no answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([])));

    render(<ListingAnswersManager tenantId={TENANT} listingId={LISTING} />);

    await waitFor(() => {
      expect(screen.getByText(/No FAQ answers yet/)).toBeInTheDocument();
    });
  });

  it('a failed load shows the server error and no list (Rule K.2)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(403, 'Forbidden: tenant mismatch')));

    render(<ListingAnswersManager tenantId={TENANT} listingId={LISTING} />);

    await waitFor(() => {
      expect(screen.getByText('Forbidden: tenant mismatch')).toBeInTheDocument();
    });
    expect(screen.queryByText(/No FAQ answers yet/)).not.toBeInTheDocument();
  });

  it('a network failure shows a refresh hint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    render(<ListingAnswersManager tenantId={TENANT} listingId={LISTING} />);

    await waitFor(() => {
      expect(screen.getByText('Network error. Please refresh.')).toBeInTheDocument();
    });
  });

  it('adds an answer with POST to the tenant path, then reloads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok(ROW, 201))
      .mockResolvedValueOnce(ok([ROW]));
    vi.stubGlobal('fetch', fetchMock);

    render(<ListingAnswersManager tenantId={TENANT} listingId={LISTING} />);
    await waitFor(() => {
      expect(screen.getByText(/No FAQ answers yet/)).toBeInTheDocument();
    });

    const [q, a] = screen.getAllByRole('textbox') as [HTMLElement, HTMLElement];
    fireEvent.change(q, { target: { value: 'What is the yield?' } });
    fireEvent.change(a, { target: { value: '6.5% gross.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Answer' }));

    await waitFor(() => {
      expect(screen.getByText('6.5% gross.')).toBeInTheDocument();
    });
    const post = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(post[0]).toBe(`/api/tenants/${TENANT}/answers`);
    expect(post[1].method).toBe('POST');
    expect(JSON.parse(post[1].body as string)).toEqual({
      listing_id: LISTING,
      question: 'What is the yield?',
      answer: '6.5% gross.',
    });
  });

  it('shows the server message when the add is rejected (e.g. staff readonly 403)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(ok([]))
        .mockResolvedValueOnce(fail(403, 'Forbidden: staff write requires estalara:ops or higher')),
    );

    render(<ListingAnswersManager tenantId={TENANT} listingId={LISTING} />);
    await waitFor(() => {
      expect(screen.getByText(/No FAQ answers yet/)).toBeInTheDocument();
    });
    const [q, a] = screen.getAllByRole('textbox') as [HTMLElement, HTMLElement];
    fireEvent.change(q, { target: { value: 'Q?' } });
    fireEvent.change(a, { target: { value: 'A.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Answer' }));

    await waitFor(() => {
      expect(
        screen.getByText('Forbidden: staff write requires estalara:ops or higher'),
      ).toBeInTheDocument();
    });
  });

  it('edits an answer with PATCH to the answer path', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok([ROW]))
      .mockResolvedValueOnce(ok({ ...ROW, answer: '7% gross.' }))
      .mockResolvedValueOnce(ok([{ ...ROW, answer: '7% gross.' }]));
    vi.stubGlobal('fetch', fetchMock);

    render(<ListingAnswersManager tenantId={TENANT} listingId={LISTING} />);
    await waitFor(() => {
      expect(screen.getByText('6.5% gross.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const boxes = screen.getAllByRole('textbox');
    fireEvent.change(boxes[boxes.length - 1]!, { target: { value: '7% gross.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('7% gross.')).toBeInTheDocument();
    });
    const patch = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(patch[0]).toBe(`/api/tenants/${TENANT}/answers/answer-1`);
    expect(patch[1].method).toBe('PATCH');
  });

  it('deletes an answer with DELETE to the answer path (204)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok([ROW]))
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.reject(new Error('empty')),
      })
      .mockResolvedValueOnce(ok([]));
    vi.stubGlobal('fetch', fetchMock);

    render(<ListingAnswersManager tenantId={TENANT} listingId={LISTING} />);
    await waitFor(() => {
      expect(screen.getByText('What is the yield?')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.getByText(/No FAQ answers yet/)).toBeInTheDocument();
    });
    const del = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(del[0]).toBe(`/api/tenants/${TENANT}/answers/answer-1`);
    expect(del[1].method).toBe('DELETE');
  });
});
