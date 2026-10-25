/**
 * FOLLOW-1383 — the amenity claim check is language-aware (en / pl / es), on BOTH paths.
 *
 * The FOLLOW-1380 comparison (docs/research/MODEL-COMPARE-HAIKU55-SONNET55-2026-10-22.md §3.1)
 * found English copy refused as `unsupported_amenity` although the Polish original stated the
 * amenity: "kominek" did not ground "fireplace", "hala garażowa" did not ground "garage". The
 * vocabulary is now one closed list per amenity across the three supported languages, with Polish
 * inflected forms as explicit endings (`lib/amenity-lexicon.ts`), shared by the description path
 * (`checkBodyClaims`) and `/api/adapt` (`checkUnsupportedClaims`). Each case below runs on both.
 *
 * The negative controls pin that nothing is grounded by an amenity the listing does not state in
 * any language, by a negated one ("bez basenu", "sin piscina", "Basen: brak"), or by a look-alike
 * word ("ogrodzony" is fenced, not a garden; "komin" is a chimney), and that a pl / es text is
 * now checked like an English one.
 */
import { describe, expect, it } from 'vitest';
import { checkBodyClaims } from '@/lib/grounding-check';
import { buildClaimGrounding, checkUnsupportedClaims } from '@/lib/claim-containment';

/** Both paths' verdict for `text` against a listing whose only fact is `original`. */
function verdicts(
  text: string,
  original: string,
): { description: string | null; adapt: string | null } {
  return {
    description: checkBodyClaims(text, original, {}),
    adapt: checkUnsupportedClaims(text, buildClaimGrounding({ listing_description: original })),
  };
}

const BOTH_GROUNDED = { description: null, adapt: null };
const BOTH_REFUSED = { description: 'unsupported_amenity', adapt: 'unsupported_amenity' };

describe('FOLLOW-1383 — an amenity the listing states in pl / es grounds the English claim', () => {
  it.each([
    // The study's refusals.
    ['A living room with a fireplace.', 'Na parterze salon z kominkiem, kuchnia.'],
    ['A double garage built into the house.', 'Garaż dwustanowiskowy w bryle budynku.'],
    ['A space in the garage for an extra fee.', 'Miejsce postojowe w hali garażowej za opłatą.'],
    // Polish, inflected.
    ['A shared pool.', 'Wspólny basen.'],
    ['Villa with a pool.', 'Willa z basenem.'],
    ['A sunny balcony.', 'Mieszkanie z balkonem.'],
    ['A large terrace.', 'Wyjście na taras.'],
    ['Breakfast on the terrace.', 'Śniadanie na tarasie.'],
    ['A fenced garden.', 'Ogród ogrodzony, z drzewami owocowymi.'],
    ['A small garden.', 'Dom z ogródkiem.'],
    ['Quiet evenings in the garden.', 'Wieczory w ogrodzie.'],
    ['The building has an elevator.', 'W budynku winda, rowerownia i ochrona.'],
    ['A lift to every floor.', 'Dojazd windą na każde piętro.'],
    ['Air conditioning in every room.', 'Klimatyzacja w każdym pokoju.'],
    ['A fully air-conditioned flat.', 'Mieszkanie klimatyzowane.'],
    ['A storage room in the basement.', 'Komórka lokatorska w piwnicy.'],
    ['A dry cellar.', 'Sucha piwnica.'],
    ['A parking space is included.', 'Miejsce parkingowe w cenie.'],
    ['A parking space is included.', 'Miejsce postojowe w cenie.'],
    ['Parking for two cars.', 'Garaż na dwa samochody.'],
    ['A sauna in the basement.', 'Sauna w piwnicy.'],
    ['A home gym.', 'Domowa siłownia.'],
    ['A sea view from the bedroom.', 'Z sypialni widok na morze.'],
    // Spanish.
    ['A private pool.', 'Piscina privada.'],
    ['A garden with fruit trees.', 'Jardín con árboles frutales.'],
    ['A garage for two cars.', 'Garaje para dos coches.'],
    ['A covered terrace.', 'Terraza cubierta.'],
    ['The building has a lift.', 'Edificio con ascensor.'],
    ['Air conditioning throughout.', 'Aire acondicionado en toda la casa.'],
    ['A fireplace in the lounge.', 'Salón con chimenea.'],
    ['A balcony over the street.', 'Balcón a la calle.'],
    ['A basement for storage.', 'Sótano para almacenaje.'],
    ['Parking is included.', 'Plaza de aparcamiento incluida.'],
    ['Sea views.', 'Vistas al mar.'],
  ])('%j is grounded by %j', (text, original) => {
    expect(verdicts(text, original)).toEqual(BOTH_GROUNDED);
  });

  it.each([
    ['Salon z kominkiem i basenem.', 'A lounge with a fireplace and a pool.'],
    ['Dom z garażem i ogrodem.', 'A house with a garage and a garden.'],
    ['Mieszkanie z balkonem, w budynku winda.', 'A flat with a balcony; the building has a lift.'],
    ['Casa con piscina y jardín.', 'A house with a pool and a garden.'],
    ['Piso con ascensor y terraza.', 'A flat with an elevator and a terrace.'],
  ])('the pl / es text %j is grounded by the English fact %j', (text, original) => {
    expect(verdicts(text, original)).toEqual(BOTH_GROUNDED);
  });
});

describe('FOLLOW-1383 — negative controls: an amenity absent in every language is refused', () => {
  it.each([
    ['A house with a pool.', 'Dom wolnostojący z ogrodem.'],
    ['A house with a fireplace.', 'Casa con jardín.'],
    ['A garage for two cars.', 'Mieszkanie na trzecim piętrze.'],
    // A pl / es text is checked now, like an English one.
    ['Dom z basenem.', 'A detached house with a garden.'],
    ['Mieszkanie z balkonem.', 'A flat on the third floor.'],
    ['Casa con piscina.', 'A house with a garden.'],
    ['Piso con ascensor.', 'Piso en planta baja.'],
    // Newly in the vocabulary: parking and basement are amenity claims in every language.
    ['Parking is included.', 'A flat on the third floor.'],
    ['A storage room in the basement.', 'A flat on the third floor.'],
  ])('%j is refused against %j', (text, original) => {
    expect(verdicts(text, original)).toEqual(BOTH_REFUSED);
  });

  it.each([
    ['A house with a pool.', 'Dom bez basenu.'],
    ['A house with a pool.', 'Nie ma basenu.'],
    ['A house with a pool.', 'Brak basenu, duży ogród.'],
    ['A house with a pool.', 'Casa sin piscina.'],
    ['A flat with a lift.', 'Winda: nie.'],
    ['A flat with a lift.', 'Winda - brak.'],
    ['A house with a pool.', 'Basen: brak.'],
    ['A house with a garage.', 'Garażu brak.'],
    ['A house with a pool.', 'Pool: no.'],
  ])('%j is refused: the listing negates it (%j)', (text, original) => {
    expect(verdicts(text, original)).toEqual(BOTH_REFUSED);
  });

  it.each([
    ['A garden.', 'Teren ogrodzony.'],
    ['A fireplace.', 'Nowy komin.'],
    ['A garage.', 'Garażowanie na ulicy.'],
  ])('a look-alike word does not ground %j (%j)', (text, original) => {
    expect(verdicts(text, original)).toEqual(BOTH_REFUSED);
  });

  it('copy that negates an amenity in pl / es asserts nothing about it', () => {
    expect(verdicts('Mieszkanie bez balkonu, za to z dużym oknem.', 'Mieszkanie.')).toEqual(
      BOTH_GROUNDED,
    );
    expect(verdicts('Casa sin piscina.', 'Casa.')).toEqual(BOTH_GROUNDED);
  });

  it('English "wind" / "windy" is not an elevator claim', () => {
    expect(verdicts('A windy headland and a sea wind.', 'A house on a headland.')).toEqual(
      BOTH_GROUNDED,
    );
  });

  it('a Polish word ending in "nie" is not a negator ("właśnie")', () => {
    expect(verdicts('A house with a pool.', 'Właśnie tu jest basen.')).toEqual(BOTH_GROUNDED);
  });
});
