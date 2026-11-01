/**
 * FOLLOW-1311 slice 4: the attribute lexicon and T8, its closed entailment table. Every attribute
 * with an allowed and a refused case, in en, pl and es, the words that mean something else in their
 * ordinary sentence, negation on both sides, and addresses. `KNOWN_LIMITS` pins what still passes
 * although it is wrong, named so nobody reads a pass as approval.
 *
 * @module apps/control-plane/src/lib/__tests__/claim-attributes.follow1311.test
 */

import { describe, expect, it } from 'vitest';
import { buildClaimGrounding, checkUnsupportedClaims } from '@/lib/claim-containment';
import { checkBodyClaims, checkHeadlineFacts } from '@/lib/grounding-check';
import { maskStreetAddresses } from '@/lib/street-address';
import { checkTypedClaims } from '@/lib/typed-claims';

interface Listing {
  original: string;
  ctx?: Record<string, string>;
}

const verdict = (l: Listing, text: string) => checkBodyClaims(text, l.original, l.ctx ?? {});

/** Nothing about storeys, orientation, furnishing, fittings or tenure, in each language. */
const PLAIN_EN: Listing = { original: 'Flat on the third floor with a lift, near the park.' };
const PLAIN_PL: Listing = { original: 'Mieszkanie na 2. piętrze bloku, w pobliżu parku.' };
const PLAIN_ES: Listing = { original: 'Piso en la segunda planta, cerca del parque.' };
const SINGLE_FAMILY: Listing = {
  original:
    'A three-bedroom single-family home on a quiet street, with an attached garage and a garden.',
};
const ONE_LEVEL: Listing = {
  original: 'Ground-floor bungalow, 68 sqm on one level with no steps from the street.',
};
/** The real house of the baseline: a ground floor, an upstairs, an electrical job still to do. */
const TWO_FLOORS_PL: Listing = {
  original:
    'Dom wolnostojący. Na parterze salon z kominkiem, na piętrze trzy sypialnie. Do wymiany są okna na piętrze i instalacja elektryczna w części budynku.',
};

describe('attributes: an allowed and a refused case in each language', () => {
  it.each<[string, Listing, string]>([
    // Storeys
    ['single-storey', SINGLE_FAMILY, 'This single-storey home has a garden'],
    ['one-story', PLAIN_EN, 'A charming one-story home'],
    ['one storey', PLAIN_EN, 'A one storey home'],
    ['on one level', PLAIN_EN, 'Everything sits on one level.'],
    ['bungalow', SINGLE_FAMILY, 'A bungalow with a garden'],
    ['pl: parterowe', PLAIN_PL, 'Mieszkanie jest parterowe, bez schodów między kondygnacjami'],
    ['pl: a real output', PLAIN_PL, 'Życie w parterowym budownictwie, bez schodów'],
    ['pl: parterowy, the listing has an upstairs', TWO_FLOORS_PL, 'Parterowy dom z kominkiem'],
    ['pl: na jednym poziomie', PLAIN_PL, 'Wszystko na jednym poziomie.'],
    ['pl: jednopoziomowe', PLAIN_PL, 'Jednopoziomowe mieszkanie'],
    ['es: casa de una planta', PLAIN_ES, 'Casa de una planta'],
    ['es: en una sola planta', PLAIN_ES, 'Todo en una sola planta.'],
    // Top floor
    ['top-floor flat', PLAIN_EN, 'A top-floor flat with a lift'],
    ['the replay: a floor number is not the top', PLAIN_EN, 'A buyer sees a top-floor walk-up'],
    ['pl: na ostatnim piętrze', PLAIN_PL, 'Mieszkanie na ostatnim piętrze'],
    ['es: última planta', PLAIN_ES, 'Piso en la última planta'],
    // Detached
    ['detached', PLAIN_EN, 'A detached house near the park'],
    ['detached, two words before the noun', PLAIN_EN, 'A detached family home'],
    ['pl: wolnostojący dom', PLAIN_PL, 'Dom wolnostojący w pobliżu parku'],
    ['es: casa independiente', PLAIN_ES, 'Casa independiente cerca del parque'],
    // Orientation
    ['south-facing', PLAIN_EN, 'South-facing'],
    ['south-west names the south', PLAIN_EN, 'A south-west-facing flat'],
    ['faces south', PLAIN_EN, 'The living room faces south.'],
    ['pl: okna na południe', PLAIN_PL, 'Okna na południe'],
    ['pl: od strony południowej', PLAIN_PL, 'Salon od strony południowej'],
    ['es: orientado al sur', PLAIN_ES, 'Piso orientado al sur'],
    ['es: orientación sur', PLAIN_ES, 'Con orientación sur'],
    // Furnished
    ['fully furnished', PLAIN_EN, 'Fully furnished'],
    ['sold furnished', PLAIN_EN, 'The flat is sold furnished.'],
    ['pl: w pełni umeblowane', PLAIN_PL, 'W pełni umeblowane'],
    ['es: amueblado', PLAIN_ES, 'Se vende amueblado'],
    // Solar
    ['solar panels', PLAIN_EN, 'Solar panels on the roof'],
    ['pl: fotowoltaika', PLAIN_PL, 'Dach z fotowoltaiką'],
    ['pl: panele słoneczne', PLAIN_PL, 'Panele słoneczne na dachu'],
    ['es: placas solares', PLAIN_ES, 'Placas solares en el tejado'],
    // Tenure and fees
    ['vacant possession', PLAIN_EN, 'Vacant possession'],
    ['freehold', PLAIN_EN, 'The flat is freehold.'],
    ['low fees', PLAIN_EN, 'Low service charges'],
    ['pl: niski czynsz', PLAIN_PL, 'Niski czynsz'],
    ['pl: bez najemców', PLAIN_PL, 'Sprzedaż bez najemców'],
    ['pl: pełna własność', PLAIN_PL, 'To pełna własność.'],
    ['es: libre de inquilinos', PLAIN_ES, 'Libre de inquilinos'],
    ['es: comunidad baja', PLAIN_ES, 'Gastos de comunidad bajos'],
    // New installations
    ['new electrics', PLAIN_EN, 'New electrics throughout'],
    ['rewired', PLAIN_EN, 'Fully rewired.'],
    ['new boiler', PLAIN_EN, 'A new boiler'],
    ['pl: nowa instalacja elektryczna', PLAIN_PL, 'Nowa instalacja elektryczna'],
    ['pl: "do wymiany" is no new installation', TWO_FLOORS_PL, 'Nowa instalacja elektryczna'],
    ['es: instalación eléctrica nueva', PLAIN_ES, 'Instalación eléctrica nueva'],
  ])('refused, the listing does not say it: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBe('unsupported_attribute');
  });

  it.each<[string, Listing, string]>([
    ['on one level', ONE_LEVEL, 'Everything sits on one level.'],
    [
      'on a single level of its area',
      { original: 'All on a single level of 68 sqm.' },
      'A one-level home',
    ],
    ['es: en una sola planta, on an English listing', ONE_LEVEL, 'Todo en una sola planta.'],
    [
      'es: casa de una planta',
      { original: 'Casa de una planta con jardín.' },
      'Una casa de una sola planta',
    ],
    ['top-floor', { original: 'Flat on the top floor.' }, 'A top-floor flat'],
    ['pl: ostatnie piętro', { original: 'Mieszkanie, ostatnie piętro.' }, 'A top-floor flat'],
    ['detached', { original: 'Detached villa with a pool.' }, 'A detached villa'],
    ['pl: for en', TWO_FLOORS_PL, 'A detached house with a fireplace'],
    ['es: for pl', TWO_FLOORS_PL, 'Casa independiente con chimenea'],
    ['south-facing', { original: 'South-facing garden.' }, 'The garden faces south.'],
    ['pl: for en', { original: 'Balkon od strony zachodniej.' }, 'A west-facing balcony'],
    ['en: for pl', { original: 'West-facing balcony.' }, 'Balkon od strony zachodniej'],
    ['es: for en', { original: 'South-facing garden.' }, 'Jardín orientado al sur'],
    ['south-west grounds the south', { original: 'South-west-facing.' }, 'A south-facing flat'],
    ['furnished', { original: 'Sold furnished.' }, 'Fully furnished'],
    ['pl: for en', { original: 'Apartament jest umeblowany.' }, 'The flat is furnished.'],
    ['es: for pl', { original: 'Sold furnished.' }, 'W pełni umeblowane'],
    ['es: amueblado', { original: 'Piso amueblado.' }, 'Se vende amueblado'],
    ['a spec field', { original: 'Flat.', ctx: { furnished: 'yes' } }, 'Fully furnished'],
    ['with furniture', { original: 'Sold with all furniture.' }, 'Sold furnished.'],
    ['solar', { original: 'Solar panels on the roof.' }, 'Panele słoneczne na dachu'],
    ['pl: fotowoltaika', { original: 'Dom z fotowoltaiką.' }, 'Solar panels on the roof'],
    ['es: placas', { original: 'Placas solares.' }, 'Solar panels on the roof'],
    ['vacant', { original: 'Sold with vacant possession.' }, 'Vacant possession'],
    ['pl: wolne od najemców', { original: 'Wolne od najemców.' }, 'Vacant possession'],
    ['freehold', { original: 'Full freehold.' }, 'The flat is freehold.'],
    ['pl: niski czynsz', { original: 'Niski czynsz.' }, 'Niski czynsz'],
    ['es: comunidad', { original: 'Gastos de comunidad bajos.' }, 'Low service charges'],
    ['new electrics', { original: 'New electrics in 2022.' }, 'New electrics throughout'],
    [
      'pl: the baseline flat',
      { original: 'Remont w 2022 roku: nowa instalacja elektryczna, okna.' },
      'New electrics throughout',
    ],
    ['a new boiler', { original: 'Nowy piec z 2021 roku.' }, 'A new gas boiler'],
  ])('allowed, the listing says it: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBeNull();
  });
});

describe('T8: the closed entailment table', () => {
  it.each<[string, Listing, string]>([
    ['garage → parking', SINGLE_FAMILY, 'Parking for the family car'],
    // The borderline, allowed: see `lib/attribute-lexicon.ts`.
    ['single-family home → detached', SINGLE_FAMILY, 'A detached family home'],
    ['the FOLLOW-1381 headline', SINGLE_FAMILY, 'Wolnostojący dom z ogrodem'],
    ['ground-floor, one level → parterowy', ONE_LEVEL, 'Parterowy bungalow'],
    ['bungalow → single-storey', { original: 'A bungalow.' }, 'A single-storey home'],
    ['parterowy → one level', { original: 'Dom parterowy.' }, 'All on one level.'],
    ['parterowy dom → bungalow', { original: 'Dom parterowy.' }, 'A bungalow'],
    ['single-storey house → bungalow', { original: 'Single-storey house.' }, 'A bungalow'],
    ['ground floor → parterowy', { original: 'Lokal na parterze kamienicy.' }, 'Parterowy lokal'],
    ['Własność → freehold', { original: 'Własność, księga wieczysta.' }, 'It is freehold.'],
    ['księga wieczysta → freehold', { original: 'Z księgą wieczystą.' }, 'It is freehold.'],
    [
      'replaced → new',
      { original: 'Wymieniona instalacja elektryczna.' },
      'Nowa instalacja elektryczna',
    ],
    ['rewired → new', { original: 'Flat rewired in 2020.' }, 'New electrics'],
  ])('allowed: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBeNull();
  });

  it.each<[string, Listing, string]>([
    ['single-family → single-storey', SINGLE_FAMILY, 'A single-storey home'],
    [
      'a single-family townhouse → detached',
      { original: 'A single-family home, a townhouse.' },
      'A detached house',
    ],
    ['unifamiliar → independiente', { original: 'Vivienda unifamiliar.' }, 'Casa independiente'],
    ['dom jednorodzinny → detached', { original: 'Dom jednorodzinny.' }, 'A detached house'],
    ['one level → bungalow', { original: 'Apartment on one level.' }, 'A bungalow'],
    ['ground floor → one level', { original: 'Flat on the ground floor.' }, 'All on one level.'],
    ['ground floor, upstairs → parterowy', TWO_FLOORS_PL, 'Parterowe mieszkanie'],
    ['another point of the compass', { original: 'West-facing balcony.' }, 'South-facing'],
    ['spółdzielcze własnościowe → freehold', { original: 'Spółdzielcze.' }, 'It is freehold.'],
    ['a floor number → top floor', { original: '4th floor flat.' }, 'A top-floor flat'],
    ['a tenant → vacant', { original: 'Sprzedaż z najemcą.' }, 'Vacant possession'],
    ['własność spółdzielcza → freehold', { original: 'Własność spółdzielcza.' }, 'It is freehold.'],
  ])('refused: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBe('unsupported_attribute');
  });
});

describe('a word read in its own sentence is not the attribute', () => {
  it.each<[string, Listing, string]>([
    ['first-floor bedroom', PLAIN_EN, 'A first-floor bedroom overlooks the park'],
    ['a story', PLAIN_EN, 'The flat tells a single story of quiet living.'],
    ['one level up', PLAIN_EN, 'The roof is one level up.'],
    ['one level away', PLAIN_EN, 'The park is one level from the street.'],
    ['on one level of the building', PLAIN_EN, 'A lift stops on one level of the building.'],
    ['a single-storey extension', PLAIN_EN, 'A single-storey extension at the rear'],
    ['the top floor of a house', PLAIN_EN, 'Bedrooms on the top floor'],
    ['a neighbour bungalow', PLAIN_EN, 'Next to a neighbouring bungalow'],
    ['bungalows in the street', PLAIN_EN, 'A street of bungalows'],
    ['pl: parter of the building', PLAIN_PL, 'Lokal na parterze kamienicy'],
    ['pl: a single-storey outbuilding', PLAIN_PL, 'Parterowa dobudówka'],
    ['pl: level with the street', PLAIN_PL, 'Na jednym poziomie z ulicą'],
    ['es: planta, a plant', PLAIN_ES, 'Una planta en el salón'],
    ['es: planta, a leaf', PLAIN_ES, 'Las hojas de una planta'],
    ['es: planta baja', PLAIN_ES, 'En planta baja hay salón'],
    ['es: una sola planta de interior', PLAIN_ES, 'Con una sola planta de interior'],
    ['detached garage', SINGLE_FAMILY, 'A detached garage at the rear'],
    ['detached from', PLAIN_EN, 'Detached from the noise of the city'],
    ['pl: a bath', PLAIN_PL, 'Łazienka z wolnostojącą wanną'],
    ['pl: a bath after', PLAIN_PL, 'Wanna wolnostojąca w łazience'],
    ['es: a door', PLAIN_ES, 'Casa con entrada independiente'],
    ['es: insulated', PLAIN_ES, 'Una casa bien aislada'],
    ['South Beach', PLAIN_EN, 'Five minutes from South Beach'],
    ['Palm Coast South', PLAIN_EN, 'A flat in Palm Coast South'],
    ['facing South Beach', PLAIN_EN, 'Facing South Beach'],
    ['facing a district', PLAIN_EN, 'A flat facing North London'],
    ['south of the river', PLAIN_EN, 'South of the river'],
    ['faces south of', PLAIN_EN, 'It faces south of the river'],
    ['street-facing', PLAIN_EN, 'A street-facing shopfront'],
    ['pl: south of a place', PLAIN_PL, 'Okna na południe od Krakowa'],
    ['pl: południowa', PLAIN_PL, 'W południowej dzielnicy'],
    ['pl: od strony of a district', PLAIN_PL, 'Wejście od strony południowej dzielnicy'],
    ['es: al sur', PLAIN_ES, 'Al sur de Madrid'],
    ['es: este, this', PLAIN_ES, 'Este piso da al parque'],
    ['furnished with', PLAIN_EN, 'The kitchen is furnished with appliances'],
    ['a furnished kitchen', PLAIN_EN, 'A furnished kitchen'],
    ['pl: umeblowania', PLAIN_PL, 'Mieszkanie do umeblowania'],
    ['pl: a kitchen', PLAIN_PL, 'Umeblowana kuchnia'],
    ['es: a fitted kitchen', PLAIN_ES, 'Cocina amueblada'],
    ['the solarium', PLAIN_EN, 'A solarium on the roof'],
    ['solar gain', PLAIN_EN, 'Good solar gain in winter'],
    ['pl: floor panels', PLAIN_PL, 'Panele podłogowe w salonie'],
    ['es: a plot', PLAIN_ES, 'Un solar cerca del parque'],
    ['a vacant lot', PLAIN_EN, 'A vacant lot next door'],
    ['low rental income', PLAIN_EN, 'A low rental income is priced in'],
    ['low-rent', PLAIN_EN, 'A low-rent district'],
    ['a low price', PLAIN_EN, 'A low price'],
    ['a new owner', PLAIN_EN, 'A new owner can rewire it later'],
    ['pl: not the free word', PLAIN_PL, 'Kilka wolnych dni'],
    ['es: new sports facilities', PLAIN_ES, 'Nuevas instalaciones deportivas'],
    ['family-friendly is no attribute (ESC-089)', PLAIN_EN, 'A family-friendly home'],
  ])('%s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBeNull();
  });
});

describe('an offer, a need or a possibility states nothing', () => {
  it.each<[string, Listing, string]>([
    ['could be furnished', PLAIN_EN, 'It could be furnished for a rental'],
    ['can be sold furnished', PLAIN_EN, 'It can be sold furnished'],
    ['room for solar panels', PLAIN_EN, 'Room for solar panels'],
    ['ideal for', PLAIN_EN, 'A roof ideal for solar panels'],
    ['to add', PLAIN_EN, 'You could add solar panels'],
    ['needs new wiring', PLAIN_EN, 'It needs new wiring'],
    ['pl: można', PLAIN_PL, 'Można zamontować panele słoneczne'],
    ['pl: możliwość', PLAIN_PL, 'Możliwość montażu paneli słonecznych'],
    ['pl: wymaga', PLAIN_PL, 'Wymaga nowej instalacji elektrycznej'],
    ['es: posibilidad', PLAIN_ES, 'Posibilidad de instalar placas solares'],
    ['es: necesita', PLAIN_ES, 'Necesita instalación eléctrica nueva'],
  ])('%s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBeNull();
  });
});

describe('negation', () => {
  it.each<[string, Listing, string]>([
    ['not furnished', { original: 'Not furnished.' }, 'The flat is not furnished.'],
    ['unfurnished', { original: 'Unfurnished.' }, 'An unfurnished flat'],
    ['pl: bez mebli', { original: 'Sprzedawane bez mebli.' }, 'Mieszkanie jest bez mebli.'],
    ['pl: nie umeblowane', { original: 'Mieszkanie bez mebli.' }, 'Nie jest umeblowane.'],
    ['pl: nieumeblowane', { original: 'Nieumeblowane.' }, 'Mieszkanie nieumeblowane'],
    ['es: sin amueblar', { original: 'Piso sin amueblar.' }, 'Se vende sin amueblar'],
    ['es: no amueblado', { original: 'Piso sin amueblar.' }, 'No está amueblado'],
    ['not south-facing', PLAIN_EN, 'It is not south-facing.'],
    ['not a bungalow', PLAIN_EN, 'This is not a bungalow.'],
    ['a list', PLAIN_EN, 'There are no solar panels or new wiring.'],
  ])('allowed in copy: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBeNull();
  });

  it.each<[string, Listing, string]>([
    ['not furnished', { original: 'Not furnished.' }, 'Fully furnished'],
    ['unfurnished', { original: 'Unfurnished flat.' }, 'Fully furnished'],
    ['part-furnished', { original: 'Part-furnished flat.' }, 'Fully furnished'],
    ['pl: bez mebli', { original: 'Sprzedawane bez mebli.' }, 'W pełni umeblowane'],
    ['pl: nieumeblowane', { original: 'Nieumeblowane.' }, 'The flat is furnished.'],
    ['es: sin amueblar', { original: 'Piso sin amueblar.' }, 'Se vende amueblado'],
    ['a spec line', { original: 'Furnished: no.' }, 'The flat is furnished.'],
    ['a field that says no', { original: 'Flat.', ctx: { furnished: 'no' } }, 'Fully furnished'],
    ['no solar panels', { original: 'There are no solar panels.' }, 'Solar panels on the roof'],
    ['an offer', { original: 'Could be sold furnished.' }, 'The flat is furnished.'],
    ['kitchen furniture', { original: 'Sold with its kitchen furniture.' }, 'Sold furnished.'],
  ])('a denied or partial fact grounds nothing: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBe('unsupported_attribute');
  });
});

describe('a street address always passes, and grounds nothing', () => {
  it.each<[string, Listing, string]>([
    ['South Street', PLAIN_EN, 'A flat on South Street'],
    [
      'a house number',
      { original: 'Flat.', ctx: { listing_location: '12 South Street' } },
      'A flat at 12 South Street',
    ],
    [
      'pl: ul. Parterowa',
      { original: 'Mieszkanie.', ctx: { listing_location: 'ul. Parterowa 5' } },
      'Mieszkanie przy ul. Parterowa 5',
    ],
    ['pl: a name form', PLAIN_PL, 'Mieszkanie przy Parterowej'],
    ['es: Calle Solar', PLAIN_ES, 'Piso en la Calle Solar'],
    [
      'es: Calle Solar, a claim word',
      { original: 'Piso.', ctx: { listing_location: 'Calle Energía Solar 12' } },
      'Piso en Calle Energía Solar 12',
    ],
    [
      'the listed address',
      { original: 'Flat.', ctx: { listing_location: 'Bungalow Road 5, Leeds' } },
      'A flat at Bungalow Road 5',
    ],
  ])('passes: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBeNull();
  });

  it.each<[string, Listing, string]>([
    ['ul. Parterowa', { original: 'Mieszkanie, ul. Parterowa 5.' }, 'Parterowe mieszkanie'],
    [
      'a location field',
      { original: 'Flat.', ctx: { listing_location: 'Bungalow' } },
      'A bungalow',
    ],
  ])('an address is no fact: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBe('unsupported_attribute');
  });
});

describe('both paths, and the export AC(1b) calls', () => {
  it('a headline is refused by the same rule', () => {
    expect(checkHeadlineFacts('Single-storey home in Leeds', 'Flat in Leeds.', {}, 'en')).toBe(
      'unsupported_attribute',
    );
    expect(checkHeadlineFacts('Parterowy bungalow', ONE_LEVEL.original, {}, 'pl')).toBeNull();
  });

  it('/api/adapt refuses a slot by the same rule', () => {
    const silent = buildClaimGrounding({ listing_description: 'Flat on the third floor.' });
    expect(checkUnsupportedClaims('South-facing, fully furnished', silent)).toBe(
      'unsupported_attribute',
    );
    const told = buildClaimGrounding({ listing_description: 'South-facing and sold furnished.' });
    expect(checkUnsupportedClaims('South-facing, fully furnished', told)).toBeNull();
  });

  it('checkTypedClaims carries attributes with their key, value and source', () => {
    const sources = [{ field: 'original_description', text: 'A bungalow, sold furnished.' }];
    const attributes = checkTypedClaims('A furnished, south-facing bungalow', sources).filter(
      (c) => c.kind === 'attribute',
    );
    expect(attributes).toEqual([
      {
        kind: 'attribute',
        key: 'bungalow',
        value: 'bungalow',
        source: 'original_description',
        violation: null,
      },
      {
        kind: 'attribute',
        key: 'orientation_south',
        value: 'south-facing',
        source: null,
        violation: 'unsupported_attribute',
      },
      {
        kind: 'attribute',
        key: 'furnished',
        value: 'furnished',
        source: 'original_description',
        violation: null,
      },
    ]);
  });
});

describe('review round: title case', () => {
  it.each<[string, string]>([
    ['bungalow', 'Charming Bungalow'],
    ['detached', 'Modern Detached Villa'],
    ['freehold', 'Stylish Freehold Flat'],
    ['solar, after "With"', 'Villa With Solar Panels'],
    ['orientation first', 'Spacious Flat, South-Facing, Fully Furnished'],
    ['furnished', 'Spacious Flat, Fully Furnished'],
    ['the old limit', 'This is a Detached Villa'],
  ])('refused on a third-floor flat: %s', (_name, text) => {
    expect(verdict(PLAIN_EN, text)).toBe('unsupported_attribute');
  });

  it.each<[string, Listing, string]>([
    [
      'a title grounds furnished',
      { original: 'Modern Fully Furnished Flat' },
      'A fully furnished flat',
    ],
    [
      'a title field',
      { original: 'Flat.', ctx: { listing_title: 'Modern Fully Furnished Flat' } },
      'A fully furnished flat',
    ],
    ['detached', { original: 'Spacious Detached House' }, 'A detached house'],
    ['bungalow', { original: 'Charming Bungalow' }, 'A bungalow'],
  ])('the listing title grounds: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBeNull();
  });

  it.each<[string, string]>([
    ['after a preposition', 'A flat near Solar Panels Way'],
    ['pl: after a preposition', 'Mieszkanie przy Parterowej'],
    ['before a street word', 'Solar Panels Way is close'],
  ])('a name: %s', (_name, text) => {
    expect(verdict(PLAIN_EN, text)).toBeNull();
  });
});

describe('review round: the address ruling', () => {
  it.each<[string, string, string]>([
    ['exactly: ul. parterowa', 'ul. parterowa, Warszawa', 'ul. parterowa'],
    ['exactly: przy ul. parterowa', 'ul. parterowa, Warszawa', 'przy ul. parterowa'],
    ['exactly: freehold road', 'Freehold Road, Leeds', 'freehold road'],
    ['exactly: Freehold Road, Leeds', 'Freehold Road, Leeds', 'Freehold Road, Leeds'],
    ['exactly: Bungalow Avenue', 'Bungalow Avenue, Leeds', 'Bungalow Avenue'],
    ['exactly: Detached House Lane', 'Detached House Lane, Leeds', 'Detached House Lane'],
    ['exactly: Furnished Lane', 'Furnished Lane, Leeds', 'Furnished Lane'],
    ['exactly: Solar Panels Way', 'Solar Panels Way, Leeds', 'Solar Panels Way'],
    ['ul. parterowa', 'ul. parterowa, Warszawa', 'Mieszkanie, ul. parterowa'],
    ['przy ul. parterowa', 'ul. parterowa, Warszawa', 'Mieszkanie przy ul. parterowa'],
    ['freehold road', 'Freehold Road, Leeds', 'A flat on freehold road'],
    ['Freehold Road, Leeds', 'Freehold Road, Leeds', 'A flat at Freehold Road, Leeds'],
    ['Bungalow Avenue', 'Bungalow Avenue, Leeds', 'A flat, Bungalow Avenue'],
    ['Detached House Lane', 'Detached House Lane, Leeds', 'A flat: Detached House Lane'],
    ['Furnished Lane', 'Furnished Lane, Leeds', 'Furnished Lane is close'],
    ['Solar Panels Way', 'Solar Panels Way, Leeds', 'solar panels way is close'],
  ])('a listed street passes: %s', (_name, location, text) => {
    expect(verdict({ original: 'Flat.', ctx: { listing_location: location } }, text)).toBeNull();
  });

  it('with no listed street, a lower-case street prefix still passes', () => {
    expect(verdict(PLAIN_PL, 'Mieszkanie przy ul. parterowa')).toBeNull();
  });

  it.each<[string, string, string]>([
    ['a location that is the word alone', 'Bungalow', 'A bungalow'],
    ['a town named like an attribute', 'Solar Panels, Spain', 'Solar panels on the roof'],
    ['a town and a region', 'Freehold, New Jersey', 'It is freehold.'],
    ['the street blanks only itself', 'Bungalow Road, Leeds', 'A bungalow on Bungalow Road'],
    [
      'the street blanks only itself, freehold',
      'Freehold Road, Leeds',
      'Freehold, on Freehold Road',
    ],
  ])('masking swallows no claim: %s', (_name, location, text) => {
    expect(verdict({ original: 'Flat.', ctx: { listing_location: location } }, text)).toBe(
      'unsupported_attribute',
    );
  });

  it('a street repeated in the description grounds nothing', () => {
    const listing = {
      original: 'Flat on Freehold Road.',
      ctx: { listing_location: 'Freehold Road, Leeds' },
    };
    expect(verdict(listing, 'It is freehold.')).toBe('unsupported_attribute');
  });

  it.each<[string]>([
    ['Plac zabaw w pobliżu'],
    ['Plaza de parking incluida'],
    ['Cicha ulica z basenem'],
    ['Calle con piscina'],
    ['Paseo marítimo'],
  ])('a lower-case word after a street word stays: %s', (text) => {
    expect(maskStreetAddresses(text).replace(/ +/gu, ' ')).toMatch(
      /zabaw|parking|basenem|piscina|marítimo/u,
    );
  });
});

describe('review round: suggestions are not claims', () => {
  it.each<[string, Listing, string]>([
    ['budget for', PLAIN_EN, 'Budget for a new boiler'],
    ['would be a good idea', PLAIN_EN, 'A new boiler would be a good idea'],
    ['imperative', PLAIN_EN, 'Add solar panels'],
    ['put in', PLAIN_EN, 'You could put in solar panels'],
    ['a question', PLAIN_EN, 'Would you add solar panels?'],
    ['a question, furnished', PLAIN_EN, 'Could it be furnished?'],
    ['if', PLAIN_EN, 'If furnished, it lets faster'],
    ['a plural kind', PLAIN_EN, 'Furnished rentals are in demand here'],
    ['a singular kind', PLAIN_EN, 'A furnished flat lets faster.'],
    ['pl: a good idea', PLAIN_PL, 'Fotowoltaika to dobry pomysł'],
    ['es: si', PLAIN_ES, 'Si instalas placas solares, ahorras'],
    ['es: a question', PLAIN_ES, '¿Está amueblado?'],
  ])('passes: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBeNull();
  });

  it.each<[string, Listing, string]>([
    ['a statement after a question', PLAIN_EN, 'Looking for a home? It is fully furnished.'],
    ['a kind with no verb of the market', PLAIN_EN, 'A furnished flat near the park'],
    ['"if" in another clause', PLAIN_EN, 'If you call, the flat is sold furnished.'],
  ])('still a claim: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBe('unsupported_attribute');
  });
});

describe('review round: T8 and synonyms', () => {
  it.each<[string, Listing, string]>([
    ['boiler replaced', { original: 'Boiler replaced in 2023' }, 'New boiler'],
    ['plumbing replaced', { original: 'Plumbing replaced' }, 'New plumbing'],
    ['solar: Panele PV 5 kW', { original: 'Panele PV 5 kW' }, 'Solar panels'],
    ['solar: exactly Instalacja PV', { original: 'Instalacja PV' }, 'Solar panels'],
    ['top: 4th (top) floor', { original: '4th (top) floor' }, 'Top-floor flat'],
    ['top: exactly najwyższym piętrze', { original: 'najwyższym piętrze' }, 'Top-floor flat'],
    ['top: exactly 4/4 piętro', { original: '4/4 piętro' }, 'Top-floor flat'],
    ['south: exactly Okna południowe', { original: 'Okna południowe' }, 'South-facing'],
    ['south: exactly SW-facing', { original: 'SW-facing' }, 'South-facing'],
    ['furnished: exactly', { original: 'w pełni wyposażone' }, 'Umeblowane'],
    ['low: exactly', { original: 'Rent is low' }, 'Low rent'],
    ['pl: piec wymieniony', { original: 'Piec został wymieniony.' }, 'A new boiler'],
    ['solar: panele PV', { original: 'Panele PV na dachu.' }, 'Solar panels on the roof'],
    ['solar: instalacja PV', { original: 'Instalacja PV.' }, 'Solar panels on the roof'],
    ['top: (top) floor', { original: 'Flat on the 4th (top) floor.' }, 'A top-floor flat'],
    ['top: najwyższym piętrze', { original: 'Na najwyższym piętrze.' }, 'A top-floor flat'],
    ['top: 4/4', { original: 'Mieszkanie, 4/4 piętro.' }, 'A top-floor flat'],
    ['south: okna południowe', { original: 'Okna południowe.' }, 'South-facing'],
    ['south: SW-facing', { original: 'SW-facing flat.' }, 'A south-facing flat'],
    ['west: SW-facing', { original: 'SW-facing flat.' }, 'A west-facing flat'],
    ['furnished: wyposażone', { original: 'W pełni wyposażone.' }, 'Umeblowane'],
    ['low: rent is low', { original: 'Rent is low.' }, 'Low rent'],
  ])('allowed: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBeNull();
  });

  it.each<[string, Listing, string]>([
    ['boiler due', { original: 'Boiler to be replaced.' }, 'A new boiler'],
    ['pl: piec do wymiany', { original: 'Piec do wymiany.' }, 'A new boiler'],
    ['a bath count is no floor', { original: 'Flat, 3/3 bath.' }, 'A top-floor flat'],
    ['a kitchen is not furnished', { original: 'W pełni wyposażona kuchnia.' }, 'Umeblowane'],
    ['a kitchen, after', { original: 'Kuchnia jest w pełni wyposażona.' }, 'Umeblowane'],
    ['SW is not east', { original: 'SW-facing flat.' }, 'An east-facing flat'],
    ['low rent, word order', PLAIN_EN, 'The rent is low.'],
  ])('refused: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBe('unsupported_attribute');
  });
});

describe('review round: the whole property, and what a listing withholds', () => {
  const TWO_STOREY: Listing = { original: 'A two-storey house.' };

  it.each<[string, Listing, string]>([
    ['the bedrooms', TWO_STOREY, 'The bedrooms are on one level'],
    ['one level, of a part', PLAIN_EN, 'The roof is on one level.'],
    ['pl: sypialnie', PLAIN_PL, 'Sypialnie na jednym poziomie'],
    ['es: los dormitorios', PLAIN_ES, 'Los dormitorios en una sola planta'],
  ])('a part passes: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBeNull();
  });

  it.each<[string, Listing, string]>([
    ['the house', TWO_STOREY, 'The house is on one level'],
    ['everything', TWO_STOREY, 'Everything sits on one level.'],
    ['the area', { original: 'Flat of 68 sqm.' }, 'All 68 sqm on one level'],
    ['exactly: Solar panels planned', { original: 'Solar panels planned' }, 'Solar panels'],
    ['exactly: not offered', { original: 'Vacant possession not offered' }, 'Vacant possession'],
    ['planned solar', { original: 'Solar panels planned.' }, 'Solar panels on the roof'],
    ['planned, pl', { original: 'Fotowoltaika planowana.' }, 'Solar panels on the roof'],
    ['not offered', { original: 'Vacant possession not offered.' }, 'Vacant possession'],
    ['is not offered', { original: 'Vacant possession is not offered.' }, 'Vacant possession'],
  ])('refused: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBe('unsupported_attribute');
  });
});

describe('regex cost', () => {
  it('16 KB of the word stays linear: the context of a match is a slice, not the whole prefix', () => {
    const text = 'furnished '.repeat(1600);
    const started = performance.now();
    expect(verdict(PLAIN_EN, text)).toBe('unsupported_attribute');
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

/**
 * Wrong copy that still passes. If the recogniser cannot tell, it passes; each of these is on record
 * in the FOLLOW-1311 amendment.
 */
describe('KNOWN_LIMITS: these pass although they are wrong', () => {
  it.each<[string, Listing, string]>([
    ['another storey count', PLAIN_EN, 'A two-storey home'],
    ['semi-detached', PLAIN_EN, 'A semi-detached house'],
    [
      '"detached" on a single-family home that is attached and does not say so',
      SINGLE_FAMILY,
      'A detached house',
    ],
    ['terraced', PLAIN_EN, 'A terraced house'],
    ['a floor position other than the top', PLAIN_PL, 'Mieszkanie na parterze'],
    ['no stairs on a third floor', PLAIN_EN, 'No stairs to climb'],
    ['pl: bez schodów', PLAIN_PL, 'Bez schodów'],
    [
      'the same orientation on another part',
      { original: 'South-facing living room and a terrace.' },
      'A south-facing terrace',
    ],
    ['pl: od południa', PLAIN_PL, 'Salon od południa'],
    [
      'a denial in copy of what the listing has',
      { original: 'Sold furnished.' },
      'It is not furnished.',
    ],
    ['"fully" added to "furnished"', { original: 'Sold furnished.' }, 'Fully furnished'],
    ['furnished with', PLAIN_EN, 'Furnished with designer pieces'],
    ['part-furnished', PLAIN_EN, 'A part-furnished flat'],
    ['sold with furniture', PLAIN_EN, 'Sold with all its furniture'],
    ['"low" on other costs', PLAIN_PL, 'Niskie koszty stałe'],
    ['a capital right after a preposition', PLAIN_EN, 'A flat in Detached Villa country'],
    ['a street word after the claim, unlisted', PLAIN_EN, 'A Detached House Lane flat'],
    ['a question', PLAIN_EN, 'Why not this fully furnished flat?'],
    ['"if" with a real claim after it', PLAIN_EN, 'If you like this fully furnished flat, call.'],
    ['a plural', PLAIN_EN, 'Modern south-facing flats'],
    ['"could" after the word', PLAIN_EN, 'Solar panels could cut your bills.'],
    [
      'the word in the listing, in a name',
      { original: 'Mieszkanie przy Parterowej.' },
      'Parterowe mieszkanie',
    ],
    ['another renewable fitting', PLAIN_EN, 'A new heat pump'],
    ['leasehold', PLAIN_EN, 'The flat is leasehold.'],
    ['new windows', PLAIN_EN, 'New windows throughout'],
  ])('%s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBeNull();
  });

  it.each<[string, Listing, string]>([
    ['a generic remark no simple rule reads', PLAIN_EN, 'Solar panels cut bills.'],
    ['pl: the same', PLAIN_PL, 'Panele słoneczne obniżają rachunki.'],
    ['a street in lower case, not listed', PLAIN_EN, 'A flat on freehold road'],
  ])('the other way: refused although it may be fine: %s', (_name, listing, text) => {
    expect(verdict(listing, text)).toBe('unsupported_attribute');
  });
});
