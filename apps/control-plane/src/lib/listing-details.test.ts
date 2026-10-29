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
          publicLocationLabel: '9 Blackberry Pl',
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

/**
 * FOLLOW-1317 — the REAL backend's field names, read off `ListingResponseTO` in the product repo
 * (`core-master/src/main/kotlin/com/time2show/core/dto/ListingResponseTO.kt:81-91`: `price`,
 * `currency`, `priceEur`, `priceUsd`; `:36-59`: `city`, `district`, `publicLocationLabel`,
 * `region`, `zipcode` — and NO `streetAddress` anywhere on the public detail DTO).
 *
 * Both shapes must ground, because which one a given deployment answers with is not knowable from
 * here: the public mapper (`ListingServiceImpl.kt:945-948`) fills `price` + `currency` from the
 * agent's own entry and `priceEur`/`priceUsd` from the FX-derived columns, and any of the four can
 * be null on a real listing. Tolerance, never a swap.
 */
describe('fetchDescriptionGrounding — the real backend shape (FOLLOW-1317)', () => {
  function listing(body: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
    );
  }

  it('grounds price from priceEur and location from publicLocationLabel when the SoT pair is absent', async () => {
    listing({
      uuid: '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c',
      headline: 'Apartament z dwoma sypialniami',
      description: 'Jasne mieszkanie w kamienicy.',
      priceEur: 285000,
      priceUsd: 310000,
      publicLocationLabel: 'ul. Piotrkowska',
      district: 'Śródmieście',
      city: 'Łódź',
      region: 'łódzkie',
    });

    const result = await fetchDescriptionGrounding('839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c', 'pl');

    expect(result.fields.listing_price).toBe('285000 EUR');
    expect(result.fields.listing_location).toBe('ul. Piotrkowska, Śródmieście, Łódź, łódzkie');
  });

  it('prefers the agent-entered price + currency over the FX-derived columns', async () => {
    listing({
      description: 'A flat.',
      price: 1250000,
      currency: 'PLN',
      priceEur: 285000,
      priceUsd: 310000,
      city: 'Łódź',
    });

    expect((await fetchDescriptionGrounding('prop-1', 'pl')).fields.listing_price).toBe(
      '1250000 PLN',
    );
  });

  it('falls back to priceUsd when priceEur is absent too', async () => {
    listing({ description: 'A flat.', priceUsd: 385000, city: 'Palm Coast' });

    expect((await fetchDescriptionGrounding('prop-1', 'en')).fields.listing_price).toBe(
      '385000 USD',
    );
  });

  it('carries NO price at all when the listing carries none — never an invented figure', async () => {
    listing({
      headline: 'A home in Palm Coast',
      description: 'A three-bedroom home.',
      currency: 'USD',
      city: 'Palm Coast',
      region: 'FL',
    });

    const result = await fetchDescriptionGrounding('prop-1', 'en');

    expect(result.fields).not.toHaveProperty('listing_price');
    expect(result.fields.listing_location).toBe('Palm Coast, FL');
  });

  it('keeps a unit-less price only as the last resort (scraped draft: price, no currency, no FX)', async () => {
    listing({ description: 'A flat.', price: 385000, city: 'Palm Coast' });

    expect((await fetchDescriptionGrounding('prop-1', 'en')).fields.listing_price).toBe('385000');
  });

  it('grounds the location from publicLocationLabel + district, most specific part first', async () => {
    listing({
      description: 'Jasne mieszkanie.',
      publicLocationLabel: 'ul. Piotrkowska',
      district: 'Śródmieście',
      city: 'Łódź',
      region: 'łódzkie',
    });

    expect((await fetchDescriptionGrounding('prop-1', 'pl')).fields.listing_location).toBe(
      'ul. Piotrkowska, Śródmieście, Łódź, łódzkie',
    );
  });

  it('grounds the production shape: entered price + currency, the street inside the public label', async () => {
    // Field names and value shapes as `GET https://api.app.estalara.com/api/v1/listing/all`
    // answered on 2026-10-29 (no `streetAddress`, no FX columns on that endpoint; the street, when
    // the listing discloses one, is part of `publicLocationLabel`).
    listing({
      description: 'A single-family home.',
      price: 259900.0,
      currency: 'USD',
      city: 'Fort Pierce',
      publicLocationLabel: '1512 N 42ND Street, Fort Pierce, FL 34947',
      locationDisclosureLevel: 'DISTRICT',
    });

    const result = await fetchDescriptionGrounding('prop-1', 'en');

    expect(result.fields.listing_price).toBe('259900 USD');
    expect(result.fields.listing_location).toBe('1512 N 42ND Street, Fort Pierce, FL 34947');
  });

  it('does not read a `streetAddress` field: the backend DTO has none', async () => {
    listing({ description: 'A flat.', streetAddress: '9 Blackberry Pl', city: 'Palm Coast' });

    expect((await fetchDescriptionGrounding('prop-1', 'en')).fields.listing_location).toBe(
      'Palm Coast',
    );
  });

  it('skips a repeated part only as whole words, never as a substring of a street name', async () => {
    listing({
      description: 'Mieszkanie.',
      publicLocationLabel: 'ul. Lodzka 4',
      city: 'Lodz',
    });

    expect((await fetchDescriptionGrounding('prop-1', 'pl')).fields.listing_location).toBe(
      'ul. Lodzka 4, Lodz',
    );
  });

  it('skips district and city the public label already names (production: "Tróia, Grândola, Setúbal")', async () => {
    listing({
      description: 'A villa.',
      publicLocationLabel: 'Tróia, Grândola, Setúbal',
      district: 'Tróia',
      city: 'Grândola',
    });

    expect((await fetchDescriptionGrounding('prop-1', 'en')).fields.listing_location).toBe(
      'Tróia, Grândola, Setúbal',
    );
  });

  it('does not repeat a location part the public label already contains', async () => {
    listing({
      description: 'A flat.',
      publicLocationLabel: 'Palm Coast, FL 32137',
      city: 'Palm Coast',
      region: 'FL',
    });

    expect((await fetchDescriptionGrounding('prop-1', 'en')).fields.listing_location).toBe(
      'Palm Coast, FL 32137',
    );
  });
});
