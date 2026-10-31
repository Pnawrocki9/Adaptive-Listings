/**
 * FOLLOW-1389 — a sentence-initial common word is not a proper name in the headline check.
 *
 * `checkHeadlineFacts` treats every capitalised word as a name that must appear in the listing,
 * the first word included. A Polish headline on an English original opens with an ordinary Polish
 * word ("Dom…", "Dwupokojowe…", "Willa…") that the English listing cannot contain, so it was
 * refused as `hallucinated_proper_name` (FOLLOW-1381 live run: 6 of Haiku 5.5's 10 suppressed
 * headlines), and the same happened to an English headline on a Polish original ("Detached…",
 * "Two-bedroom…").
 *
 * The first word is exempt ONLY when it is in the page language's closed list of common
 * headline-opening words (property types, room counts, descriptive adjectives). Exempting the
 * first word outright was rejected: FOLLOW-1382 tells the model to open with a place name when the
 * sources are in another language, so the first word is exactly where an invented place would
 * stand. Negative controls pin that an invented place name is still refused in first position and
 * elsewhere, and that another language's common word gets no exemption.
 */
import { describe, expect, it } from 'vitest';
import { checkHeadlineFacts } from '@/lib/grounding-check';

const FX = {
  original:
    'A three-bedroom, two-bathroom single-family home on a quiet residential street. Open-plan living area, attached two-car garage, screened lanai and a mature garden. Close to schools, the intracoastal waterway and local amenities.',
  context: {
    listing_title: '9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath',
    listing_price: '385000 USD',
    listing_location: '9 Blackberry Pl, Palm Coast, FL',
  },
};
const KRK = {
  original:
    'Bright two-bedroom apartment of 64 sqm on the third floor of a 2019 building in Krakow, Podgorze district.',
  context: { listing_title: 'Two-bedroom apartment, Krakow Podgorze — 64 sqm' },
};
const JAV = {
  original:
    'Detached villa of 210 sqm in the Montgó area of Jávea. Private 10 x 5 m swimming pool. The property holds a tourist rental licence.',
  context: { listing_location: 'Partida Montgó, Jávea, Alicante' },
};
const GDA = {
  original:
    'Dom wolnostojący z 1998 roku w Straszynie pod Gdańskiem, 165 m² powierzchni użytkowej na działce 920 m². Na piętrze trzy sypialnie. Ogród ogrodzony, z drzewami owocowymi.',
  context: {
    listing_title: 'Dom wolnostojący 165 m², Straszyn',
    listing_location: 'Straszyn, pomorskie',
  },
};
const WAW = {
  original:
    'Dwupokojowe mieszkanie 48 m² na 5. piętrze przy ul. Kłobuckiej na warszawskim Mokotowie. Wyjście na loggię. W budynku winda i ochrona.',
  context: { listing_location: 'ul. Kłobucka, Warszawa, Mokotów' },
};

interface Listing {
  original: string;
  context: Record<string, string>;
}
const check = (headline: string, l: Listing, locale?: 'en' | 'pl' | 'es') =>
  checkHeadlineFacts(headline, l.original, l.context, locale);

describe("FOLLOW-1389 — the page language's common opening word is not a name", () => {
  it.each([
    // The FOLLOW-1381 live headlines that were refused on their first word alone.
    ['Dom z trzema sypialniami i zadaszonym lanai w Palm Coast, FL', FX, 'pl'],
    ['Wolnostojący dom z ogrodem na cichej ulicy, Palm Coast, FL', FX, 'pl'],
    ['Willa wolnostojąca z basenem i licencją turystyczną, Jávea', JAV, 'pl'],
    ['Detached house in Straszyn, 165 m² on 920 m² plot, three bedrooms and garden', GDA, 'en'],
    [
      'Two-room flat in Warszawa Mokotów, lift, loggia and secure building on ul. Kłobucka',
      WAW,
      'en',
    ],
    // More of the closed list.
    ['Mieszkanie 64 m², Krakow Podgorze', KRK, 'pl'],
    ['Casa con piscina en Jávea', JAV, 'es'],
    ['Semi-detached house in Straszyn', GDA, 'en'],
  ] as const)('%j is accepted for %s', (headline, l, locale) => {
    expect(check(headline, l, locale)).toBeNull();
  });

  it('the same headlines were refused before (no locale = no exemption)', () => {
    expect(check('Dom z trzema sypialniami i zadaszonym lanai w Palm Coast, FL', FX)).toBe(
      'hallucinated_proper_name',
    );
    expect(check('Detached house in Straszyn, 165 m² on 920 m² plot', GDA)).toBe(
      'hallucinated_proper_name',
    );
  });
});

describe('FOLLOW-1389 — negative controls: invented names are still refused', () => {
  it.each([
    ['Marbella villa with pool', JAV, 'en'],
    ['Marbella: willa z basenem', JAV, 'pl'],
    ['Sopot dom z ogrodem', GDA, 'pl'],
    ['Gdynia, dom wolnostojący 165 m²', GDA, 'pl'],
    // An invented name after a common first word.
    ['Dom w Sopocie z ogrodem', GDA, 'pl'],
    ['Detached house in Sopot', GDA, 'en'],
    // Another language's common word gets no exemption.
    ['Dom with a garden in Palm Coast', FX, 'en'],
    ['Detached dom w Straszynie', GDA, 'pl'],
    // A listed word is exempt only as the FIRST word.
    ['Palm Coast Dom z ogrodem', FX, 'pl'],
  ] as const)('%j is refused for %s', (headline, l, locale) => {
    expect(check(headline, l, locale)).toBe('hallucinated_proper_name');
  });
});
