/**
 * Unit tests for fetchListingOriginalDescription (ESC-018 / ADR-0009).
 *
 * @module apps/control-plane/src/lib/listing-details.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchListingOriginalDescription } from './listing-details';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fetchListingOriginalDescription', () => {
  it('hits the by-uuid endpoint for a UUID listing id and returns the description', async () => {
    vi.stubEnv('ESTALARA_BACKEND_URL', 'https://backend.test');
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ description: 'A bright two-bed flat.' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchListingOriginalDescription(UUID, 'en');

    expect(result).toBe('A bright two-bed flat.');
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

    const result = await fetchListingOriginalDescription('9-blackberry-pl', 'es');

    expect(result).toBe('Casa luminosa.');
    const calledUrl = String(mockFetch.mock.calls[0]![0]);
    expect(calledUrl).toBe(
      'https://backend.test/api/v1/listing/details/slug?slug=9-blackberry-pl&locale=ES',
    );
  });

  it('returns "" on a non-2xx response (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    expect(await fetchListingOriginalDescription('prop-1', 'en')).toBe('');
  });

  it('returns "" on a network error (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await fetchListingOriginalDescription('prop-1', 'en')).toBe('');
  });

  it('returns "" when the payload has no string description field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: 'x' }), { status: 200 })),
    );
    expect(await fetchListingOriginalDescription('prop-1', 'en')).toBe('');
  });

  it('returns "" on malformed JSON (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{not json', { status: 200 })));
    expect(await fetchListingOriginalDescription('prop-1', 'en')).toBe('');
  });
});
