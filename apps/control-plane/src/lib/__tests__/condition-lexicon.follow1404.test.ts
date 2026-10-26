/**
 * FOLLOW-1404 — a negated no-work claim is not a no-work claim, on both paths.
 *
 * The FOLLOW-1399 comparison refused three correct sentences as `unsupported_guarantee`: "It is not
 * turnkey." (Haiku 5.5), "…so it is not move-in ready." and "…więc nie jest gotowe do
 * wprowadzenia." (Sonnet 5.5), each about a listing that needs work. `NO_WORK_CLAIM_RE` had no
 * negation guard. It now reuses the amenity negation (`NEGATOR_RE` in the same clause within 30
 * characters before the match, `NEGATED_AFTER_RE` after it), with two limits that keep the check
 * fail-closed:
 *   - a phrase that is itself negative ("no renovation", "nie wymaga remontu", "bez remontu",
 *     "sin reformas") is a claim whatever precedes it: "bez balkonu, nie wymaga remontu" and
 *     "Mieszkanie bez balkonu nie wymaga remontu" are still refused;
 *   - "not only" / "not just" / "nie tylko" / "no solo" affirm, they do not negate.
 * The listing's own text is read the same way: "nie jest gotowe do zamieszkania" no longer grounds
 * "move-in ready" (before, any match grounded it, negated or not).
 */
import { describe, expect, it } from 'vitest';
import { checkBodyClaims } from '@/lib/grounding-check';
import { buildClaimGrounding, checkUnsupportedClaims } from '@/lib/claim-containment';

// The listing behind the two Sonnet sentences (FOLLOW-1399 `kat`): it needs a full renovation.
const KAT = 'Mieszkanie 38 m² w Katowicach Załężu, do generalnego remontu. Cena 189 000 zł.';
const GDA =
  'Dom wolnostojący w Straszynie. Dom wymaga odświeżenia: do wymiany są okna na piętrze i instalacja elektryczna.';

function bothPaths(text: string, original: string) {
  return {
    description: checkBodyClaims(text, original, {}),
    adapt: checkUnsupportedClaims(text, buildClaimGrounding({ listing_description: original })),
  };
}

const OK = { description: null, adapt: null };
const GUARANTEE = { description: 'unsupported_guarantee', adapt: 'unsupported_guarantee' };

describe('FOLLOW-1404 — negated no-work claims are accepted', () => {
  it.each([
    // The three FOLLOW-1399 refusals, verbatim.
    [GDA, 'It is not turnkey.'],
    [KAT, 'It is sold for a full renovation, so it is not move-in ready.'],
    [KAT, 'Mieszkanie czeka na generalny remont, więc nie jest gotowe do wprowadzenia.'],
    // en / pl / es variants and a spec-line negation.
    [GDA, 'The house is not ready to move in.'],
    [KAT, 'Lokal nie jest pod klucz.'],
    [KAT, 'El piso no está listo para entrar a vivir.'],
    [KAT, 'Turnkey: no.'],
  ])('listing %j: %j is not a no-work claim', (original, text) => {
    expect(bothPaths(text, original)).toEqual(OK);
  });
});

describe('FOLLOW-1404 — the guard stays fail-closed', () => {
  it.each([
    // An asserted claim is still refused.
    [KAT, 'A move-in ready flat.'],
    [KAT, 'Mieszkanie jest gotowe do wprowadzenia.'],
    // A negator that belongs to another phrase in the same clause does not negate the claim.
    [KAT, 'Mieszkanie bez balkonu nie wymaga remontu.'],
    [KAT, 'No balcony, but it needs no work.'],
    [KAT, 'Sin ascensor y sin reformas pendientes.'],
    // "not only" affirms.
    [KAT, 'It is not only spacious but also move-in ready.'],
    [KAT, 'It is not just turnkey, it is furnished.'],
    [KAT, 'Mieszkanie nie tylko gotowe do wprowadzenia, ale i umeblowane.'],
    [KAT, 'No solo llave en mano, también amueblado.'],
    // A negated claim next to an asserted one: the asserted one is refused.
    [KAT, 'It is not turnkey today; after the works it will be move-in ready.'],
    // The listing side reads the same rule: a negated no-work phrase grounds nothing.
    ['Mieszkanie nie jest gotowe do zamieszkania.', 'A move-in ready flat.'],
    ['The flat is not turnkey.', 'A turnkey flat.'],
  ])('listing %j: %j is still refused', (original, text) => {
    expect(bothPaths(text, original)).toEqual(GUARANTEE);
  });
});
