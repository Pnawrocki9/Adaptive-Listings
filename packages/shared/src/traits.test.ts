/** Canonical trait ids (MASTER_DESIGN §E.4.3 v3.0). */

import { describe, expect, it } from 'vitest';

import { CANONICAL_TRAIT_IDS, TraitIdSchema, isTraitId } from './traits.js';

describe('traits', () => {
  it('lists the 7 canonical traits in canonical order', () => {
    expect([...CANONICAL_TRAIT_IDS]).toEqual([
      'premium',
      'works_from_home',
      'residency_goal',
      'buying_from_abroad',
      'seasoned_investor',
      'will_let',
      'has_children',
    ]);
  });

  it('validates with TraitIdSchema and isTraitId', () => {
    for (const id of CANONICAL_TRAIT_IDS) {
      expect(TraitIdSchema.safeParse(id).success).toBe(true);
      expect(isTraitId(id)).toBe(true);
    }
    expect(TraitIdSchema.safeParse('luxury_buyer').success).toBe(false);
    expect(isTraitId('luxury_buyer')).toBe(false);
    expect(isTraitId(7)).toBe(false);
    expect(isTraitId(undefined)).toBe(false);
  });
});
