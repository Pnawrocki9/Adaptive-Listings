/**
 * FOLLOW-1297 (ADR-0023 §6 G-06) — the additive optional `requeue_depth` (0..20) and
 * `retry_listing_ids` on `ListingEmbeddingSeedRequestedEventSchema`. The required-key contract
 * (`listing-embed-seed-event.required.json`) is unchanged: both fields are optional.
 */
import { describe, expect, it } from 'vitest';

import { ListingEmbeddingSeedRequestedEventSchema } from '../schemas/listing-embed-seed.js';

const BASE = {
  tenant_id: '550e8400-e29b-41d4-a716-446655440000',
  listing_ids: ['prop-051', 'prop-052'],
};

describe('ListingEmbeddingSeedRequestedEventSchema — requeue fields (FOLLOW-1297 G-06)', () => {
  it('accepts a payload without either field (the Modal-era shape)', () => {
    const parsed = ListingEmbeddingSeedRequestedEventSchema.parse(BASE);
    expect(parsed.requeue_depth).toBeUndefined();
    expect(parsed.retry_listing_ids).toBeUndefined();
  });

  it('accepts requeue_depth 0 and 20 (the bounds)', () => {
    expect(
      ListingEmbeddingSeedRequestedEventSchema.parse({ ...BASE, requeue_depth: 0 }).requeue_depth,
    ).toBe(0);
    expect(
      ListingEmbeddingSeedRequestedEventSchema.parse({ ...BASE, requeue_depth: 20 }).requeue_depth,
    ).toBe(20);
  });

  it('rejects requeue_depth 21, a negative depth and a non-integer depth', () => {
    for (const requeue_depth of [21, -1, 1.5]) {
      expect(
        ListingEmbeddingSeedRequestedEventSchema.safeParse({ ...BASE, requeue_depth }).success,
        String(requeue_depth),
      ).toBe(false);
    }
  });

  it('accepts retry_listing_ids as a list of non-empty ids, rejects an empty id', () => {
    expect(
      ListingEmbeddingSeedRequestedEventSchema.parse({ ...BASE, retry_listing_ids: ['prop-052'] })
        .retry_listing_ids,
    ).toEqual(['prop-052']);
    expect(
      ListingEmbeddingSeedRequestedEventSchema.safeParse({ ...BASE, retry_listing_ids: [''] })
        .success,
    ).toBe(false);
  });

  it('a hop payload example: remainder + one retry at depth 1', () => {
    const parsed = ListingEmbeddingSeedRequestedEventSchema.parse({
      tenant_id: BASE.tenant_id,
      listing_ids: ['prop-060', 'prop-061', 'prop-052'],
      requeue_depth: 1,
      retry_listing_ids: ['prop-052'],
    });
    expect(parsed.listing_ids).toHaveLength(3);
    expect(parsed.requeue_depth).toBe(1);
  });
});
