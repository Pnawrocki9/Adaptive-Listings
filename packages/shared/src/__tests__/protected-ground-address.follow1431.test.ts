/**
 * FOLLOW-1431 — the text-only guard gets no new reach: "Adres to adres" is an address of THIS
 * listing, which this guard cannot know, so a model's invented "Holocaust Memorial Drive" is refused
 * here. It loses one: a camp's name gets no marker exemption. The listing's own address is blanked
 * by the callers, tested on the whole paths in the control plane (`own-address.follow1431.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { describesResidentsByProtectedGround } from '../playbooks/traits';

describe('FOLLOW-1431: the guard has no new reach for text that is not the listing own', () => {
  it.each([
    // Markers the mask reads and this guard does not.
    'os. Bohaterów Getta 3.',
    'os. Bohaterów Getta.',
    'Plaza del Gueto.',
    'Plaza del Gueto 3.',
    'Paseo del Holocausto 2.',
    'przy alei Katyńskiej.',
    'przy Alejach Katyńskich 5.',
    // Street words the mask reads and this guard does not.
    'Holocaust Memorial Drive.',
    'Holocaust Memorial Drive 7.',
    'Holocaust Memorial Way 7.',
    '12 Ghetto Way.',
    // Any case.
    'ul. bohaterów getta 5.',
    'ulica bohaterów getta 5.',
    'calle del gueto 5.',
    '7 holocaust memorial drive.',
    'Calle del Gueto 5.',
    // A place or a group named in a street's name was never spared.
    'Calle de la Judería 5.',
    'Calle de la Judería.',
    'Jewish Quarter Road.',
    'Jewish Quarter Road 7.',
    'ul. Dzielnicy Żydowskiej 5.',
    'Muslim Community Street',
    // No marker at all.
    'Bohaterów Getta 5, Warszawa.',
    'Mieszkanie przy Katyńskiej 5.',
    // M6: a camp's name gets no marker exemption at all (CEO: refused outright).
    'ul. Treblinki 3.',
    'ul. Sobibór 5.',
    'ul. Treblinka 5.',
    'ul. Majdanek 5.',
    'al. Majdanek 12.',
    'ul. Bełżec 2.',
    'Calle Sobibór 3.',
    'Treblinka Road.',
    'Auschwitz Street.',
    'Sobibór Avenue',
    'Plac Treblinka to miejsce pamięci',
    'Auschwitz Road tours from here',
    // Outright, and with "dawna" only.
    'The former ghetto is nearby.',
    'A short walk from the Holocaust memorial',
    'Treblinka is nearby.',
    'Blisko Sobiboru.',
    'Bełżec 5 km stąd.',
    'Majdanek 1944.',
    'żydowska dzielnica',
    'Osiedle Żydowskie 3.',
  ])('stays refused: %j', (value) => {
    expect(describesResidentsByProtectedGround(value)).toBe(true);
  });

  it.each([
    // What it already spared, unchanged.
    'Mieszkanie przy ul. Bohaterów Getta 5.',
    'Flat on Ghetto Heroes Street.',
    // Other terms in that position: left for a follow-up, not ruled here.
    'Ghetto Road.',
    'Ghetto Streets',
    'Birkenau Road.',
    'ul. Stutthof 5.',
    'ul. Katyńska 5.',
    'dawna dzielnica żydowska',
    'Ideal for families.',
    'Idealne dla rodziny z dziećmi.',
  ])('still passes: %j', (value) => {
    expect(describesResidentsByProtectedGround(value)).toBe(false);
  });
});
