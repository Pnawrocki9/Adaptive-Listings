/**
 * Unit tests for the description route's listing read (ESC-018 / ADR-0009; FOLLOW-1314):
 * `fetchDescriptionGrounding` over the real `fetchListingTextFields` / `fetchListingJson`, with
 * only the network stubbed. Until FOLLOW-1314 these pinned `fetchListingOriginalDescription`, which
 * read the description alone; the URL and fail-open expectations are unchanged.
 *
 * @module apps/control-plane/src/lib/listing-details.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchDescriptionGrounding } from './listing-facts-context';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fetchDescriptionGrounding — the description', () => {
  it('hits the by-uuid endpoint for a UUID listing id and returns the description', async () => {
    vi.stubEnv('ESTALARA_BACKEND_URL', 'https://backend.test');
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ description: 'A bright two-bed flat.' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchDescriptionGrounding(UUID, 'en');

    expect(result.originalDescription).toBe('A bright two-bed flat.');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = String(mockFetch.mock.calls[0]![0]);
    expect(calledUrl).toBe(
      `https://backend.test/api/v1/listing/details?listing-uuid=${UUID}&locale=EN`,
    );
  });

  it('hits the slug endpoint for a non-UUID listing id and upper-cases the locale', async () => {
    vi.stubEnv('ESTALARA_BACKEND_URL', 'https://backend.test/');
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ description: 'Casa luminosa.' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchDescriptionGrounding('9-blackberry-pl', 'es');

    expect(result.originalDescription).toBe('Casa luminosa.');
    const calledUrl = String(mockFetch.mock.calls[0]![0]);
    expect(calledUrl).toBe(
      'https://backend.test/api/v1/listing/details/slug?slug=9-blackberry-pl&locale=ES',
    );
  });

  it('returns "" and no fields on a non-2xx response (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    expect(await fetchDescriptionGrounding('prop-1', 'en')).toEqual({
      originalDescription: '',
      fields: {},
    });
  });

  it('returns "" on a network error (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect((await fetchDescriptionGrounding('prop-1', 'en')).originalDescription).toBe('');
  });

  it('returns "" when the payload has no string description field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: 'x' }), { status: 200 })),
    );
    expect((await fetchDescriptionGrounding('prop-1', 'en')).originalDescription).toBe('');
  });

  it('returns "" on malformed JSON (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{not json', { status: 200 })));
    expect((await fetchDescriptionGrounding('prop-1', 'en')).originalDescription).toBe('');
  });
});

describe('fetchDescriptionGrounding — the listing fields (FOLLOW-1314)', () => {
  it('reads title, price and location from the SAME fetch, under the /api/adapt key names', async () => {
    // The fixture listing's payload as `scripts/dev/fixture-listing-details-server.mjs` serves it.
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          uuid: '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c',
          headline: '9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath',
          description: 'A three-bedroom, two-bathroom single-family home.',
          price: 385000,
          currency: 'USD',
          streetAddress: '9 Blackberry Pl',
          city: 'Palm Coast',
          region: 'FL',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchDescriptionGrounding('839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c', 'en');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      originalDescription: 'A three-bedroom, two-bathroom single-family home.',
      fields: {
        listing_title: '9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath',
        listing_price: '385000 USD',
        listing_location: '9 Blackberry Pl, Palm Coast, FL',
      },
    });
    // The description travels once, as original_description — never duplicated into the fields.
    expect(result.fields).not.toHaveProperty('listing_description');
  });

  it('serves no field the payload does not carry', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ description: 'A flat.', city: 'Jávea' }), { status: 200 }),
        ),
    );
    expect(await fetchDescriptionGrounding('prop-1', 'en')).toEqual({
      originalDescription: 'A flat.',
      fields: { listing_location: 'Jávea' },
    });
  });
});
