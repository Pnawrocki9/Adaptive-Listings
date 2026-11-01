/**
 * FOLLOW-1431 — "Adres to adres, ma przechodzić" (CEO), on the text-only guard: an address that
 * carries a marker passes whoever's it is, the street rule judges that. The listing's own address
 * without a marker is blanked by the callers, tested in the control plane.
 */
import { describe, expect, it } from 'vitest';
import { describesResidentsByProtectedGround } from '../playbooks/traits';

describe('FOLLOW-1431: an address with a marker passes the guard', () => {
  it.each([
    'przy alei Katyńskiej.',
    'os. Bohaterów Getta 3.',
    'ul. bohaterów getta 5.',
    'Calle del Gueto 5.',
    'Holocaust Memorial Drive 7.',
    // The forms a real listing writes.
    'przy Alejach Katyńskich 5.',
    'ul. getta 5.',
    'ul. getta.',
    'ulica bohaterów getta 5.',
    'calle del gueto 5.',
    'calle del gueto, 5.',
    'Avenida de las Víctimas del Holocausto 5.',
    'Plaza del Gueto 3.',
    '12 Ghetto Way.',
    'Holocaust Memorial Way 7.',
    '7 holocaust memorial drive.',
    'Treblinka Road 5.',
    'ul. Treblinki 3.',
    'Calle Sobibór 3.',
    'al. Majdanek 12.',
    'ul. Bełżec 2.',
    // A street named by a group is an address, and the street rule judges it [report: collision].
    'Calle de la Judería 5.',
    'Jewish Quarter Road 7.',
    'ul. Dzielnicy Żydowskiej 5.',
  ])('passes: %j', (value) => {
    expect(describesResidentsByProtectedGround(value)).toBe(false);
  });

  it.each([
    'The former ghetto is nearby.',
    'A short walk from the Holocaust memorial',
    // Named places stay refused outright outside an address.
    'Treblinka is nearby.',
    'Blisko Sobiboru.',
    'Bełżec 5 km stąd.',
    'Majdanek 1944.',
    'Treblinka 5 km away.',
    // A marker-free address is the callers' to blank: as text alone it is no address.
    'Bohaterów Getta 5, Warszawa.',
    'Mieszkanie przy Katyńskiej 5.',
    // The street word or the marker has to name the street, not merely stand near the term.
    'Ul. Długa, obok dawnego getta.',
    'ul. cicha obok getta 5 minut pieszo.',
    'ul. Długa 4, blisko getta.',
    'Calle Mayor, cerca del gueto.',
    'cicha ulica z widokiem na getto',
    'calle del gueto',
    'ulica getta',
    '10 minute ghetto drive.',
    'A Holocaust Way of remembering',
    'The Nazi Place',
    'Holocaust Dr Smith',
    'Ghetto Driveway',
    // A place named by a group, only with "dawna".
    'żydowska dzielnica',
    'Żydowska dzielnica 5.',
    'ul. Długa żydowska dzielnica',
    'Osiedle Żydowskie 3.',
  ])('stays refused: %j', (value) => {
    expect(describesResidentsByProtectedGround(value)).toBe(true);
  });

  it.each(['dawna dzielnica żydowska', 'Ideal for families.', 'Idealne dla rodziny z dziećmi.'])(
    'still passes: %j',
    (value) => {
      expect(describesResidentsByProtectedGround(value)).toBe(false);
    },
  );
});
