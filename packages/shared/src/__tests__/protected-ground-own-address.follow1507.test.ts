/**
 * FOLLOW-1507 — CEO ESC-093 (1), 2026-11-08, "adres to adres": a camp's name that is part of the
 * listing's OWN address passes, wherever the listing is; outside an address it stays refused.
 *
 * The listing's own address: `listing_location` when it states a street (a location naming the
 * camp spares it already, FOLLOW-1431); when it states none, the address the listing's own text
 * (description and title) states as its own: a marker or street word with the same house number,
 * after a line start, a comma or a locating word ("przy", "na", "at", "on", "en").
 */
import { describe, expect, it } from 'vitest';
import { describesResidentsByProtectedGround } from '../playbooks/traits.js';

const guard = (value: string, location: string, text: string): boolean =>
  describesResidentsByProtectedGround(value, location, text);

describe('FOLLOW-1507: a camp name in the listing own address passes, wherever the listing is', () => {
  it.each<[string, string, string]>([
    // pl — the Targówek case of ESC-093
    ['Mieszkanie przy ul. Treblinki 3.', 'Warszawa, Targówek', 'Mieszkanie przy ul. Treblinki 3.'],
    ['ul. Treblinki 3, Targówek.', 'Warszawa, Targówek', 'Mieszkanie, ul. Treblinki 3'],
    ['Mieszkanie przy ul. Treblinki 3/5.', 'Warszawa', 'Lokal przy ul. Treblinki 3/5, II piętro.'],
    ['Dom przy ul. Majdanek 12A.', '', 'Dom na ul. Majdanek 12A.'],
    ['Mieszkanie przy ul. Bełżca 4.', 'Lublin', 'Mieszkanie przy ul. Bełżca 4.'],
    // es
    ['Piso en Calle Sobibor 3.', 'Madrid, Tetuán', 'Piso en Calle Sobibór 3, Madrid.'],
    ['Calle Auschwitz 7, Madrid.', 'Madrid', 'Ático: Calle Auschwitz 7.'],
    // en
    ['A flat at 5 Treblinka Road.', 'Leeds', 'Flat at 5 Treblinka Road, Leeds.'],
    ['Treblinka Road 5, Leeds.', 'Leeds', 'Located on Treblinka Road 5.'],
  ])('served: %j on %j, listing text %j', (value, location, text) => {
    expect(guard(value, location, text)).toBe(false);
  });

  it.each<[string, string, string]>([
    // a camp named in prose, the listing's own address or not
    ['Near Treblinka.', 'Warszawa, Targówek', 'Mieszkanie przy ul. Treblinki 3.'],
    ['Blisko Treblinki.', 'Warszawa, Targówek', 'Mieszkanie przy ul. Treblinki 3.'],
    ['Dawny obóz Treblinka.', 'Warszawa, Targówek', 'Mieszkanie przy ul. Treblinki 3.'],
    ['Cerca de Sobibor.', 'Madrid', 'Piso en Calle Sobibor 3.'],
    ['ul. Treblinki 3. The camp at Treblinka.', 'Warszawa', 'Mieszkanie przy ul. Treblinki 3.'],
    ['ul. Treblinki 3, dawny obóz zagłady.', 'Warszawa', 'Mieszkanie przy ul. Treblinki 3.'],
    // the address is spared, the camp is not: a word that recalls it refuses the copy
    ['ul. Treblinki 3 to miejsce pamięci.', 'Warszawa', 'Mieszkanie przy ul. Treblinki 3.'],
    ['ul. Treblinki 3 — the former camp.', 'Warszawa', 'Mieszkanie przy ul. Treblinki 3.'],
    ['Treblinka Road 5, tours of the camp.', 'Leeds', 'Flat on Treblinka Road 5.'],
    ['Calle Sobibor 3, junto al antiguo campo.', 'Madrid', 'Piso en Calle Sobibor 3.'],
    ['Calle Sobibor 3, cerca del museo.', 'Madrid', 'Piso en Calle Sobibor 3.'],
    // an address with no house number in the copy is no proof it is the listing's
    ['Plac Treblinka to miejsce pamięci.', 'Warszawa', 'Mieszkanie przy ul. Treblinki 3.'],
    ['Mieszkanie przy ul. Treblinki.', 'Warszawa', 'Mieszkanie przy ul. Treblinki 3.'],
    // another number, another camp
    ['Mieszkanie przy ul. Treblinki 5.', 'Warszawa', 'Mieszkanie przy ul. Treblinki 3.'],
    ['Mieszkanie przy ul. Majdanek 3.', 'Warszawa', 'Mieszkanie przy ul. Treblinki 3.'],
    // the listing's text names the street but not as its address
    ['ul. Treblinki 12.', 'Warszawa', '5 min od ul. Treblinki 12.'],
    ['ul. Treblinki 12.', 'Warszawa', 'Blisko ul. Treblinki 12 jest park.'],
    ['5 Treblinka Road.', 'Leeds', 'A short walk from 5 Treblinka Road.'],
    ['Calle Sobibor 3.', 'Madrid', 'A 5 minutos de Calle Sobibor 3.'],
    ['ul. Treblinki 12.', 'Warszawa', 'Treblinka 12 km.'],
    ['ul. Treblinki 3.', 'Warszawa', 'Mieszkanie przy Treblince 3.'],
    // a location that states another street is the listing's address
    ['ul. Treblinki 3.', 'ul. Długa 5, Warszawa', 'Mieszkanie przy ul. Treblinki 3.'],
    ['5 Treblinka Road.', '12 Elm Road, Leeds', 'Flat at 5 Treblinka Road.'],
    ['Calle Sobibor 3.', 'Calle Mayor 5, Madrid', 'Piso en Calle Sobibor 3.'],
    // no listing text: a street the listing does not have
    ['Mieszkanie przy ul. Treblinki 3.', 'Warszawa, Targówek', ''],
    ['Calle Sobibor 3.', 'Madrid', ''],
    ['5 Treblinka Road.', 'Leeds', ''],
  ])('refused: %j on %j, listing text %j', (value, location, text) => {
    expect(guard(value, location, text)).toBe(true);
  });

  it.each<[string, string]>([
    ['ul. Treblinki 3 to miejsce pamięci.', 'ul. Treblinki 3, Warszawa'],
    ['Treblinka Road 5, near the memorial.', 'Treblinka Road 5, Warszawa'],
    ['Calle Sobibor 3, junto al antiguo campo.', 'Calle Sobibór 3, Madrid'],
  ])('a location that names the camp no longer spares a word that recalls it: %j on %j', (v, l) => {
    expect(guard(v, l, '')).toBe(true);
  });

  it('the own address spares the camp name only; every other rule still reads the copy', () => {
    const text = 'Mieszkanie przy ul. Treblinki 3.';
    expect(guard('ul. Treblinki 3, okolica katolicka.', 'Warszawa', text)).toBe(true);
    expect(guard('ul. Treblinki 3, obok getta.', 'Warszawa', text)).toBe(true);
    expect(guard('Most residents at ul. Treblinki 3 are Muslim.', 'Warszawa', text)).toBe(true);
    expect(guard('Idealne dla rodziny, ul. Treblinki 3.', 'Warszawa', text)).toBe(false);
  });
});
