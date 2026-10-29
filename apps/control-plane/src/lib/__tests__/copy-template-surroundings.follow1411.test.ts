/**
 * FOLLOW-1411 — a `copy_template` names a school, nursery or playground only on the listing's word.
 *
 * ESC-089 (CEO 2026-10-29) lifted the familial-status limits, so the family templates may again
 * talk about schools, children's rooms and gardens to play in. The grounding rule did not move
 * (§E.7.0, ESC-076): a school the listing does not name is an invented fact, and since FOLLOW-1411
 * the claim check refuses it like an invented pool (`amenity-lexicon.ts`, the school, nursery and
 * playground groups). A template sentence that RECOMMENDS one unconditionally would only produce
 * refusals — or, worse, copy that invents one where the check cannot see it. So every template
 * sentence the check would read as such a claim must carry a condition or a prohibition.
 *
 * The groups are read off the real `AMENITY_RES` (no test-only export), by probing each group with
 * a word it must match.
 */
import { describe, expect, it } from 'vitest';
import { getAllPlaybooks } from '@estalara/shared/playbooks';
import { AMENITY_RES } from '@/lib/amenity-lexicon';

/** The FOLLOW-1411 groups: the claim patterns that match these probes. */
const PROBES = ['schools', 'kindergarten', 'playground'] as const;
const SURROUNDINGS = PROBES.map((probe) => {
  const group = AMENITY_RES.find(({ claim }) => new RegExp(claim.source, 'iu').test(probe));
  if (group === undefined) throw new Error(`no amenity group matches ${probe}`);
  return new RegExp(group.claim.source, 'iu');
});

/**
 * A condition on the listing, or a prohibition, in en | pl | es. Sentences split at `.` and `;`
 * only, so an "Avoid:" list stays one sentence with its verb.
 */
const CONDITIONED =
  /(?<![\p{L}])(?:only|unless|never|avoid|forbidden|tylko|wyłącznie|chyba że|nigdy|nie|unikać|zabronion\p{L}*|solo|sólo|salvo|a menos que|nunca|evitar|prohibid\p{L}*)(?![\p{L}])|verified_facts/iu;

describe('FOLLOW-1411 — copy templates name schools, nurseries and playgrounds conditionally', () => {
  const sentences = [...getAllPlaybooks().values()].flatMap((p) =>
    Object.entries(p.copy_template).flatMap(([locale, text]) =>
      text
        .split(/(?<=[.;])\s+/)
        .map((sentence) => ({ where: `${p.archetype} ${locale}`, sentence })),
    ),
  );
  const naming = sentences.filter(({ sentence }) => SURROUNDINGS.some((re) => re.test(sentence)));

  it('the probes find the three groups, and they see every language', () => {
    expect(SURROUNDINGS).toHaveLength(3);
    for (const text of ['close to schools', 'blisko szkoły', 'cerca del colegio']) {
      expect(SURROUNDINGS[0]!.test(text), text).toBe(true);
    }
    expect(SURROUNDINGS[0]!.test('mornings before school')).toBe(false);
    expect(SURROUNDINGS[2]!.test('osiedle z placem zabaw')).toBe(true);
  });

  it('the family templates do name them (the scan has something to read)', () => {
    const where = new Set(naming.map((n) => n.where));
    for (const w of ['family_buyer en', 'family_buyer pl', 'family_buyer es', 'upsizer en']) {
      expect(where, w).toContain(w);
    }
  });

  it('every such sentence is conditional on the listing or a prohibition', () => {
    const unconditional = naming
      .filter(({ sentence }) => !CONDITIONED.test(sentence))
      .map(({ where, sentence }) => `${where}: ${sentence}`);
    expect(unconditional).toEqual([]);
  });
});
