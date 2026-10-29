/**
 * Trait add-ons [FOLLOW-1360]: the rules and the invitation slot exist only when the trait is
 * present, and every rule is listing-grounded by construction. ESC-089 (CEO 2026-10-29) lifted the
 * familial-status limits: `has_children` now shapes copy towards family wording and the
 * family-relevant facts the listing states [FOLLOW-1411]; the one protected-ground guard left
 * (`describesResidentsByProtectedGround`) is pinned below.
 */

import { describe, expect, it } from 'vitest';
import { getAllPlaybooks, getPlaybook } from '../playbooks/index.js';
import {
  TRAIT_NOTE_SLOT,
  getTraitAddOns,
  renderTraitRules,
  describesResidentsByProtectedGround,
  traitSlots,
} from '../playbooks/traits.js';
import { CANONICAL_TRAIT_IDS } from '../traits.js';

/** Words that would turn an invitation into a claim about the property. */
const CLAIM_WORDS =
  /(?<![\p{L}\p{N}])(?:has|have|includes?|qualif\w+|eligible|guarantee\w*|yield\w*|licen[cs]\w*|ma|mają|posiada\w*|spełnia\w*|kwalifik\w*|licencj\w*|gwarant\w*|rentown\w*|tiene|tienen|incluye\w*|cumple\w*|califica\w*|licencia|garant\w*|rentabilidad)(?![\p{L}\p{N}])|\d/iu;

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

  it('has_children adds no slot: its contribution is emphasis in the copy', () => {
    expect(traitSlots(getTraitAddOns(['has_children']))).toEqual([]);
  });
});

describe('has_children shapes copy towards the family [FOLLOW-1411, ESC-089]', () => {
  const [addOn] = getTraitAddOns(['has_children']);
  const text = addOn?.rules.join(' ') ?? '';

  it('its slot is null and its rules write for a household with children', () => {
    expect(addOn?.slot).toBeNull();
    expect(text).toMatch(/household with children/i);
    expect(text).toMatch(/a room each/i);
    // The FOLLOW-1360 fair-housing prohibitions are lifted.
    expect(text).not.toMatch(/fair-housing|never address the reader as a parent/i);
  });

  it('it names schools and playgrounds only as the listing does (grounding, §E.7.0)', () => {
    expect(text).toMatch(
      /schools, nurseries, parks or playgrounds only where the listing names them/i,
    );
    expect(text).toMatch(/never invent a school, catchment, playground, distance or safety claim/i);
  });
});

describe('describesResidentsByProtectedGround — race, ethnic origin, religion of residents [FOLLOW-1411]', () => {
  const FLAGGED: Record<string, string[]> = {
    en: [
      'Friendly Muslim neighbours on every floor',
      'A close-knit Catholic community',
      'White residents only',
      'A predominantly Jewish neighbourhood',
      'The area is mostly Christian',
      'Residents are predominantly Asian',
      'A street with no immigrants',
      'Free of minorities',
      'An ethnically diverse district',
      'A religiously homogeneous estate',
      'Mostly Muslims live here',
    ],
    pl: [
      'Katolicka społeczność osiedla',
      'Muzułmańscy sąsiedzi',
      'Mieszkańcy to głównie katolicy',
      'Dzielnica głównie żydowska',
      'Okolica zamieszkana głównie przez muzułmanów',
      'Osiedle bez imigrantów',
      'Etnicznie jednorodna okolica',
    ],
    es: [
      'Vecinos musulmanes',
      'La comunidad judía del edificio',
      'Un barrio mayoritariamente católico',
      'Una zona sin inmigrantes',
      'Un vecindario étnicamente diverso',
      'Residentes blancos',
    ],
  };
  for (const [locale, values] of Object.entries(FLAGGED)) {
    it.each(values)(`flags ${locale} %j`, (value) => {
      expect(describesResidentsByProtectedGround(value)).toBe(true);
    });
  }

  it.each([
    // Family wording is archetype fit since ESC-089, never refused.
    'A family-friendly neighbourhood',
    'Ideal for families, with a garden',
    'Your children will love the garden',
    'A true family home with a room each',
    'Okolica przyjazna rodzinom',
    'Idealne dla rodzin z dziećmi',
    'Ideal para familias con niños',
    // Buyer nationality and origin are targeting, not a statement about residents.
    'For the diaspora returning home: an address your family will recognise',
    'An established international community',
    'A large British community nearby',
    'Polska diaspora w Wielkiej Brytanii',
    'Zabezpieczenie dla rodziny w kraju',
    'Comunidad internacional consolidada',
    // Place names, buildings, institutions and colours of things.
    'Steps from the former Jewish Quarter',
    'W sercu dawnej dzielnicy żydowskiej',
    'Junto al antiguo barrio judío',
    'A church and a mosque within walking distance',
    'Next to the Jewish Community Centre',
    'Mostly white walls and oak floors',
    'Mostly white buildings on the seafront',
    'Białe ściany i dębowa podłoga',
    'Głównie azjatycka kuchnia w restauracjach obok',
    'Uno de los pueblos blancos de Cádiz',
    'Edificio principalmente blanco',
    'Comunidad Valenciana',
    'A single-family house',
  ])('passes %j', (value) => {
    expect(describesResidentsByProtectedGround(value)).toBe(false);
  });

  it('no authored playbook string served on any branch trips the guard', () => {
    const served: string[] = [];
    for (const p of getAllPlaybooks().values()) {
      for (const slot of p.slots) {
        served.push(slot.en, slot.pl ?? '', slot.es ?? '', ...(slot.variants?.en ?? []));
      }
    }
    for (const id of CANONICAL_TRAIT_IDS) {
      for (const slot of traitSlots(getTraitAddOns([id])))
        served.push(slot.en, slot.pl ?? '', slot.es ?? '');
    }
    const strings = served.filter(Boolean);
    expect(strings.length).toBeGreaterThan(100);
    expect(strings.filter(describesResidentsByProtectedGround)).toEqual([]);
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

  it('trait invitations use the reviewed PL/ES wording', () => {
    const pl = (t: string) => traitSlots(getTraitAddOns([t]))[0];
    expect(pl('will_let')?.pl).toBe('Zapytaj o wynajem tej nieruchomości');
    expect(pl('works_from_home')?.es).toBe('Pregunta por espacio para teletrabajar');
    expect(pl('premium')?.pl).toBe('Poproś o prywatną prezentację');
  });

  it('family_buyer is the Moving up framing, family-fitted since ESC-089', () => {
    const p = getPlaybook('family_buyer');
    const headline = p.slots.find((s) => s.slot === 'headline');
    expect(headline?.variants?.en.some((v) => /^Moving Up/i.test(v))).toBe(true);
    for (const locale of ['en', 'pl', 'es'] as const) {
      expect(p.copy_template[locale]).toMatch(/HARD RULES:/);
    }
    // FOLLOW-1411: the FOLLOW-1407 ban on children and household is lifted; schools stay grounded.
    expect(p.copy_template.en).toMatch(/moving up for their family/i);
    expect(p.copy_template.en).not.toMatch(/never write about children/i);
    expect(p.copy_template.en).toMatch(/only where the listing names them/i);
    expect(p.description).toMatch(/has_children/);
  });

  it('diaspora_buyer is narrowed to returning to the country of origin', () => {
    expect(getPlaybook('diaspora_buyer').description).toMatch(/country of origin/i);
  });

  it('yield_hunter names the seasoned_investor add-on', () => {
    expect(getPlaybook('yield_hunter').description).toMatch(/seasoned_investor/);
  });
});
