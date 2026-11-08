/**
 * FOLLOW-1507 — CEO ESC-093 (1), 2026-11-08, "adres to adres", clarified by the CEO the same day:
 * ANY street address passes. A camp's name written in a street-address form passes whether or not
 * it is the listing's own street, with or without a house number, on every listing. A camp's name
 * in prose stays refused, and so does a camp's street in copy with a word that names the camp or
 * its memorial.
 */
import { describe, expect, it } from 'vitest';
import { describesResidentsByProtectedGround as guard } from '../playbooks/traits.js';

describe('FOLLOW-1507: a camp name in any street address passes, on every listing', () => {
  it.each([
    // pl
    'Mieszkanie przy ul. Treblinki 3.',
    'Mieszkanie ul. Treblinki 3.',
    'Blisko parku. Ul. Treblinki 3.',
    'Mieszkanie przy ul. Treblinki.',
    'Sklep przy ul. Treblinki 3.',
    'Mieszkanie przy ulicy Treblinki 3.',
    'Lokal przy al. Majdanek 12A.',
    'Dom na os. Majdanek 4.',
    'Mieszkanie przy ul. Bełżca 4.',
    'ul. Treblinki 3, blisko Muzeum Narodowego.',
    'ul. Treblinki 3, obok Muzeum Pragi.',
    'ul. Treblinki 3, przy parku, pomnik przyrody obok.',
    // es
    'Piso en Calle Sobibor 3.',
    'Supermercado en Calle Sobibor 3.',
    'Calle Sobibor, 3.',
    'C/ Sobibor, 3.',
    'Calle de Sobibor 3.',
    'Calle Sobibor nº 3.',
    'Plaza Auschwitz 2.',
    // en
    'A flat at 5 Treblinka Road.',
    'School at 5 Treblinka Road.',
    'Buses run along Treblinka Road 5 times an hour.',
    'Treblinka Lane, Leeds.',
    '12 Treblinka St, Leeds.',
    'Sobibor Ave 4.',
    '5 Treblinka Road, near the Science Museum.',
  ])('served: %j', (value) => {
    expect(guard(value)).toBe(false);
  });

  it.each([
    // a camp named in prose
    'Obok Treblinki.',
    'Near Treblinka.',
    'Dawny obóz Treblinka.',
    'Treblinka 3 km.',
    'Cerca de Sobibor.',
    'Wycieczka na Majdanek.',
    'Mieszkanie przy Treblince 3.',
    'treblinka road 5.',
    // a camp's street with a word that names the camp or its memorial
    'ul. Treblinki 3, dawny obóz zagłady.',
    'ul. Treblinki 3, były obóz.',
    'ul. Treblinki 3 to miejsce pamięci.',
    'ul. Treblinki 3, pamięci ofiar.',
    'ul. Treblinki 3, obok mauzoleum.',
    'Ul. Majdanek 2 upamiętnia historię.',
    'Ul. Majdanek 2, miejsce kaźni.',
    'ul. Treblinki 3, Zagłada.',
    'Treblinka Road 5, site of extermination.',
    '5 Treblinka Road, by the death camp.',
    '5 Treblinka Road, by the concentration camp.',
    '5 Treblinka Road, the former camp.',
    'Treblinka Road 5, in memory of the victims.',
    'Treblinka Road 5, near the memorial.',
    'Calle Sobibor 3, junto al antiguo campo.',
    'Calle Sobibor 3, junto al campo de concentración.',
    'Calle Sobibor 3, junto al campo de exterminio.',
    'Calle Sobibor 3, en memoria de las víctimas.',
    'Calle Sobibor 3, junto al memorial.',
    'Treblinka Road 5, tours of the camp.',
    'Calle Sobibor 3, cerca del campo.',
    'ul. Majdanek 5, blisko Państwowego Muzeum.',
    'ul. Majdanek 5, obok Muzeum Martyrologii.',
    'ul. Majdanek 5, Muzeum Walki i Męczeństwa.',
    // "os." after a count is "osób", not an estate: no street, so the term is refused
    'Pokój dla 2 os. Treblinka – muzeum 5 km.',
    'Domek dla 4 os. Treblinka 10 min jazdy.',
    'Max 6 os. Auschwitz w pobliżu.',
    'Mieszkanie dla 2 os. Getto było tu dawniej.',
    // composition is read past "os." as past "ul."
    'Most residents of os. Kościuszki are Muslim.',
    'Większość mieszkańców os. Słoneczne to muzułmanie.',
  ])('refused: %j', (value) => {
    expect(guard(value)).toBe(true);
  });

  it('the address spares the camp name only; every other rule still reads the copy', () => {
    expect(guard('ul. Treblinki 3, okolica katolicka.')).toBe(true);
    expect(guard('ul. Treblinki 3, obok getta.')).toBe(true);
    expect(guard('Most residents at ul. Treblinki 3 are Muslim.')).toBe(true);
    expect(guard('Idealne dla rodziny, ul. Treblinki 3.')).toBe(false);
  });
});
