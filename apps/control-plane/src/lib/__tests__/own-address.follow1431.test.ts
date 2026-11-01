// @vitest-environment node
/**
 * FOLLOW-1431 — "Adres to adres, ma przechodzić" (CEO): a real address of THIS listing. The whole
 * paths, `generateDescription` and `callLlmGateway`, with only the model mocked. A street of
 * `listing_location`, stated with its house number, ending the phrase, is blanked before the
 * protected-ground guard. Nothing else is spared, and a false refusal is the safe side.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ result: '0', data: [{ total: '0' }] }),
    text: () => Promise.resolve(''),
  }),
);

import type { DescriptionRequestedEvent } from '@estalara/shared';
import { getPlaybook } from '@estalara/shared/playbooks';
import { generateDescription } from '@/lib/description-generator';
import { callLlmGateway } from '@/lib/llm-gateway';
import { maskStreetAddresses } from '@/lib/street-address';

type Locale = 'en' | 'pl' | 'es';
type Context = Record<string, string>;

const reply = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
});
const fit = (body: string): string =>
  `<adaptation_verdict>FIT</adaptation_verdict>\n${body}\n<verified_facts_used>\n[]\n</verified_facts_used>`;
const event = (original: string, context: Context, locale: Locale): DescriptionRequestedEvent => ({
  tenant_id: '00000000-0000-4000-8000-000000001431',
  listing_id: 'listing-1431',
  archetype: 'lifestyle_expat',
  locale,
  copy_template: 'Warm and practical.',
  original_description: original,
  listing_context: context,
  cache_key: `desc:t:listing-1431:lifestyle_expat:${locale}:m:r0`,
  listing_revision: 0,
  generation_model: 'claude-sonnet-5-5',
});

/** The body's verdict and its code, the text as the model wrote it. */
async function body(text: string, original: string, context: Context, locale: Locale) {
  mockCreate.mockReset();
  mockCreate.mockResolvedValueOnce(reply(fit(text))).mockResolvedValueOnce(reply('Mieszkanie'));
  const { outcome } = await generateDescription(event(original, context, locale));
  const o = outcome as { verdict: string; violation?: string; reason?: string };
  return o.violation ?? o.reason ?? o.verdict;
}

/** The headline's own verdict, under a body that stands. */
async function headline(text: string, original: string, context: Context, locale: Locale) {
  mockCreate.mockReset();
  mockCreate.mockResolvedValueOnce(reply(fit('Dom.'))).mockResolvedValueOnce(reply(text));
  const report = await generateDescription(event(original, context, locale));
  return report.headlineViolation ?? (report.headline === text ? 'served' : report.headline);
}

/** What the gateway did with the value in a cta slot: the violation it logged, or `served`. */
async function adapt(value: string, context: Context) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify([
          { type: 'text', slot: 'cta', value, archetype: 'yield_hunter', confidence: 0.8 },
        ]),
      },
    ],
    usage: { input_tokens: 150, output_tokens: 50 },
  });
  const output = await callLlmGateway({
    archetypeId: 'yield_hunter',
    confidence: 0.75,
    similarity: 0.75,
    basePlaybook: getPlaybook('yield_hunter'),
    listingContext: context,
  });
  const logged = warn.mock.calls
    .map((c) => /violation: (\w+)/u.exec(String(c[0]))?.[1])
    .find((v) => v !== undefined);
  warn.mockRestore();
  if (logged !== undefined) return logged;
  return output?.directives.some((d) => 'value' in d && d.value === value) ? 'served' : 'dropped';
}

type Row = [string, Context, string, Locale];

/** On a real own listing: a street of `listing_location`, with its number, ending the phrase. */
const SERVED: Row[] = [
  ['Bohaterów Getta 5, Warszawa.', { listing_location: 'Bohaterów Getta 5, Warszawa' }, '', 'pl'],
  ['Mieszkanie przy Katyńskiej 5.', { listing_location: 'ul. Katyńska 5, Warszawa' }, '', 'pl'],
  ['Mieszkanie przy Katyńskiej 5.', { listing_location: 'Katyńska 5, Warszawa' }, '', 'pl'],
  ['przy alei Katyńskiej 5.', { listing_location: 'al. Katyńska 5, Warszawa' }, '', 'pl'],
  ['os. Bohaterów Getta 3.', { listing_location: 'os. Bohaterów Getta 3, Warszawa' }, '', 'pl'],
  ['Calle del Gueto 5.', { listing_location: 'Calle del Gueto 5, Madrid' }, '', 'es'],
  [
    'Holocaust Memorial Drive 7.',
    { listing_location: 'Holocaust Memorial Drive 7, Miami' },
    '',
    'en',
  ],
  [
    '7 Holocaust Memorial Drive.',
    { listing_location: '7 Holocaust Memorial Drive, Miami' },
    '',
    'en',
  ],
  ['Plaza del Gueto 3.', { listing_location: 'Plaza del Gueto 3, Madrid' }, '', 'es'],
  ['Jewish Quarter Road 7.', { listing_location: 'Jewish Quarter Road 7, Leeds' }, '', 'en'],
  ['Calle de la Judería 5.', { listing_location: 'Calle de la Judería 5, Toledo' }, '', 'es'],
  ['Treblinka Road 5.', { listing_location: 'Treblinka Road 5, Warszawa' }, '', 'en'],
  ['ul. Treblinki 3.', { listing_location: 'ul. Treblinki 3, Warszawa' }, '', 'pl'],
  ['Dom przy Treblince 5.', { listing_location: 'Treblinka 5, mazowieckie' }, '', 'pl'],
  ['ul. bohaterów getta 5.', { listing_location: 'ul. bohaterów getta 5, warszawa' }, '', 'pl'],
  [
    'ul. Bohaterów Getta 5 m. 12.',
    { listing_location: 'ul. Bohaterów Getta 5 m. 12, Warszawa' },
    '',
    'pl',
  ],
  [
    'ul. Bohaterów Getta 5.',
    { listing_location: 'ul. Bohaterów Getta 5 m. 12, Warszawa' },
    '',
    'pl',
  ],
  [
    'ul. Bohaterów Getta 5 lok. 12.',
    { listing_location: 'ul. Bohaterów Getta 5 lok. 12, Warszawa' },
    '',
    'pl',
  ],
  ['C/Gueto 5.', { listing_location: 'C/Gueto 5, Madrid' }, '', 'es'],
];

/**
 * The independent reader's holes against 060b6ac5, the camp names (M6), composition (M7), what the
 * narrow rule gives up on a real own listing (a limit for the CEO), and the rest of the ruling. A
 * false refusal is safe: the seller's copy stays.
 */
const REFUSED: Row[] = [
  ['The memorial at Treblinka.', { listing_location: 'ul. Polna 3, 08-140 Treblinka' }, '', 'en'],
  ['Dom przy Treblince.', { listing_location: 'ul. Polna 3, 08-140 Treblinka' }, '', 'pl'],
  ['The museum at Bełżec.', { listing_location: 'ul. Polna 3, 22-670 Bełżec' }, '', 'en'],
  ['The memorial at Treblinka.', { listing_location: 'Treblinka 12, mazowieckie' }, '', 'en'],
  [
    '10 minutes from the former ghetto.',
    { listing_location: 'Kraków, 10 minutes from the former ghetto' },
    '',
    'en',
  ],
  ['5 min from Treblinka', { listing_location: '5 min from Treblinka, Warszawa' }, '', 'en'],
  [
    'The Jewish quarter is 200 m away.',
    { listing_location: 'Kraków, the Jewish quarter is 200 m away' },
    '',
    'en',
  ],
  ['The ghetto is 3 km away.', { location: 'The ghetto is 3 km away' }, '', 'en'],
  ['2 km od dawnego getta.', { 'Jaka jest location?': '2 km od dawnego getta.' }, '', 'pl'],
  ['The camp at Treblinka.', {}, 'Pociąg na Treblinka 12 w sobotę.', 'en'],
  ['Wycieczka na Majdanek.', {}, 'Autobus na Majdanek 12, przystanek obok.', 'pl'],
  ['przy Katyńskiej, miejsce zbrodni.', { listing_location: 'ul. Katyńska 5, Warszawa' }, '', 'pl'],
  [
    'Stara ul. Długa 5 żydowska dzielnica.',
    { listing_location: 'ul. Długa 5, Warszawa' },
    '',
    'pl',
  ],
  ['In the old 12 Elm Road Jewish quarter.', { listing_location: '12 Elm Road, Leeds' }, '', 'en'],
  [
    'Pomnik Bohaterów Getta 5 przystanków stąd.',
    { listing_location: 'Bohaterów Getta 5, Warszawa' },
    '',
    'pl',
  ],
  [
    'Pomnik Zbrodni Katyńskiej 5 przecznic stąd.',
    { listing_location: 'ul. Katyńska 5, Warszawa' },
    '',
    'pl',
  ],
  ['Zbrodnia Katyńska 5.', { listing_location: 'ul. Katyńska 5, Warszawa' }, '', 'pl'],
  ['Obok Getta 5.', { listing_location: 'ul. Getta 5, Warszawa' }, '', 'pl'],
  ['The former ghetto road is gone.', { listing_location: '12 Ghetto Road, Leeds' }, '', 'en'],
  [
    'The old holocaust memorial drive.',
    { listing_location: '12 Holocaust Memorial Drive, Miami' },
    '',
    'en',
  ],
  ['ul. Sobibór 5.', { listing_location: 'ul. Sobieskiego 5, Warszawa' }, '', 'pl'],
  ['ul. Treblinka 5.', { listing_location: 'ul. Trebnicka 5, Warszawa' }, '', 'pl'],
  ['ul. Majdanek 5.', { listing_location: 'Warszawa' }, '', 'pl'],
  ['Treblinka Road.', { listing_location: 'Warszawa' }, '', 'en'],
  ['Auschwitz Street.', { listing_location: 'Warszawa' }, '', 'en'],
  ['Sobibór Avenue', { listing_location: 'Warszawa' }, '', 'en'],
  ['Plac Treblinka to miejsce pamięci', { listing_location: 'Warszawa' }, '', 'pl'],
  ['Auschwitz Road tours from here', { listing_location: 'Warszawa' }, '', 'en'],
  [
    'Most residents at ul. Długa 5 are Muslim.',
    { listing_location: 'ul. Długa 5, Warszawa' },
    '',
    'en',
  ],
  [
    'Większość mieszkańców ul. Długiej 5 to katolicy.',
    { listing_location: 'ul. Długa 5, Warszawa' },
    '',
    'pl',
  ],
  [
    'La mayoría de los vecinos de C. Mayor 5 son musulmanes.',
    { listing_location: 'C. Mayor 5, Madrid' },
    '',
    'es',
  ],
  ['Most residents at ul. Długa 5 are Muslim.', { listing_location: 'Warszawa' }, '', 'en'],
  ['Większość mieszkańców ul. Długiej 5 to katolicy.', { listing_location: 'Warszawa' }, '', 'pl'],
  [
    'La mayoría de los vecinos de C. Mayor 5 son musulmanes.',
    { listing_location: 'Madrid' },
    '',
    'es',
  ],
  ['przy Katyńskiej.', { listing_location: 'ul. Katyńska 5, Warszawa' }, '', 'pl'],
  ['Mieszkanie przy Katyńskiej.', { listing_location: 'ul. Katyńska 5, Warszawa' }, '', 'pl'],
  [
    'A flat on Bohaterów Getta near the park.',
    { listing_location: 'Bohaterów Getta 5, Warszawa' },
    '',
    'en',
  ],
  ['A flat on Bohaterów Getta.', { listing_location: 'Bohaterów Getta 5, Warszawa' }, '', 'en'],
  ['Lokal na Bohaterów Getta.', { listing_location: 'Bohaterów Getta 5, Warszawa' }, '', 'pl'],
  ['Bohaterów Getta.', { listing_location: 'Bohaterów Getta 5, Warszawa' }, '', 'pl'],
  ['przy alei Katyńskiej.', { listing_location: 'al. Katyńska 5, Warszawa' }, '', 'pl'],
  ['os. Bohaterów Getta.', { listing_location: 'os. Bohaterów Getta 3, Warszawa' }, '', 'pl'],
  ['ul. bohaterów getta 5.', { listing_location: 'ul. Bohaterów Getta 5, Warszawa' }, '', 'pl'],
  [
    'Holocaust Memorial Drive.',
    { listing_location: 'Holocaust Memorial Drive 7, Miami' },
    '',
    'en',
  ],
  ['Treblinka Road.', { listing_location: 'Treblinka Road 5, Warszawa' }, '', 'en'],
  ['Calle del Gueto.', { listing_location: 'Calle del Gueto 5, Madrid' }, '', 'es'],
  [
    'Mieszkanie przy Katyńskiej 5 w Warszawie.',
    { listing_location: 'ul. Katyńska 5, Warszawa' },
    '',
    'pl',
  ],
  ['Calle del Gueto, 5.', { listing_location: 'Calle del Gueto, 5, Madrid' }, '', 'es'],
  ['Mieszkanie przy Katyńskiej 5.', {}, 'Mieszkanie przy Katyńskiej 5 w Warszawie.', 'pl'],
  ['Bohaterów Getta 5, Warszawa.', { listing_title: 'Bohaterów Getta 5, Warszawa' }, '', 'pl'],
  ['The former ghetto is nearby.', { listing_location: 'Bohaterów Getta 5, Warszawa' }, '', 'en'],
  [
    'A short walk from the Holocaust memorial',
    { listing_location: 'Holocaust Memorial Drive 7, Miami' },
    '',
    'en',
  ],
  ['Dom w Treblince.', { listing_location: 'Treblinka, mazowieckie' }, '', 'pl'],
  ['żydowska dzielnica', { listing_location: 'Warszawa' }, '', 'pl'],
  [
    'przy Katyńskiej 5, miejsce zbrodni.',
    { listing_location: 'ul. Katyńska 5, Warszawa' },
    '',
    'pl',
  ],
  [
    'przy Katyńskiej 5. Zbrodnia Katyńska obok.',
    { listing_location: 'ul. Katyńska 5, Warszawa' },
    '',
    'pl',
  ],
  ['Bohaterów Getta 7.', { listing_location: 'Bohaterów Getta 5, Warszawa' }, '', 'pl'],
  ['przy katyńskiej 5.', { listing_location: 'ul. Katyńska 5, Warszawa' }, '', 'pl'],
  ['Getta 5 km stąd.', { listing_location: 'ul. Getta 5, Warszawa' }, '', 'pl'],
  ['Getta 5.5 km stąd.', { listing_location: 'ul. Getta 5, Warszawa' }, '', 'pl'],
  ['Getta 5/7.', { listing_location: 'ul. Getta 5, Warszawa' }, '', 'pl'],
  ['Near Treblinka 12.', { listing_location: 'Near Treblinka 12, Warszawa' }, '', 'en'],
  ['The Ghetto 3.', { listing_location: 'The Ghetto 3, Warszawa' }, '', 'en'],
  ['Majdanek 1944.', { listing_location: 'Majdanek 1944, Lublin' }, '', 'pl'],
  [
    'ul. Polna 3, 08-140 Treblinka.',
    { listing_location: 'ul. Polna 3, 08-140 Treblinka' },
    '',
    'pl',
  ],
  ['08-140 Treblinka.', { listing_location: 'ul. Polna 3, 08-140 Treblinka' }, '', 'pl'],
  ['Treblinka 12.', { public_location_label: 'Treblinka 12, mazowieckie' }, '', 'pl'],
  ['Treblinka 12.', { listing_location_note: 'Treblinka 12, mazowieckie' }, '', 'pl'],
  [
    'Stara ul. Katyńska 5 żydowska dzielnica.',
    { listing_location: 'ul. Katyńska 5, Warszawa' },
    '',
    'pl',
  ],
  ['ul. Długa 5, żydowska dzielnica.', { listing_location: 'ul. Długa 5, Warszawa' }, '', 'pl'],
  ['Most residents of ul. Długa are Catholic.', { listing_location: 'Warszawa' }, '', 'en'],
  ['Większość mieszkańców ul. Długiej to katolicy.', { listing_location: 'Warszawa' }, '', 'pl'],
  ['Birkenau is near ul. Długa 5.', { listing_location: 'ul. Długa 5, Warszawa' }, '', 'en'],
];

const adaptContext = (context: Context, original: string): Context =>
  original ? { listing_description: original, ...context } : context;

describe('FOLLOW-1431: the listing own address, narrowly', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1431';
  });
  afterEach(() => vi.unstubAllEnvs());

  describe.each(SERVED)('served: %j on %j', (text, context, original, locale) => {
    it('description body', async () => {
      expect(await body(text, original, context, locale)).toBe('FIT');
    });
    it('description headline', async () => {
      expect(await headline(text, original, context, locale)).toBe('served');
    });
    it('/api/adapt', async () => {
      expect(await adapt(text, adaptContext(context, original))).toBe('served');
    });
  });

  describe.each(REFUSED)('refused: %j on %j', (text, context, original, locale) => {
    it('description body', async () => {
      expect(await body(text, original, context, locale)).toBe('protected_ground');
    });
    it('description headline', async () => {
      expect(await headline(text, original, context, locale)).toBe('protected_ground');
    });
    it('/api/adapt', async () => {
      expect(await adapt(text, adaptContext(context, original))).toBe('protected_ground');
    });
  });

  it('the guard passes "przy Katynskiej 5" on ul. Katyńska 5; the name rule still reads it', async () => {
    const context = { listing_location: 'ul. Katyńska 5, Warszawa' };
    expect(await body('przy Katynskiej 5.', '', context, 'pl')).toBe('FIT');
    expect(await headline('przy Katynskiej 5.', '', context, 'pl')).toBe(
      'hallucinated_proper_name',
    );
    expect(await adapt('przy Katynskiej 5.', context)).toBe('hallucinated_proper_name');
  });

  it('other sensitive terms keep the exemption, for a follow-up', async () => {
    const context = { listing_location: 'Warszawa' };
    for (const text of ['Ghetto Road.', 'Ghetto Streets', 'Birkenau Road.']) {
      expect(await body(text, '', context, 'en')).toBe('FIT');
      expect(await adapt(text, context)).toBe('hallucinated_proper_name');
    }
  });

  it('"dawna" and family wording are served, on both paths', async () => {
    for (const text of ['Dawna dzielnica żydowska obok.', 'Idealne dla rodziny z dziećmi.']) {
      expect(await body(text, text, {}, 'pl')).toBe('FIT');
      expect(await adapt(text, { listing_description: text })).toBe('served');
    }
  });
});

describe('FOLLOW-1431: one address vocabulary', () => {
  it.each([
    'przy alei Katyńskiej.',
    'os. Bohaterów Getta 3.',
    'Calle del Gueto 5.',
    'Holocaust Memorial Drive 7.',
    'Plaza del Gueto 3.',
    'Paseo del Holocausto 2.',
    'Rua Gueto 2.',
    'Carrer del Gueto 2.',
    '12 Ghetto Way.',
  ])('the mask reads every marker: %j', (text) => {
    expect(maskStreetAddresses(text)).not.toBe(text);
  });
});
