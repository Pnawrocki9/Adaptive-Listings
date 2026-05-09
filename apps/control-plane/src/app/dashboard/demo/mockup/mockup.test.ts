import { describe, expect, it } from 'vitest';

import { MOCKUP_LISTINGS, type ListingRegion } from '@/lib/mockup-listings';

describe('mockup listings data integrity', () => {
  it('all 12 listings have unique slugs', () => {
    const slugs = MOCKUP_LISTINGS.map((l) => l.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(12);
    expect(MOCKUP_LISTINGS).toHaveLength(12);
  });

  it('price_segment matches price value for every listing', () => {
    for (const l of MOCKUP_LISTINGS) {
      if (l.price_segment === 'budget') {
        expect(l.price, `${l.slug}: budget should be < 500k`).toBeLessThan(500_000);
      } else if (l.price_segment === 'mid') {
        expect(l.price, `${l.slug}: mid should be >= 500k`).toBeGreaterThanOrEqual(500_000);
        expect(l.price, `${l.slug}: mid should be <= 1M`).toBeLessThanOrEqual(1_000_000);
      } else {
        expect(l.price, `${l.slug}: luxury should be > 1M`).toBeGreaterThan(1_000_000);
      }
    }
  });

  it('each of the 4 regions has exactly 3 listings', () => {
    const regions: ListingRegion[] = ['costa-del-sol', 'algarve', 'tuscany', 'dubai-marina'];
    for (const region of regions) {
      const count = MOCKUP_LISTINGS.filter((l) => l.region === region).length;
      expect(count, `${region} should have 3 listings`).toBe(3);
    }
  });

  it('no listing is missing required fields', () => {
    for (const l of MOCKUP_LISTINGS) {
      expect(l.title, `${l.slug}: missing title`).toBeTruthy();
      expect(l.price, `${l.slug}: missing price`).toBeGreaterThan(0);
      expect(l.region, `${l.slug}: missing region`).toBeTruthy();
      expect(l.type, `${l.slug}: missing type`).toBeTruthy();
      expect(l.description, `${l.slug}: missing description`).toBeTruthy();
      expect(l.features.length, `${l.slug}: features should be non-empty`).toBeGreaterThan(0);
    }
  });
});
