/**
 * FOLLOW-1393 — the guarantee and "no work needed" claims are language-aware, on both paths.
 *
 * The FOLLOW-1383 live run refused "the flat is finished and furnished, so it is move-in ready" and
 * "there is no renovation to plan" on an English page because the Polish original says
 * "wykończone": the condition facts that ground a no-work claim were English only. They are now a
 * closed en / pl / es lexicon (`lib/condition-lexicon.ts`), and so are the guarantee and no-work
 * CLAIMS, so a Polish or Spanish text is checked like an English one.
 *
 * A condition fact never grounds a guarantee: "guaranteed return" / "gwarantowany zysk" /
 * "rentabilidad garantizada" stay refused against a finished, renovated listing.
 */
import { describe, expect, it } from 'vitest';
import { checkBodyClaims } from '@/lib/grounding-check';
import { buildClaimGrounding, checkUnsupportedClaims } from '@/lib/claim-containment';

const WAW =
  'Na sprzedaż dwupokojowe mieszkanie o powierzchni 48 m² na 5. piętrze przy ul. Kłobuckiej. Mieszkanie jest wykończone i umeblowane, okna wychodzą na wschód.';
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

describe('FOLLOW-1393 — a Polish or Spanish condition fact grounds a no-work claim', () => {
  it.each([
    // The two live refusals (FOLLOW-1383 run, waw.*.en).
    [WAW, 'The flat is finished and furnished, so it is move-in ready.'],
    [WAW, 'It is finished and furnished, so there is no renovation to plan before you arrive.'],
    ['Mieszkanie do zamieszkania od zaraz.', 'A move-in ready flat.'],
    ['Mieszkanie po remoncie, z nową instalacją.', 'Ready to move in.'],
    ['Lokal gotowy do wprowadzenia.', 'Move-in ready.'],
    ['Mieszkanie wyremontowane w 2023 roku.', 'No renovation needed.'],
    ['Piso reformado con cocina nueva.', 'A move-in ready flat.'],
    ['Piso listo para entrar a vivir.', 'Turnkey and move-in ready.'],
    // Claims in Polish and Spanish, grounded by any language's condition fact.
    ['Fully renovated flat in Warsaw.', 'Mieszkanie gotowe do zamieszkania.'],
    [WAW, 'Mieszkanie nie wymaga remontu.'],
    ['Piso totalmente reformado.', 'Listo para entrar a vivir, sin necesidad de reformas.'],
  ])('listing %j grounds %j', (original, text) => {
    expect(bothPaths(text, original)).toEqual(OK);
  });

  it.each([
    [GDA, 'A move-in ready house.'],
    [GDA, 'Dom gotowy do zamieszkania, bez remontu.'],
    [GDA, 'Casa lista para entrar a vivir.'],
    [GDA, 'Nie wymaga remontu.'],
    ['Mieszkanie do wykończenia, stan deweloperski.', 'Move-in ready.'],
    ['Mieszkanie nie jest wykończone.', 'Move-in ready.'],
  ])('listing %j does NOT ground %j', (original, text) => {
    expect(bothPaths(text, original)).toEqual(GUARANTEE);
  });
});

describe('FOLLOW-1393 — a guarantee stays refused, in every language', () => {
  it.each([
    'A guaranteed return from day one.',
    'Gwarantowany zysk z najmu.',
    'Gwarancja stałego dochodu.',
    'Inwestycja bez ryzyka.',
    'Rentabilidad garantizada.',
    'Una inversión sin riesgo.',
    'Ingresos asegurados todo el año.',
  ])('%j is refused against a finished, renovated listing', (text) => {
    const original = `${WAW} Mieszkanie po remoncie. Piso reformado. Fully renovated.`;
    expect(bothPaths(text, original)).toEqual(GUARANTEE);
  });

  it('a guarantee the listing itself makes is grounded (the seller’s claim, ESC-076)', () => {
    expect(
      bothPaths('A guaranteed rent for two years.', 'Gwarantowany czynsz przez 2 lata.'),
    ).toEqual(OK);
  });
});
