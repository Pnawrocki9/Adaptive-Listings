/**
 * FOLLOW-1022 — the adapt LLM path must be given the listing's own facts.
 *
 * Guards the four properties the production incident turned on:
 *   1. On an LLM branch WITH a listing id, the listing's facts reach the context (the whole
 *      point — without them every figure the model writes is ungrounded and FOLLOW-457's fact
 *      check discards the batch).
 *   2. On the playbook-direct branch (similarity above the ceiling) nothing is fetched — the
 *      fast path must not grow a network hop.
 *   3. Agency-curated RAG answers beat the backend's raw field on a key clash.
 *   4. Fail-open: an unreachable/unknown listing degrades to the RAG context, never an error.
 *
 * @module apps/control-plane/src/lib/__tests__/listing-facts-context.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { withListingFacts } from '../listing-facts-context';
import { fetchListingTextFields } from '../listing-details';

vi.mock('../listing-details', () => ({
  fetchListingTextFields: vi.fn(),
}));

const mockFetchFields = vi.mocked(fetchListingTextFields);

const LISTING = {
  title: 'Blackberry Lane Colonial',
  description: 'Four bedrooms, two-car garage, fenced garden.',
  price: '525000 USD',
  location: '9 Blackberry Pl, Palm Coast, FL',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withListingFacts', () => {
  it('merges the listing facts into the context on an LLM branch', async () => {
    mockFetchFields.mockResolvedValue(LISTING);

    const ctx = await withListingFacts({}, 'listing-abc', 0.75, 'en');

    expect(ctx).toEqual({
      listing_title: LISTING.title,
      listing_description: LISTING.description,
      listing_price: LISTING.price,
      listing_location: LISTING.location,
    });
    expect(mockFetchFields).toHaveBeenCalledWith('listing-abc', 'en');
  });

  it('also enriches the full-generation branch (similarity at the low end)', async () => {
    mockFetchFields.mockResolvedValue(LISTING);

    const ctx = await withListingFacts({}, 'listing-abc', 0.2, 'en');

    expect(ctx.listing_price).toBe(LISTING.price);
  });

  it('does NOT fetch on the playbook-direct branch — that path never calls the LLM', async () => {
    const ctx = await withListingFacts({ faq: 'a' }, 'listing-abc', 0.95, 'en');

    expect(mockFetchFields).not.toHaveBeenCalled();
    expect(ctx).toEqual({ faq: 'a' });
  });

  it('does NOT fetch when the caller sent no listing id', async () => {
    const ctx = await withListingFacts({ faq: 'a' }, undefined, 0.5, 'en');

    expect(mockFetchFields).not.toHaveBeenCalled();
    expect(ctx).toEqual({ faq: 'a' });
  });

  it('lets an agency-curated answer win over the backend field on a key clash', async () => {
    mockFetchFields.mockResolvedValue(LISTING);

    const ctx = await withListingFacts(
      { listing_price: '499000 USD (negotiated)' },
      'listing-abc',
      0.75,
      'en',
    );

    expect(ctx.listing_price).toBe('499000 USD (negotiated)');
    expect(ctx.listing_title).toBe(LISTING.title);
  });

  it('fails open to the RAG context when the listing cannot be read', async () => {
    mockFetchFields.mockResolvedValue(null);

    const ctx = await withListingFacts({ faq: 'a' }, 'listing-abc', 0.75, 'en');

    expect(ctx).toEqual({ faq: 'a' });
  });

  it('forwards the request locale to the backend', async () => {
    mockFetchFields.mockResolvedValue(LISTING);

    await withListingFacts({}, 'listing-abc', 0.75, 'pl');

    expect(mockFetchFields).toHaveBeenCalledWith('listing-abc', 'pl');
  });

  it('omits keys the backend did not supply rather than writing empty strings', async () => {
    mockFetchFields.mockResolvedValue({ title: 'Only a title' });

    // 0.85 = the ceiling itself: inclusive, so this is still an LLM branch.
    const ctx = await withListingFacts({}, 'listing-abc', 0.85, 'en');

    expect(ctx).toEqual({ listing_title: 'Only a title' });
  });
});
