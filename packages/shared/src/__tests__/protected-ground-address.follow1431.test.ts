/**
 * FOLLOW-1431 — this guard is only ever tighter than origin/main. The third column is the verdict of
 * the guard at origin/main `55679f49`, recorded by running that code on each sentence, as literal
 * values and never recomputed: `[sentence, listing_location, refused there, refused now]`. It spares
 * nothing new: the listing's own address has no exemption here, which is FOLLOW-1431's open limit.
 * FOLLOW-1507 (ESC-093 (1)) closes it through the guard's third argument, the listing's own text,
 * which no case here passes; its pins are `protected-ground-own-address.follow1507.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { describesResidentsByProtectedGround } from '../playbooks/traits.js';

const RECORDED: [string, string, boolean, boolean][] = [
  ['The memorial at Treblinka.', 'ul. Polna 3, 08-140 Treblinka', true, true],
  ['Dom przy Treblince.', 'ul. Polna 3, 08-140 Treblinka', true, true],
  ['The museum at Bełżec.', 'ul. Polna 3, 22-670 Bełżec', true, true],
  ['The memorial at Treblinka.', 'Treblinka 12, mazowieckie', true, true],
  ['10 minutes from the former ghetto.', 'Kraków, 10 minutes from the former ghetto', true, true],
  ['5 min from Treblinka', '5 min from Treblinka, Warszawa', true, true],
  ['The Jewish quarter is 200 m away.', 'Kraków, the Jewish quarter is 200 m away', true, true],
  ['The ghetto is 3 km away.', '', true, true],
  ['2 km od dawnego getta.', '', true, true],
  ['The camp at Treblinka.', '', true, true],
  ['Wycieczka na Majdanek.', '', true, true],
  ['przy Katyńskiej, miejsce zbrodni.', 'ul. Katyńska 5, Warszawa', true, true],
  ['Stara ul. Długa 5 żydowska dzielnica.', 'ul. Długa 5, Warszawa', true, true],
  ['In the old 12 Elm Road Jewish quarter.', '12 Elm Road, Leeds', true, true],
  ['Pomnik Bohaterów Getta 5 przystanków stąd.', 'Bohaterów Getta 5, Warszawa', true, true],
  ['Pomnik Zbrodni Katyńskiej 5 przecznic stąd.', 'ul. Katyńska 5, Warszawa', true, true],
  ['Zbrodnia Katyńska 5.', 'ul. Katyńska 5, Warszawa', true, true],
  ['Obok Getta 5.', 'ul. Getta 5, Warszawa', true, true],
  ['The former ghetto road is gone.', '12 Ghetto Road, Leeds', true, true],
  ['The old holocaust memorial drive.', '12 Holocaust Memorial Drive, Miami', true, true],
  ['ul. Sobibór 5.', 'ul. Sobieskiego 5, Warszawa', false, true],
  ['ul. Treblinka 5.', 'ul. Trebnicka 5, Warszawa', false, true],
  ['ul. Majdanek 5.', 'Warszawa', false, true],
  ['Treblinka Road.', 'Warszawa', false, true],
  ['Auschwitz Street.', 'Warszawa', false, true],
  ['Sobibór Avenue', 'Warszawa', false, true],
  ['Plac Treblinka to miejsce pamięci', 'Warszawa', false, true],
  ['Auschwitz Road tours from here', 'Warszawa', false, true],
  ['Most residents at ul. Długa 5 are Muslim.', 'ul. Długa 5, Warszawa', false, true],
  ['Większość mieszkańców ul. Długiej 5 to katolicy.', 'ul. Długa 5, Warszawa', false, true],
  ['La mayoría de los vecinos de C. Mayor 5 son musulmanes.', 'C. Mayor 5, Madrid', false, true],
  ['Ghetto Road.', 'Warszawa', false, false],
  ['Ghetto Streets', 'Warszawa', false, false],
  ['ul. Bohaterów Getta 5.', 'Warszawa', false, false],
  ['Birkenau Road.', 'Warszawa', false, false],
  ['ul. Stutthof 5.', 'Warszawa', false, false],
  ['ul. Katyńska 5.', 'Warszawa', false, false],
  ['The former ghetto is nearby.', 'Bohaterów Getta 5, Warszawa', true, true],
  ['A short walk from the Holocaust memorial', 'Holocaust Memorial Drive 7, Miami', true, true],
  ['Dom w Treblince.', 'Treblinka, mazowieckie', true, true],
  ['żydowska dzielnica', 'Warszawa', true, true],
  ['Dawna dzielnica żydowska obok.', 'Warszawa', false, false],
  ['Idealne dla rodziny z dziećmi.', 'Warszawa', false, false],
  ['obóz przy Treblince 5.', 'Treblinka 5, mazowieckie', true, true],
  ['The memorial at Treblinka 5.', 'Treblinka 5, mazowieckie', true, true],
  ['pomnik ofiar przy Katyńskiej 5.', 'ul. Katyńska 5, Warszawa', true, true],
  ['przy Katyńskiej 5. Miejsce zbrodni.', 'ul. Katyńska 5, Warszawa', true, true],
  ['Treblinka 5. The camp stood here.', 'Treblinka 5, mazowieckie', true, true],
  ['Kraków, żydowska dzielnica 3.', 'Kraków, żydowska dzielnica 3', true, true],
  ['Obóz Treblinka 5.', 'Obóz Treblinka 5', true, true],
  ['ul. Długa\nul. Długa 5\nGetto obok.', 'ul. Długa 5, Warszawa', true, true],
  ['ul. Treblinka 5.', 'Treblinka, mazowieckie', false, false],
  ['ul. Treblinki 3.', 'ul. Treblinki, Warszawa', false, false],
  ['ul. Bełżca 3.', 'ul. Bełżec 3, Lublin', false, false],
  ['Calle Sobibor 3.', 'Calle Sobibór 3, Madrid', false, false],
  ['ul. Majdanek 3.', 'ul. Treblinki 3, Warszawa', false, true],
  ['Treblinka Road 5.', 'Treblinka Road 5, Warszawa', false, false],
  ['ul. Treblinki 3.', 'ul. Treblinki 3, Warszawa', false, false],
  ['Dom przy Treblince 5.', 'Treblinka 5, mazowieckie', true, true],
  ['Ideal for families.', '', false, false],
  ['Steps from the old Jewish quarter', '', false, false],
  ['Mieszkanie przy ul. Bohaterów Getta 5.', '', false, false],
  ['Flat on Ghetto Heroes Street.', '', false, false],
  ['Most residents enjoy the park.', '', false, false],
  ['Większość mieszkań ma balkon.', '', false, false],
  ['dawna dzielnica żydowska', '', false, false],
  ['ul. Treblinki 3.', '', false, true],
];

describe('FOLLOW-1431: the guard, against the verdicts recorded at origin/main', () => {
  it.each(RECORDED)('%j on %j', (value, location, wasRefused, isRefused) => {
    const refused = describesResidentsByProtectedGround(value, location);
    expect(refused).toBe(isRefused);
    expect(wasRefused && !refused).toBe(false);
  });

  it('the table holds tightened cases, and none loosened', () => {
    expect(RECORDED.filter(([, , was, now]) => !was && now).length).toBe(13);
    expect(RECORDED.filter(([, , was, now]) => was && !now).length).toBe(0);
  });

  it.each([
    'ul. Treblinki 3.',
    'Treblinka Road.',
    'Sobibór Avenue',
    'al. Majdanek 12.',
    'ul. Bełżec 2.',
  ])('with no location, a camp in a street is refused: %j', (value) => {
    expect(describesResidentsByProtectedGround(value)).toBe(true);
  });

  it.each<[string, string]>([
    ['ul. Treblinki 3.', 'ul. Treblinka 3, Warszawa'],
    ['ul. Bełżca 3.', 'ul. Bełżec 3, Lublin'],
    ['ul. Belzec 3.', 'ul. Bełżec 3, Lublin'],
    ['Calle Sobibor 3.', 'Calle Sobibór 3, Madrid'],
    ['Auschwitz Street.', 'AUSCHWITZ STREET 1'],
  ])('the same camp, any form or case: %j on %j keeps the exemption', (value, location) => {
    expect(describesResidentsByProtectedGround(value, location)).toBe(false);
  });

  it.each<[string, string]>([
    ['ul. Majdanek 3.', 'ul. Treblinki 3, Warszawa'],
    ['ul. Sobibór 5.', 'ul. Sobieskiego 5, Warszawa'],
    ['ul. Treblinka 5.', 'ul. Trebnicka 5, Warszawa'],
  ])('another camp or a near name is no exemption: %j on %j', (value, location) => {
    expect(describesResidentsByProtectedGround(value, location)).toBe(true);
  });
});
