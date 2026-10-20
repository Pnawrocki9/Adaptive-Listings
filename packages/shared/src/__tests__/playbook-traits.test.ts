/**
 * Trait add-ons [FOLLOW-1360]: the rules and the invitation slot exist only when the trait is
 * present, every rule is listing-grounded by construction, and `has_children` never steers.
 */

import { describe, expect, it } from 'vitest';
import { getPlaybook } from '../playbooks/index.js';
import {
  TRAIT_NOTE_SLOT,
  getTraitAddOns,
  renderTraitRules,
  steersByFamilialStatus,
  traitSlots,
} from '../playbooks/traits.js';
import { CANONICAL_TRAIT_IDS } from '../traits.js';

/** Words that would turn an invitation into a claim about the property. */
const CLAIM_WORDS =
  /\b(?:has|have|includes?|qualif\w+|eligible|guarantee\w*|yield\w*|licen[cs]\w*)\b|\d/i;

describe('getTraitAddOns', () => {
  it('returns nothing without a trait, and drops unknown ids', () => {
    expect(getTraitAddOns(undefined)).toEqual([]);
    expect(getTraitAddOns([])).toEqual([]);
    expect(getTraitAddOns(['not_a_trait', 42, null])).toEqual([]);
  });

  it('returns canonical order, de-duplicated, whatever the input order', () => {
    const got = getTraitAddOns(['has_children', 'premium', 'premium', 'bogus', 'will_let']);
    expect(got.map((a) => a.trait)).toEqual(['premium', 'will_let', 'has_children']);
  });

  it.each(CANONICAL_TRAIT_IDS)('%s: rules and slot appear only when the trait is present', (id) => {
    const other = CANONICAL_TRAIT_IDS.filter((t) => t !== id);
    const without = getTraitAddOns(other);
    expect(without.map((a) => a.trait)).not.toContain(id);
    expect(renderTraitRules(without)).not.toContain(`[${id}]`);

    const only = getTraitAddOns([id]);
    expect(only).toHaveLength(1);
    expect(renderTraitRules(only)).toContain(`[${id}]`);
    expect(only[0]?.rules.length).toBeGreaterThan(0);
    expect(traitSlots(only).length).toBe(id === 'has_children' ? 0 : 1);
  });

  it.each(CANONICAL_TRAIT_IDS)(
    '%s: every rule set is small, grounded and ends in a prohibition',
    (id) => {
      const [addOn] = getTraitAddOns([id]);
      const rules = addOn?.rules ?? [];
      expect(rules.length).toBeLessThanOrEqual(2);
      expect(rules.some((r) => /\b(?:never|only if|only where)\b/i.test(r))).toBe(true);
      expect(rules.at(-1)).toMatch(/\b(?:never|unless)\b/i);
    },
  );

  it('renders an empty string for no add-ons (a request without traits is byte-identical)', () => {
    expect(renderTraitRules([])).toBe('');
  });

  it('carries the absorbed playbook listing_rules for the four absorbed traits', () => {
    expect(getTraitAddOns(['premium'])[0]?.listing_rules).toBe(
      getPlaybook('luxury_buyer').listing_rules,
    );
    expect(getTraitAddOns(['works_from_home'])[0]?.listing_rules).toBe(
      getPlaybook('remote_worker').listing_rules,
    );
    expect(getTraitAddOns(['residency_goal'])[0]?.listing_rules).toBe(
      getPlaybook('golden_visa_buyer').listing_rules,
    );
    expect(getTraitAddOns(['seasoned_investor'])[0]?.listing_rules).toBe(
      getPlaybook('portfolio_builder').listing_rules,
    );
  });
});

describe('trait invitation slots', () => {
  const withSlot = CANONICAL_TRAIT_IDS.filter((t) => t !== 'has_children');

  it.each(withSlot)('%s: one non-assertive invitation in en, pl and es', (id) => {
    const slots = traitSlots(getTraitAddOns([id]));
    expect(slots).toHaveLength(1);
    const slot = slots[0];
    expect(slot?.slot).toBe(TRAIT_NOTE_SLOT);
    for (const text of [slot?.en, slot?.pl, slot?.es]) {
      expect(text).toBeTruthy();
      expect(text).not.toMatch(CLAIM_WORDS);
    }
    // An offer or a question the buyer may ask, in the same register as the enumerated `cta`s.
    expect(slot?.en).toMatch(/^(?:Request|Ask About)\b/);
  });

  it('has_children adds no slot at all (familial status is a protected class)', () => {
    expect(traitSlots(getTraitAddOns(['has_children']))).toEqual([]);
  });
});

describe('has_children never steers by familial status', () => {
  const [addOn] = getTraitAddOns(['has_children']);

  it('its slot is null and its rules forbid the steering phrases instead of using them', () => {
    expect(addOn?.slot).toBeNull();
    const text = addOn?.rules.join(' ') ?? '';
    expect(text).toMatch(/never describe an area or neighbourhood as family-friendly/i);
    expect(text).toMatch(/fair-housing/i);
  });

  it.each([
    'A family-friendly neighbourhood',
    'Ideal for families',
    'Perfect for young families',
    'A safe neighbourhood for children',
    'Great location for kids',
    'Raising a family here',
    'Your children will love the garden',
  ])('steersByFamilialStatus flags %j', (value) => {
    expect(steersByFamilialStatus(value)).toBe(true);
  });

  it.each([
    'Four bedrooms and a south-facing garden',
    'Storage room off the hall',
    'Detached house with a double garage',
  ])('steersByFamilialStatus passes the physical fact %j', (value) => {
    expect(steersByFamilialStatus(value)).toBe(false);
  });
});

describe('playbook merges (FOLLOW-1360)', () => {
  it('keeps the playbooks of the five de-assigned ids', () => {
    for (const id of [
      'upsizer',
      'portfolio_builder',
      'luxury_buyer',
      'remote_worker',
      'golden_visa_buyer',
    ] as const) {
      expect(getPlaybook(id).archetype).toBe(id);
    }
  });

  it('family_buyer is the Moving up framing and assumes no children', () => {
    const p = getPlaybook('family_buyer');
    const headline = p.slots.find((s) => s.slot === 'headline');
    expect(headline?.variants?.en.some((v) => /^Moving Up/i.test(v))).toBe(true);
    for (const locale of ['en', 'pl', 'es'] as const) {
      expect(p.copy_template[locale]).toMatch(/HARD RULES:/);
    }
    expect(p.copy_template.en).toMatch(/do not assume children/i);
    expect(p.description).toMatch(/has_children/);
  });

  it('diaspora_buyer is narrowed to returning to the country of origin', () => {
    expect(getPlaybook('diaspora_buyer').description).toMatch(/country of origin/i);
  });

  it('yield_hunter names the seasoned_investor add-on', () => {
    expect(getPlaybook('yield_hunter').description).toMatch(/seasoned_investor/);
  });
});
