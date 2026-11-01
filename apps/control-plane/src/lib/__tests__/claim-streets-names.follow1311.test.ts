/**
 * FOLLOW-1311 slice 5: a street the listing does not state, stated with a signal, and the name forms
 * of T7. The listing's own street always passes (CEO 2026-10-30), in every form. `KNOWN_LIMITS` pins
 * what still passes although it is wrong, named so nobody reads a pass as approval.
 *
 * @module apps/control-plane/src/lib/__tests__/claim-streets-names.follow1311.test
 */

import { describe, expect, it } from 'vitest';
import { checkBodyClaims, checkHeadlineFacts } from '@/lib/grounding-check';
import { buildClaimGrounding, checkUnsupportedClaims } from '@/lib/claim-containment';
import { checkTypedClaims } from '@/lib/typed-claims';

interface Listing {
  original: string;
  ctx?: Record<string, string>;
}

const at = (listing_location: string, original = 'Mieszkanie.'): Listing => ({
  original,
  ctx: { listing_location },
});
const said = (original: string): Listing => ({ original });

/** The street claims alone: the digit and amenity rules read these sentences too. */
const street = (l: Listing, text: string) =>
  checkTypedClaims(text, [
    { field: 'original_description', text: l.original },
    ...Object.entries(l.ctx ?? {}).map(([field, value]) => ({ field, text: `${field}: ${value}` })),
  ]).find((c) => c.kind === 'street' && c.violation !== null)?.violation ?? null;

const FX = at('9 Blackberry Pl, Palm Coast, FL 32137', 'A home on a quiet street, by the beach.');
const KRK = at('ul. Długa 4, Kraków', 'Mieszkanie przy ul. Długiej 4 w Krakowie.');
const PLAIN = said('A bright flat with a balcony, in a quiet area.');

describe('an unlisted street, stated with a signal, is refused', () => {
  it.each<[string, Listing, string]>([
    ['a house number', FX, 'A home at 12 Elm St'],
    ['a house number, an ambiguous street word', FX, 'Next to 9 Ocean Terrace.'],
    ['at', FX, 'Just steps from here, at Collins Ave.'],
    ['on', PLAIN, 'A flat on Abbey Road.'],
    ['the first word of a sentence may be a capital', PLAIN, 'Home on Ocean Drive'],
    ['pl: ul.', KRK, 'Mieszkanie przy ul. Złotej w Krakowie.'],
    ['pl: ulicy', KRK, 'Mieszkanie przy ulicy Floriańskiej.'],
    ['pl: an abbreviation decides nothing', KRK, 'Przy ulicy Ks. Skorupki.'],
    ['pl: aleje', KRK, 'Mieszkanie w Alejach Jerozolimskich.'],
    ['pl: plac with a locating word', KRK, 'Dwa kroki od placu Zbawiciela.'],
    ['es: calle', at('Calle de la Paz 7, Sevilla'), 'Piso en la calle Mayor.'],
    ['es: c/', at('Calle de la Paz 7, Sevilla'), 'Piso en c/ Serrano.'],
    ['es: paseo with a locating word', at('Calle de la Paz 7'), 'Cerca del Paseo de Gracia.'],
  ])('%s', (_name, listing, text) => {
    expect(street(listing, text)).toBe('unsupported_street');
  });

  it('on all three checks, final, and by name in the typed claims', () => {
    expect(checkBodyClaims('A home on Ocean Drive.', FX.original, FX.ctx ?? {})).toBe(
      'unsupported_street',
    );
    expect(checkHeadlineFacts('Home on Ocean Drive', FX.original, FX.ctx ?? {}, 'en')).toBe(
      'unsupported_street',
    );
    expect(checkUnsupportedClaims('Home on Ocean Drive', buildClaimGrounding(FX.ctx ?? {}))).toBe(
      'unsupported_street',
    );
    expect(checkTypedClaims('Home on Ocean Drive', [])).toEqual([
      {
        kind: 'street',
        key: 'street',
        value: 'Ocean',
        source: null,
        violation: 'unsupported_street',
      },
    ]);
  });
});

describe('the listing own street always passes (CEO 2026-10-30, ESC-076)', () => {
  it.each<[Listing, string]>([
    [at('ul. Św. Marcina 12, Poznań'), 'Mieszkanie przy ul. Św. Marcina 12.'],
    [at('ul. J. Słowackiego 5'), 'Mieszkanie przy ul. J. Słowackiego 5.'],
    [at('ul. Ks. Skorupki 3'), 'Przy ulicy Ks. Skorupki.'],
    [at('C/ Dr. Fleming 5'), 'Piso en calle Dr. Fleming 5.'],
    [at("12 Queen's Road"), "A flat at 12 Queen's Road."],
    [at("12 Queen's Road"), 'A flat on Queen’s Road.'],
    [at("12 St Mary's Road"), "A flat on St Mary's Road."],
    [said('A flat on O’Connell Street, Dublin.'), 'A flat on O’Connell Street.'],
    [said('A flat on O’Connell Street, Dublin.'), "A flat on O'Connell Street."],
    [at('ul. Marii Skłodowskiej-Curie 5'), 'Przy ulicy Skłodowskiej-Curie.'],
    [at('12 Stratford-upon-Avon Road'), 'A flat on Stratford-upon-Avon Road.'],
    [at('12 ocean way, miami'), 'A flat at 12 Ocean Way.'],
    [at('9 blackberry place'), 'A home at 9 Blackberry Place.'],
    [at('7 harbour court'), 'A home at 7 Harbour Court.'],
    [at('plac wolności 3'), 'Mieszkanie przy placu Wolności 3.'],
    [at('aleje jerozolimskie 12'), 'Biuro w Aleje Jerozolimskie 12.'],
    [said('Mieszkanie przy ul. Św. Marcina 12 w Poznaniu'), 'Przy ul. Św. Marcina 12.'],
    [said('Piso en Avda. Dr. Fleming 5, Madrid'), 'Piso en Avda. Dr. Fleming 5.'],
    [said('flat at 12 ocean way, miami'), 'A flat at 12 Ocean Way.'],
    [said('mieszkanie, plac wolności 3'), 'Mieszkanie przy placu Wolności.'],
    [said('biuro, aleje jerozolimskie 12'), 'Biuro, Aleje Jerozolimskie 12.'],
    // The forms a Polish page gives it, and the listing's own lower case.
    [KRK, 'Mieszkanie przy ulicy Długiej.'],
    [KRK, 'Nad ulicą Długą.'],
    [KRK, 'Mieszkanie przy ul. Dlugiej.'],
    [KRK, 'A flat on Długa Street.'],
    [at('ul. piotrkowska 120, łódź'), 'Lokal przy ul. Piotrkowskiej.'],
    // Slice 5, F: translated, by its first four letters or the abbreviation it expands.
    [at('Carrer de Provença 123'), 'Piso en calle Provenza.'],
    [at('Calle Santa Clara 8'), 'Piso en C/ Sta. Clara.'],
    [at('Calle Doctor Fleming 5'), 'Piso en calle Dr. Fleming.'],
    [at('al. Jana Pawła II 10'), 'A flat on John Paul II Avenue.'],
  ])('%#: %s', (listing, text) => {
    expect(street(listing, text)).toBeNull();
    // And no other rule of the body takes it down.
    expect(checkBodyClaims(text, listing.original, listing.ctx ?? {})).toBeNull();
  });

  it('the source field names where it was found', () => {
    expect(
      checkTypedClaims('A home at 9 Blackberry Place.', [
        { field: 'listing_location', text: 'listing location: 9 Blackberry Pl, Palm Coast' },
      ]).filter((c) => c.kind === 'street'),
    ).toEqual([expect.objectContaining({ source: 'listing_location', violation: null })]);
  });
});

describe('no signal, no claim: ordinary phrases pass', () => {
  it.each([
    'Free Street Parking',
    '15 Minute Drive',
    'Easy Road Access',
    'An Easy Drive To The Coast',
    'Paved Drive',
    'A Sunset Drive',
    'Gated Drive',
    'A Trip Down Memory Lane',
    'Google Street View',
    'Wall Street Journal',
    'Coldwell Banker Drive team',
    'Plaza de Garaje',
    'Plaza de Parking',
    'Paseo Tranquilo',
    'Calle Principal',
    'Plac Zabaw Dla Dzieci',
    'Plac Budowy',
    'c/ Terraza',
    'Quiet Garden\nDrive to the beach in minutes.',
    'Spacious Garden\nRoad access is easy.',
    // Near misses with a locating word.
    'A flat on Google Street View',
    'Read at Wall Street Journal offices',
    'Beautiful Home on Sunset Drive',
    'A flat near Bath. Road access is good.',
    'Visit St. Augustine, on Mount St. Helens.',
    'Cicha ulica z balkonem i plac zabaw.',
    'Una calle tranquila, plaza de parking.',
    'A/C Unit in the Living Room.',
    'With 2 Bedroom Terrace access.',
  ])('%s', (text) => {
    expect(street(PLAIN, text)).toBeNull();
  });
});

describe('T7: the forms a Polish page gives the listing own place pass the name rule', () => {
  it.each<[string, string, string]>([
    ['Wrocław', 'Dom', 'Dom we Wrocławiu'],
    ['Poznań', 'Dom', 'Dom w Poznaniu, pod Poznaniem'],
    ['Łódź', 'Dom', 'Dom w Łodzi'],
    ['Gdynia', 'Dom', 'Dom w Gdyni'],
    ['Bydgoszcz', 'Dom', 'Dom w Bydgoszczy'],
    ['Katowice', 'Dom', 'Dom w Katowicach'],
    ['Wrocław, Krzyki', 'Dom', 'Dom na Krzykach'],
    ['Osiedle Piastowskie', 'Dom', 'Dom na Piastowskim'],
    ['Marbella, Málaga', 'Apartament', 'Apartament w Maladze'],
    ['ul. piotrkowska 120', 'Lokal', 'Lokal przy Piotrkowskiej'],
    ['Stare Miasto', 'Dom', 'Dom na Starym'],
    ['Dolny Sopot', 'Dom', 'Dom w Dolnym Sopocie'],
    ['Palm Coast, FL', 'Dom', 'Dom na Florydzie'],
  ])('%s', (place, original, headline) => {
    expect(checkHeadlineFacts(headline, original, { listing_location: place }, 'pl')).toBeNull();
  });
});

describe('KNOWN_LIMITS: these pass although they are wrong', () => {
  it.each<[string, Listing, string]>([
    ['no signal', PLAIN, 'A short walk to Beach Road.'],
    ['title case', PLAIN, 'Beautiful Home on Ocean Drive'],
    ['a generic street name', PLAIN, 'A flat on High Street, on Main Street.'],
    ['one word of the name found', FX, 'A home on Palm Street.'],
    ['the same first four letters', FX, 'A home on Blackpool Road.'],
    ['another street type of the name', FX, 'A home on Blackberry Lane.'],
    [
      'a name grounded by a sentence opening',
      said('Beach 200 m.'),
      'On Beach Road, on Beach Lane.',
    ],
    ['in lower case', PLAIN, 'A flat at 12 bath road.'],
    ['a numbered street', PLAIN, 'A flat on 42nd Street.'],
    ['a street word outside the list', FX, 'A home on Palm Coast Parkway.'],
    [
      'an ambiguous street word, no number',
      PLAIN,
      'A flat on Ocean Way, by Bath Place, on Bath St.',
    ],
    ['a noun after the street', PLAIN, 'A flat on Abbey Road studios.'],
    ['a lower-case ul.', PLAIN, 'Mieszkanie przy ul. parterowa.'],
    ['a square with no locating word', PLAIN, 'Plac Zbawiciela i Plaza Mayor.'],
  ])('street: %s', (_name, listing, text) => {
    expect(street(listing, text)).toBeNull();
  });

  it.each<[string, string]>([
    ['slice 5 dropped its judge: a place in a body', 'Located in Miami, this home is bright.'],
    ['pl', 'Mieszkanie w Gdyni, blisko plaży Stogi.'],
    ['es', 'Piso en Granada, cerca de Málaga.'],
  ])('body name: %s', (_name, text) => {
    expect(checkBodyClaims(text, PLAIN.original, {})).toBeNull();
  });
});

describe('REFUSED although it may be fine: pinned', () => {
  it.each<[string, Listing, string]>([
    ['a translated street, no shared letters', KRK, 'A flat on Golden Road.'],
    ['a street as a figure of speech', PLAIN, 'A flat near Wall Street.'],
  ])('%s', (_name, listing, text) => {
    expect(street(listing, text)).toBe('unsupported_street');
  });
});
