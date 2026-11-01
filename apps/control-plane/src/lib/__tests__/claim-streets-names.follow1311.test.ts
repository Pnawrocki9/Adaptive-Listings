/**
 * FOLLOW-1311 slice 5: a street the listing does not state, and a place named in a body. The
 * listing's own street always passes (CEO 2026-10-30), in every form. `KNOWN_LIMITS` pins what still
 * passes although it is wrong, named so nobody reads a pass as approval.
 *
 * The body's judge is a model: these tests answer for it, so they prove what reaches it and what its
 * answer does, not how it answers.
 *
 * @module apps/control-plane/src/lib/__tests__/claim-streets-names.follow1311.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import type { DescriptionRequestedEvent } from '@estalara/shared';
import { generateDescription } from '@/lib/description-generator';
import { bodyNamesForJudge, checkBodyClaims, checkHeadlineFacts } from '@/lib/grounding-check';
import { buildClaimGrounding, checkUnsupportedClaims } from '@/lib/claim-containment';
import { checkTypedClaims } from '@/lib/typed-claims';

interface Listing {
  original: string;
  ctx?: Record<string, string>;
}

const verdict = (l: Listing, text: string) => checkBodyClaims(text, l.original, l.ctx ?? {});
const names = (l: Listing, text: string) => bodyNamesForJudge(text, l.original, l.ctx ?? {});
/** The street claims alone: the digit and amenity rules read these sentences too. */
const street = (l: Listing, text: string) =>
  checkTypedClaims(text, [
    { field: 'original_description', text: l.original },
    ...Object.entries(l.ctx ?? {}).map(([field, value]) => ({ field, text: `${field}: ${value}` })),
  ])
    .filter((c) => c.kind === 'street')
    .map((c) => c.violation)
    .find((v) => v !== null) ?? null;

const FX: Listing = {
  original: 'A three-bedroom home on a quiet residential street, close to the beach.',
  ctx: { listing_location: '9 Blackberry Pl, Palm Coast, FL 32137' },
};
const KRK: Listing = {
  original: 'Mieszkanie przy ul. Długiej 4 w Krakowie. Do Wisły 300 m.',
  ctx: { listing_location: 'ul. Długa 4, Kraków, Stare Miasto' },
};
const WAW: Listing = {
  original: 'Mieszkanie 62 m², przy ul. Odyńca na warszawskim Mokotowie.',
  ctx: { listing_location: 'ul. Odyńca, Mokotów, Warszawa, mazowieckie' },
};
const MAD: Listing = {
  original: 'Piso reformado en la calle de la Paz, en el centro.',
  ctx: { listing_location: 'Calle de la Paz 7, Sevilla' },
};
const PLAIN: Listing = { original: 'A bright flat with a balcony, in a quiet area.' };
const LOWER: Listing = { original: 'flat at 12 bath road and near coast road, ul. parterowa 3.' };

describe('a street the listing does not state is refused', () => {
  it.each<[string, Listing, string]>([
    ['by name', FX, 'A home on Ocean Drive, close to the beach.'],
    ['by name, abbreviated', FX, 'Just off Collins Ave. and close to the beach.'],
    ['beside the lower-case word it borrows', FX, 'A short walk to Beach Road.'],
    ['with the number the listing has', FX, 'A home at 9 Ocean Drive.'],
    ['with a number: an ambiguous street word', FX, 'Next to 9 Ocean Terrace.'],
    ['on a listing naming no street', PLAIN, 'A flat on Bath Road.'],
    ['pl: ul.', KRK, 'Mieszkanie przy ul. Złotej w Krakowie.'],
    ['pl: ulicy', KRK, 'Mieszkanie przy ulicy Floriańskiej.'],
    ['pl: aleja', WAW, 'Mieszkanie przy Alejach Jerozolimskich.'],
    ['pl: plac', WAW, 'Dwa kroki od placu Zbawiciela.'],
    ['es: calle', MAD, 'Piso en la calle Mayor.'],
    ['es: avenida', MAD, 'Piso en la Avenida de la Constitución.'],
    ['es: paseo', MAD, 'A dos pasos del Paseo de Gracia.'],
    ['title case: the name after the last generic word', FX, 'Just Off The Ocean Drive.'],
  ])('%s', (_name, listing, text) => {
    expect(street(listing, text)).toBe('unsupported_street');
  });

  it.each<[string, Listing, string]>([
    ['South Street', PLAIN, 'A flat on South Street'],
    ['es: Calle Solar', PLAIN, 'Piso en la Calle Solar'],
    ['slice 4 listed this as a limit', PLAIN, 'A Detached House Lane flat'],
  ])('a street named like an attribute is a street claim, not an attribute: %s', (_n, l, text) => {
    expect(verdict(l, text)).toBe('unsupported_street');
  });

  it('on all three checks, and by name in the typed claims', () => {
    expect(checkHeadlineFacts('Home on Ocean Drive', FX.original, FX.ctx ?? {}, 'en')).toBe(
      'unsupported_street',
    );
    expect(verdict(FX, 'A home on Ocean Drive.')).toBe('unsupported_street');
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

describe('the listing own street always passes (CEO 2026-10-30)', () => {
  it.each<[string, Listing, string]>([
    ['as listed', FX, 'A home at 9 Blackberry Pl in Palm Coast.'],
    ['the street word in full', FX, 'A home at 9 Blackberry Place.'],
    ['pl: nominative of a genitive listing', KRK, 'Mieszkanie przy ul. Długa 4.'],
    ['pl: as the listing inflects it', KRK, 'Mieszkanie przy ulicy Długiej.'],
    ['pl: instrumental', KRK, 'Nad ulicą Długą.'],
    ['pl: no diacritics', KRK, 'Mieszkanie przy ul. Dlugiej.'],
    ['pl: an indeclinable name', WAW, 'Mieszkanie przy ulicy Odyńca.'],
    ['en copy of a Polish street', KRK, 'A flat on Długa Street in the Old Town.'],
    ['es: as listed', MAD, 'Piso en la calle de la Paz, 7.'],
    ['es: en copy', MAD, 'A flat on Calle de la Paz.'],
    ['a listing writing it in lower case', LOWER, 'A flat on Bath Road, near Coast Road.'],
    ['the seller own lower-case ul.', LOWER, 'Mieszkanie przy ul. Parterowa.'],
    ['upper case in the listing', { original: '12 OCEAN DRIVE' }, 'A flat on Ocean Drive.'],
  ])('%s', (_name, listing, text) => {
    expect(street(listing, text)).toBeNull();
    // And no other rule of the body takes it down.
    expect(verdict(listing, text)).toBeNull();
  });

  it('the source field names where it was found', () => {
    expect(
      checkTypedClaims('A home at 9 Blackberry Place.', [
        { field: 'listing_location', text: 'listing location: 9 Blackberry Pl, Palm Coast' },
      ]),
    ).toEqual([expect.objectContaining({ source: 'listing_location', violation: null })]);
  });

  it.each<[string, Listing, string]>([
    ['a sentence ending in a town', PLAIN, 'A short walk from Bath. Road access is good.'],
    ['a lower-case street word', PLAIN, 'A flat on a Quiet street, near Bath road.'],
    ['generic words only', PLAIN, 'A Quiet Residential Street and a Private Road.'],
    ['title case before a generic name', PLAIN, 'Easy Access To The Main Road.'],
    ['a saint', PLAIN, 'Visit St. Augustine, Near St. Helens.'],
    ['air conditioning', PLAIN, 'A/C Unit in the Living Room.'],
    ['a verb', PLAIN, 'Test Drive it. Hard Drive space is yours.'],
    ['the ambiguous words, no number', PLAIN, 'The Sunny Terrace, the Long Way, a Market Square.'],
    ['a count, not a house number', PLAIN, 'With 2 Bedroom Terrace access.'],
    ['pl: a common street', PLAIN, 'Cicha ulica z balkonem i plac zabaw.'],
    ['es: a common street', PLAIN, 'Una calle tranquila, plaza de parking.'],
  ])('not read as a street: %s', (_name, listing, text) => {
    expect(street(listing, text)).toBeNull();
  });
});

describe('a place named in a body goes to the judge', () => {
  it.each<[string, Listing, string, string[]]>([
    ['located in', FX, 'Located in Miami, this home is bright.', ['Miami']],
    ['near', FX, 'A home near Orlando.', ['Orlando']],
    ['minutes from', FX, 'Just minutes from Brickell.', ['Brickell']],
    ['two words', FX, 'A home in Palm Springs.', ['Springs']],
    ['the noun after', FX, 'The Brickell district is nearby.', ['Brickell']],
    ['pl: w', KRK, 'Mieszkanie w Gdyni.', ['Gdyni']],
    ['pl: dzielnica', KRK, 'W dzielnicy Nowa Huta.', ['Nowa', 'Huta']],
    ['pl: plaża', KRK, 'Blisko plaży Stogi.', ['Stogi']],
    ['es: en', MAD, 'Piso en Granada.', ['Granada']],
    ['es: cerca de', MAD, 'Piso cerca de Málaga.', ['Málaga']],
    ['es: barrio', MAD, 'En el barrio de Triana.', ['Triana']],
    ['repeated once', FX, 'In Miami, near Miami.', ['Miami']],
  ])('%s', (_name, listing, text, expected) => {
    expect(names(listing, text)).toEqual(expected);
  });

  it.each<[string, Listing, string]>([
    ['the listing own name', FX, 'A home in Palm Coast.'],
    ['pl: locative', KRK, 'Mieszkanie w Krakowie.'],
    ['pl: on a listing that inflects it', WAW, 'Na warszawskim Mokotowie, blisko Warszawy.'],
    ['pl: genitive', WAW, 'W centrum Warszawy, koło Warszawy.'],
    ...[
      ['Wrocław', 'we Wrocławiu, koło Wrocławia'],
      ['Poznań', 'w Poznaniu, pod Poznaniem, koło Poznania'],
      ['Łódź', 'w Łodzi, pod Łodzią'],
      ['Gdynia', 'w Gdyni, pod Gdynią'],
      ['Gdańsk', 'w Gdańsku, pod Gdańskiem, koło Gdańska'],
      ['Bydgoszcz', 'w Bydgoszczy'],
      ['Szczecin', 'w Szczecinie'],
      ['Toruń', 'w Toruniu'],
      ['Sopot', 'w Sopocie'],
      ['Zakopane', 'w Zakopanem'],
      ['Mokotów', 'na Mokotowie'],
      ['Tychy', 'w Tychach'],
    ].map(([place, copy]): [string, Listing, string] => [
      `pl: ${place ?? ''}`,
      { original: `Mieszkanie, ${place ?? ''}.` },
      `Mieszkanie ${copy ?? ''}.`,
    ]),
    ['en: another name', WAW, 'A flat in Warsaw.'],
    ['en: possessive of another name', WAW, 'A flat in Warsaw’s Mokotów.'],
    ['en: no diacritics', KRK, 'A flat in Krakow.'],
    ['es: another name', KRK, 'Un piso en Cracovia.'],
    ['pl: another name inflected', MAD, 'Mieszkanie w Sewilli.'],
    ['pl: an adjective as a name', KRK, 'Mieszkanie w Starym Mieście.'],
    ['pl: plural place', { original: 'Mieszkanie, Katowice.' }, 'Mieszkanie w Katowicach.'],
    ['a state, spelled out', FX, 'A home in Florida, na Florydzie.'],
    ['a river, translated', KRK, 'Nad Wisłą, on the Vistula, near Vistula.'],
    [
      'a region, translated',
      { original: 'Licence registered with the Valencian Community.' },
      'Licencja zarejestrowana we Wspólnocie Walenckiej.',
    ],
    ['a date', PLAIN, 'The lease ends in June, in December at the latest.'],
    ['an acronym', PLAIN, 'Priced in USD, in PLN, in USA terms.'],
    ['a language', PLAIN, 'Paperwork in Polish, in English.'],
    ['a country', KRK, 'Dla kogoś, kto mieszka w Polsce, in Poland.'],
    ['a polite pronoun', PLAIN, 'W Twoim budżecie, na Państwa potrzeby, w Tobie.'],
    ['a possessive pronoun', PLAIN, 'It’s a flat. Owner’s suite. Today’s market.'],
    ['we, the pronoun', PLAIN, 'We Love this flat.'],
    ['an ordinary capital outside a frame', PLAIN, 'The Dreszer Park and Jeżyce Market are close.'],
  ])('passes with no judge call: %s', (_name, listing, text) => {
    expect(names(listing, text)).toEqual([]);
  });
});

describe('the judge on the description path', () => {
  const event = (listing: Listing): DescriptionRequestedEvent => ({
    tenant_id: '00000000-0000-4000-8000-000000001311',
    listing_id: 'listing-1311',
    archetype: 'family_buyer',
    locale: 'en',
    copy_template: 'Warm and practical.',
    original_description: listing.original,
    listing_context: listing.ctx ?? {},
    cache_key: 'desc:t:listing-1311:family_buyer:en:m:r0',
    listing_revision: 0,
    generation_model: 'claude-sonnet-5-5',
  });
  const reply = (text: string) => ({
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 600, output_tokens: 8 },
  });
  const BODY = 'Located in Miami, this three-bedroom home has room for a family to settle in.';

  /** Answers the judge with `judge`, every other call with `BODY` and then a headline. */
  function answerWith(judge: () => Promise<ReturnType<typeof reply>>): void {
    let calls = 0;
    mockCreate.mockImplementation((params: { system?: string }) => {
      if (params.system?.startsWith('You check place names')) return judge();
      calls += 1;
      return Promise.resolve(reply(calls === 1 ? BODY : 'A three-bedroom home'));
    });
  }
  const judgeCalls = () =>
    mockCreate.mock.calls.filter(([p]) =>
      (p as { system?: string }).system?.startsWith('You check place names'),
    );

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-follow-1311');
    mockCreate.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('asks about the flagged word and its sentence only, on the cheap model', async () => {
    answerWith(() => Promise.resolve(reply('{"grounded": true}')));
    const report = await generateDescription(event(FX));
    expect(report.outcome.verdict).toBe('FIT');
    expect(report.headline).toBe('A three-bedroom home');
    expect(judgeCalls()).toHaveLength(1);
    const params = judgeCalls()[0]?.[0] as {
      model: string;
      max_tokens: number;
      messages: { content: string }[];
    };
    expect(params.model).toBe('claude-haiku-4-5');
    expect(params.max_tokens).toBe(50);
    expect(params.messages[0]?.content).toContain('FLAGGED WORDS: Miami');
    expect(params.messages[0]?.content).toContain(FX.original);
  });

  it('sends the sentences holding a flag, not the body', async () => {
    const body = `${BODY} The kitchen is new. Nothing else here names a place.`;
    mockCreate.mockImplementation((params: { system?: string }) =>
      Promise.resolve(reply(params.system?.startsWith('You check') ? '{"grounded": true}' : body)),
    );
    await generateDescription(event(FX));
    const content = (judgeCalls()[0]?.[0] as { messages: { content: string }[] }).messages[0]
      ?.content;
    expect(content).toContain(BODY);
    expect(content).not.toContain('The kitchen is new');
  });

  it.each<[string, () => Promise<ReturnType<typeof reply>>]>([
    ['says no', () => Promise.resolve(reply('{"grounded": false}'))],
    ['answers something else', () => Promise.resolve(reply('I cannot tell.'))],
    ['fails', () => Promise.reject(new Error('overloaded'))],
  ])('the flag stands when the judge %s: refused, no headline paid for', async (_n, judge) => {
    answerWith(judge);
    const report = await generateDescription(event(FX));
    expect(report.outcome).toEqual({
      verdict: 'REFUSED',
      violation: 'hallucinated_proper_name',
    });
    expect(report.headline).toBeNull();
    expect(report.claimsValidation).toBeNull();
    // The body and the judge; no headline call.
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('the flag stands when the judge outruns its 2 s deadline', async () => {
    vi.useFakeTimers();
    answerWith(() => new Promise(() => undefined));
    const pending = generateDescription(event(FX));
    await vi.advanceTimersByTimeAsync(2_001);
    expect((await pending).outcome).toEqual({
      verdict: 'REFUSED',
      violation: 'hallucinated_proper_name',
    });
  });

  it('a body with nothing flagged costs no judge call', async () => {
    mockCreate
      .mockResolvedValueOnce(reply('This three-bedroom home in Palm Coast has room for a family.'))
      .mockResolvedValueOnce(reply('A three-bedroom home'));
    const report = await generateDescription(event(FX));
    expect(report.outcome.verdict).toBe('FIT');
    expect(judgeCalls()).toHaveLength(0);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('a deterministic refusal comes first: no judge call for a street', async () => {
    mockCreate.mockResolvedValueOnce(reply('In Miami, on Ocean Drive, this home is bright.'));
    const report = await generateDescription(event(FX));
    expect(report.outcome).toEqual({ verdict: 'REFUSED', violation: 'unsupported_street' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('KNOWN_LIMITS: these pass although they are wrong', () => {
  it.each<[string, Listing, string]>([
    ['a generic street name', PLAIN, 'Close to the High Street and Main Street.'],
    ['St. with no number', PLAIN, 'A flat on Bath St. near the park.'],
    ['one word of the name found', FX, 'A home on Palm Street.'],
    ['another street type of the name', FX, 'A home on Blackberry Lane.'],
    ['a name grounded by a sentence opening', { original: 'Beach 200 m.' }, 'On Beach Road.'],
    ['in lower case', PLAIN, 'A flat at 12 bath road.'],
    ['a numbered street', PLAIN, 'A flat on 42nd Street.'],
    ['a street word outside the list', FX, 'A home on Palm Coast Parkway, on Ocean Highway.'],
    ['an ambiguous street word, no number', PLAIN, 'A flat on Ocean Way, by Bath Place.'],
    ['the number after an ambiguous word', PLAIN, 'A flat at Bath Place 12.'],
    ['a lower-case ul.', PLAIN, 'Mieszkanie przy ul. parterowa.'],
  ])('street: %s', (_name, listing, text) => {
    expect(street(listing, text)).toBeNull();
  });

  it.each<[string, Listing, string]>([
    ['a capital outside every frame', FX, 'The Brickell Market and Tri-City are close.'],
    ['at, on, to', FX, 'At Miami Beach, on Brickell, to Orlando.'],
    ['pl: do', KRK, 'Do Gdyni 10 minut, tramwaje do Sopotu.'],
    ['an acronym that is a place', FX, 'A home in USA, near JFK.'],
    ['a possessive', FX, 'Miami’s nightlife is close, and you can enjoy Brickell’s cafes.'],
    ['the wrong country', KRK, 'A flat in Portugal, en España.'],
    ['a word the listing has in lower case', FX, 'A home in Palm Beach.'],
    ['an adjective before the name', KRK, 'W nadmorskiej Gdyni, in sunny Miami.'],
    ['lower case', KRK, 'Mieszkanie w gdyni.'],
  ])('body name: %s', (_name, listing, text) => {
    expect(names(listing, text)).toEqual([]);
  });
});

describe('REFUSED although it may be fine: pinned', () => {
  it.each<[string, Listing, string]>([
    ['a translated street', KRK, 'A flat on Golden Road.'],
    ['a street as a figure of speech', PLAIN, 'A flat for Wall Street money.'],
  ])('%s', (_name, listing, text) => {
    expect(street(listing, text)).toBe('unsupported_street');
  });
});
