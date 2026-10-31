/**
 * FOLLOW-1311 slice 3, review round: every example of the independent review, with its expected
 * verdict. `KNOWN_LIMITS` pins what still passes although it is wrong, named so nobody reads a pass
 * as approval. The principle: if the recogniser cannot tell, it passes.
 *
 * @module apps/control-plane/src/lib/__tests__/claim-review.follow1311.test
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBodyClaims } from '@/lib/grounding-check';

interface Listing {
  original: string;
  ctx?: Record<string, string>;
}

const verdict = (l: Listing, text: string) => checkBodyClaims(text, l.original, l.ctx ?? {});

const THREE_TWO: Listing = {
  original: 'A three-bedroom, two-bathroom home with a garage and a garden on a quiet street.',
  ctx: { listing_price: '385000 USD', listing_location: 'Palm Coast, FL' },
};
const POOL_GARDEN: Listing = {
  original:
    'A home with a private pool, a garden, a lift, a garage, parking and a school at the corner.',
  ctx: { listing_price: '385000 USD' },
};

describe('a street address always passes (CEO 2026-10-30), and is read as nothing', () => {
  it.each<[string, Listing, string]>([
    [
      'the street is no bath',
      { original: 'Flat with 2 bathrooms.', ctx: { listing_location: 'Bath Road 12' } },
      'Flat at 12 Bath Road',
    ],
    [
      'the street is no money',
      { original: 'Flat near the sea.', ctx: { listing_location: '5 Pound Lane' } },
      'Flat at 5 Pound Lane',
    ],
    [
      'Złota is no zloty',
      {
        original: 'Mieszkanie.',
        ctx: { listing_title: 'Mieszkanie 44 m²', listing_location: 'ul. Złota' },
      },
      'Mieszkanie przy ul. Złota 44',
    ],
    [
      'the number is no year',
      { original: 'Newly built home at 2015 Ocean Drive.' },
      'Renovated home at 2015 Ocean Drive',
    ],
    [
      'a named street in a location field',
      { original: 'Flat.', ctx: { listing_location: 'Rynek 5, Kraków' } },
      'Flat at Rynek 5',
    ],
    ['Polish', { original: 'Mieszkanie przy ul. 3 Maja 12.', ctx: {} }, 'Adres: ul. 3 Maja 12'],
    ['Spanish', { original: 'Piso en calle de la Paz 7.', ctx: {} }, 'Piso en calle de la Paz 7'],
  ])('%s', (_name, l, text) => {
    expect(verdict(l, text)).toBeNull();
  });

  it('the listing side derives no fact from its address either', () => {
    const l = { original: 'Mieszkanie przy ul. Złota 44.', ctx: {} };
    // "Złota 44" was read as PLN 44, which grounded this invented rent.
    expect(verdict(l, 'Czynsz 44 zł')).toBe('money_mismatch');
    expect(verdict({ original: 'Flat at 2 Bath Road, 1 bathroom.' }, '1 bathroom')).toBeNull();
  });

  it('a ZIP code is no price', () => {
    const l = {
      original: 'Home.',
      ctx: { listing_title: '9 Blackberry Pl, Palm Coast, FL 32137', listing_price: '385000 USD' },
    };
    expect(verdict(l, 'Listed at $32,137')).toBe('money_mismatch');
  });
});

describe('T9: only a denial of the thing itself', () => {
  it.each<[string]>([
    ['A private pool — no neighbours overlooking it'],
    ['Parking: no permit needed'],
    ['No parking permit needed, thanks to the garage'],
    ['No lift needed on the ground floor'],
    ['No garden of your own to maintain'],
    ['No pool on site, the municipal pool is close'],
    ['No school commute: the school is at the corner'],
    ['No pool to maintain'],
  ])('passes: %s', (text) => {
    expect(verdict(POOL_GARDEN, text)).toBeNull();
  });

  it.each<[Listing, string]>([
    [{ original: 'Mieszkanie z ogrodem i tarasem.' }, 'Ogród — nie wymaga koszenia'],
    [{ original: 'Piso con jardín.' }, 'Jardín: sin mantenimiento'],
    [{ original: 'Garage not included in the price.' }, 'No garage included'],
  ])('passes: %#', (l, text) => {
    expect(verdict(l, text)).toBeNull();
  });

  it.each<[Listing, string]>([
    [POOL_GARDEN, 'There is no garage here'],
    [POOL_GARDEN, 'A home without a garden'],
    [POOL_GARDEN, 'It does not have a garage'],
    [POOL_GARDEN, 'Pool: no.'],
    [{ original: 'Piso con garaje.' }, 'No tiene garaje'],
    [{ original: 'Mieszkanie z garażem.' }, 'Nie posiada garażu'],
  ])('refused: %#', (l, text) => {
    expect(verdict(l, text)).toBe('negation_contradiction');
  });
});

describe('T4: an act decides the year', () => {
  it.each<[Listing, string]>([
    [{ original: 'Remont w 2021 roku.' }, 'Remont budynku w 2021 roku'],
    [{ original: 'Renovated in 2021.' }, 'Renovated building 2021'],
    [{ original: 'A 2019 building, renovated flat.' }, 'A renovated flat in a 2019 building'],
  ])('passes: %#', (l, text) => {
    expect(verdict(l, text)).toBeNull();
  });
});

describe('T1: money and period, false refusals', () => {
  it.each<[Listing, string]>([
    [
      { original: 'Home built 1998.', ctx: { listing_price: '385000 GBP' } },
      '£385,000 / year built 1998',
    ],
    [
      { original: 'Rok budowy 2015.', ctx: { listing_price: '949000 PLN' } },
      'Cena 949 000 zł / rok budowy 2015',
    ],
    [{ original: '3 pokoje.', ctx: { listing_price: '949000 PLN' } }, 'Cena 949 000 zł 3 pokoje'],
    [{ original: 'HOA dues of 250 a month.' }, '$250 a month'],
    [{ original: 'Na miesiąc czynsz wraz z opłatami dla wspólnoty wynosi 610.' }, '610 zł czynszu'],
    [{ original: 'Cena 1,15 mln.' }, 'Cena 1,15 mln zł'],
    [{ original: 'Flat.', ctx: { listing_price: '2500 EUR/month' } }, '€2,500 per month'],
  ])('passes: %#', (l, text) => {
    expect(verdict(l, text)).toBeNull();
  });

  it.each<[Listing, string]>([
    [
      { original: 'Mieszkanie.', ctx: { listing_price: '949000 PLN' } },
      'Czynsz 949 000 zł miesięcznie',
    ],
    [{ original: 'Price €240,000. Rent 900 EUR.' }, 'Rent of €240,000 per month'],
    [{ original: 'Sale.', ctx: { listing_price: '240000 EUR', rent: '900 EUR' } }, 'Price €900'],
    [{ original: 'Piso.', ctx: { listing_price: '385000 EUR' } }, '385.000 dólares'],
    [{ original: 'Piso.', ctx: { listing_price: '385000 EUR' } }, '385.000 libras'],
    [{ original: 'Flat.', ctx: { listing_price: '385000 EUR' } }, 'US$385,000'],
  ])('refused: %#', (l, text) => {
    expect(verdict(l, text)).toBe('money_mismatch');
  });
});

describe('counts: an unread count poisons nothing', () => {
  it.each<[Listing, string]>([
    [{ original: 'Three large bedrooms, one bedroom has an en-suite.' }, 'Three bedrooms'],
    [{ original: 'Trzy duże sypialnie, jedna sypialnia ma łazienkę.' }, 'Trzy sypialnie'],
    [{ original: '2-3 bedroom apartments.' }, 'A two-bedroom apartment'],
    [{ original: 'A one-bedroom flat with a guest room.' }, 'Two beds in the guest room'],
    [{ original: 'A one-car garage.' }, 'Room for two cars'],
    [{ original: 'Three beautifully finished and very large bedrooms.' }, 'A one-bedroom suite'],
    // Found by the replay: "Studio" written as "Kawalerka"; a 1 in a list of one floor.
    [{ original: 'Studio apartment, 32 sqm.' }, 'Kawalerka o powierzchni 32 m²'],
    [
      { original: 'Na parterze pokój i łazienka, na piętrze trzy sypialnie i druga łazienka.' },
      'En planta baja una habitación y un baño; en planta alta, tres dormitorios',
    ],
  ])('passes: %#', (l, text) => {
    expect(verdict(l, text)).toBeNull();
  });
});

describe('counts: wrong numbers that are now refused', () => {
  const TWO_BED: Listing = { original: 'A two-bedroom flat.' };
  it.each<[Listing, string]>([
    [THREE_TWO, 'Four spacious bedrooms'],
    [{ original: 'Trzy sypialnie.' }, 'Pięć dużych sypialni'],
    [THREE_TWO, 'A two bedroom home'],
    [{ original: '4 bedrooms and 3 bathrooms.' }, '3 bedrooms and 3 bathrooms'],
    [TWO_BED, 'Sześciopokojowe mieszkanie'],
    [TWO_BED, 'A five-room flat'],
    [{ original: '3BR/2BA condo.' }, 'A four-bedroom home'],
    [THREE_TWO, 'Nine bedrooms'],
    [{ original: 'Studio.', ctx: { bedrooms: '0' } }, 'A one-bedroom flat'],
  ])('refused: %#', (l, text) => {
    expect(verdict(l, text)).toBe('count_mismatch');
  });

  it('the stated count wins over a derived one: no +1 in either direction', () => {
    expect(verdict(TWO_BED, 'Trzypokojowe mieszkanie')).toBe('count_mismatch');
    expect(verdict({ original: 'Mieszkanie trzypokojowe.' }, 'A two-bedroom flat')).toBe(
      'count_mismatch',
    );
    expect(verdict(TWO_BED, 'A two-bedroom flat')).toBeNull();
  });
});

describe('KNOWN LIMITS: wrong, and still passing, on purpose', () => {
  it.each<[string, Listing, string]>([
    ['"private" cannot be told from shared', POOL_GARDEN, 'No private garden'],
    ['a plain count under the stated one may be a part', THREE_TWO, 'Two bedrooms and a garden'],
    [
      'a plain room count on a bedroom listing: "Dwa pokoje to …" is real copy',
      { original: 'A two-bedroom flat.' },
      'Dwa pokoje',
    ],
    [
      'a listing price with no currency accepts any currency',
      { original: 'Flat.', ctx: { listing_price: '385000' } },
      'Listed at €385,000',
    ],
    [
      'the right number on the wrong part of the property',
      { original: 'Mieszkanie 64 m².' },
      '64 m² działki',
    ],
    [
      'a number the listing states as something else, with a currency added',
      { original: 'Dom z 3 pokojami i ogrodem o szerokości 12 metrów.' },
      'Czynsz 12 zł',
    ],
  ])('%s', (_name, l, text) => {
    expect(verdict(l, text)).toBeNull();
  });
});

describe('quality', () => {
  it('AREA_RE cannot be retried at every position of a digit run', () => {
    const source = readFileSync(path.resolve(__dirname, '../typed-claims.ts'), 'utf8');
    const line = /const AREA_RE = new RegExp\(\s*`([^`]+)`/u.exec(source)?.[1] ?? '';
    expect(line.startsWith('(?<![\\\\p{Nd}.,])(\\\\p{Nd}[\\\\p{Nd}.,]*)')).toBe(true);
  });
});
