/**
 * FOLLOW-1401 — a `copy_template` never recommends a claim the claim check refuses.
 *
 * The FOLLOW-1399 comparison traced 16 of its 25 description refusals (both models) to one word
 * family: "turnkey" / "pod klucz" / "llave en mano", which the `second_home_buyer` and
 * `vacation_rental_investor` templates recommended in en/pl/es, and which the no-work check
 * refuses unless the listing itself says it (a "furnished" listing does not). `first_time_buyer`
 * recommended "move-in ready" / "gotowe do wprowadzenia" / "llave en mano" the same way. A template
 * that asks for a claim the listing must ground can only produce refusals, or — where the listing
 * happens to ground it — copy that would have been written anyway. Template wording now asks for
 * the condition and furnishing "as the listing states them" instead.
 *
 * A template may still NAME such a phrase inside a prohibition (an "Avoid:" list); those
 * sentences are pinned, so a new matching sentence fails until it is reviewed. FOLLOW-1385 (the
 * vacation-rental template alone) is superseded by this ticket.
 */
import { describe, expect, it } from 'vitest';
import { getAllPlaybooks } from '@estalara/shared/playbooks';
import { assertsGuarantee, assertsNoWorkClaim } from '@/lib/condition-lexicon';

const PROHIBITIONS: readonly string[] = [
  'golden_visa_buyer en: loophole, easy, fast-track, guaranteed approval',
  'golden_visa_buyer pl: luka, łatwy, szybka ścieżka, gwarantowana zgoda',
  'golden_visa_buyer es: laguna, fácil, vía rápida, aprobación garantizada',
];

describe('FOLLOW-1401 — copy templates and the no-work / guarantee vocabulary', () => {
  const matched = [...getAllPlaybooks().values()].flatMap((p) =>
    Object.entries(p.copy_template).flatMap(([locale, text]) =>
      text
        .split(/(?<=[.;:])\s+/)
        .filter((sentence) => assertsNoWorkClaim(sentence) || assertsGuarantee(sentence))
        .map((sentence) => `${p.archetype} ${locale}: ${sentence}`),
    ),
  );

  it('every template sentence the claim vocabulary matches is a pinned prohibition', () => {
    expect(matched.filter((m) => !PROHIBITIONS.some((pin) => m.startsWith(pin)))).toEqual([]);
    expect(matched).toHaveLength(PROHIBITIONS.length);
  });

  it.each(['second_home_buyer', 'vacation_rental_investor', 'first_time_buyer'])(
    '%s keeps a template in every locale',
    (id) => {
      const p = [...getAllPlaybooks().values()].find((x) => x.archetype === id)!;
      for (const locale of ['en', 'pl', 'es'] as const) {
        expect(p.copy_template[locale].length, locale).toBeGreaterThan(200);
      }
    },
  );
});
