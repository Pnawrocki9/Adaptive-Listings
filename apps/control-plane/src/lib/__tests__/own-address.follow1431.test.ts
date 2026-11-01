// @vitest-environment node
/**
 * FOLLOW-1431 — "Adres to adres, ma przechodzić" (CEO). The whole paths, `generateDescription` and
 * `callLlmGateway`, with only the model mocked: the listing's own address is blanked before the
 * protected-ground guard, and an address that is not the listing's goes on to the street rule.
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

const OWN: [string, string, Locale][] = [
  // The ticket's sentences.
  ['Bohaterów Getta 5, Warszawa.', 'Bohaterów Getta 5, Warszawa', 'pl'],
  ['Mieszkanie przy Katyńskiej 5.', 'ul. Katyńska 5, Warszawa', 'pl'],
  ['Mieszkanie przy Katyńskiej 5.', 'Katyńska 5, Warszawa', 'pl'],
  ['Mieszkanie przy Katyńskiej.', 'ul. Katyńska 5, Warszawa', 'pl'],
  ['Mieszkanie przy Bohaterów Getta.', 'Bohaterów Getta 5, Warszawa', 'pl'],
  ['Lokal na Bohaterów Getta.', 'Bohaterów Getta 5, Warszawa', 'pl'],
  ['A flat on Bohaterów Getta.', 'Bohaterów Getta 5, Warszawa', 'en'],
  ['przy alei Katyńskiej.', 'al. Katyńska 5, Warszawa', 'pl'],
  ['os. Bohaterów Getta 3.', 'os. Bohaterów Getta 3, Warszawa', 'pl'],
  ['ul. bohaterów getta 5.', 'ul. Bohaterów Getta 5, Warszawa', 'pl'],
  ['Calle del Gueto 5.', 'Calle del Gueto 5, Madrid', 'es'],
  ['Holocaust Memorial Drive 7.', 'Holocaust Memorial Drive 7, Miami', 'en'],
  // The PM's pins, with the listing's number off and on.
  ['Holocaust Memorial Drive.', 'Holocaust Memorial Drive 7, Miami', 'en'],
  ['Holocaust Memorial Drive.', '7 Holocaust Memorial Drive, Miami', 'en'],
  ['Plaza del Gueto.', 'Plaza del Gueto 3, Madrid', 'es'],
  ['Jewish Quarter Road.', 'Jewish Quarter Road 7, Leeds', 'en'],
  ['os. Bohaterów Getta.', 'os. Bohaterów Getta 3, Warszawa', 'pl'],
  ['Calle de la Judería 5.', 'Calle de la Judería 5, Toledo', 'es'],
  ['Treblinka Road.', 'Treblinka Road 5, Warszawa', 'en'],
  // A house number on its own address; a town is another matter, below.
  ['Dom przy Treblince 5.', 'Treblinka 5, mazowieckie', 'pl'],
];

describe('FOLLOW-1431: the listing own address is blanked before the guard', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1431';
  });
  afterEach(() => vi.unstubAllEnvs());

  describe.each(OWN)('%j on the listing at %j', (text, location, locale) => {
    const context = { listing_location: location };
    it('description body', async () => {
      expect(await body(text, '', context, locale)).toBe('FIT');
    });
    it('description headline', async () => {
      expect(await headline(text, '', context, locale)).toBe('served');
    });
    it('/api/adapt', async () => {
      expect(await adapt(text, context)).toBe('served');
    });
  });

  // A model inventing such a street has written no address of this listing (CEO, PM on 1431).
  describe.each<[string, Locale]>([
    ['Holocaust Memorial Drive.', 'en'],
    ['Plaza del Gueto.', 'es'],
    ['Jewish Quarter Road.', 'en'],
    ['os. Bohaterów Getta.', 'pl'],
    ['Calle de la Judería 5.', 'es'],
    ['przy alei Katyńskiej.', 'pl'],
    ['Calle del Gueto.', 'es'],
    ['Bohaterów Getta 5, Warszawa.', 'pl'],
    ['Mieszkanie przy Katyńskiej 5.', 'pl'],
  ])('%j on a listing in Warszawa is refused', (text, locale) => {
    const context = { listing_location: 'Warszawa' };
    it('description body', async () => {
      expect(await body(text, '', context, locale)).toBe('protected_ground');
    });
    it('description headline', async () => {
      expect(await headline(text, '', context, locale)).toBe('protected_ground');
    });
    it('/api/adapt', async () => {
      expect(await adapt(text, context)).toBe('protected_ground');
    });
  });

  // origin/main served this body, and no tightening here: listed for a follow-up.
  it('"Treblinka Road." on Warszawa keeps what origin/main did', async () => {
    const context = { listing_location: 'Warszawa' };
    expect(await body('Treblinka Road.', '', context, 'en')).toBe('FIT');
    expect(await headline('Treblinka Road.', '', context, 'en')).toBe('hallucinated_proper_name');
    expect(await adapt('Treblinka Road.', context)).toBe('hallucinated_proper_name');
  });

  // Each holds the sensitive word outside the listing's own address.
  const STAYS: [string, string, Locale][] = [
    ['Obok Pomnika Zbrodni Katyńskiej.', 'ul. Katyńska 5, Warszawa', 'pl'],
    ['Blisko Katyńskiej 5 minut pieszo.', 'ul. Katyńska 5, Warszawa', 'pl'],
    ['Widok na Zbrodnię Katyńską.', 'ul. Katyńska 5, Warszawa', 'pl'],
    ['Na Katyńskiej zbrodni.', 'ul. Katyńska 5, Warszawa', 'pl'],
    ['Obok Pomnika Bohaterów Getta.', 'Bohaterów Getta 5, Warszawa', 'pl'],
    ['Obok Getta 5.', 'Bohaterów Getta 5, Warszawa', 'pl'],
    ['Mieszkanie przy ul. Bohaterów Getta 5, obok dawnego getta.', 'ul. Bohaterów Getta 5', 'pl'],
    ['The former ghetto is nearby.', 'Bohaterów Getta 5, Warszawa', 'en'],
    ['A short walk from the Holocaust memorial', 'Holocaust Memorial Drive 7', 'en'],
    // A town is not an address (PM on FOLLOW-1431), even the listing's own.
    ['Dom w Treblince.', 'Treblinka, mazowieckie', 'pl'],
    ['Dom w Sobiborze.', 'Sobibór 12, Włodawa', 'pl'],
    ['Majdanek 1944.', 'Majdanek 12, Lublin', 'pl'],
    ['Żydowska dzielnica.', 'ul. Żydowska 5, Lublin', 'pl'],
    // Marker-free, and not this listing's.
    ['Bohaterów Getta 5, Warszawa.', 'ul. Długa 4, Warszawa', 'pl'],
    ['Mieszkanie przy Katyńskiej 5.', 'ul. Długa 4, Warszawa', 'pl'],
  ];
  describe.each(STAYS)('%j on the listing at %j stays refused', (text, location, locale) => {
    const context = { listing_location: location };
    it('description body', async () => {
      expect(await body(text, '', context, locale)).toBe('protected_ground');
    });
    it('description headline', async () => {
      expect(await headline(text, '', context, locale)).toBe('protected_ground');
    });
    it('/api/adapt', async () => {
      expect(await adapt(text, context)).toBe('protected_ground');
    });
  });

  describe('a listing text states its address only with a signal', () => {
    it.each<[string, string]>([
      ['Mieszkanie przy Katyńskiej 5.', 'Mieszkanie przy Katyńskiej 5 w Warszawie.'],
      ['Mieszkanie przy Katyńskiej.', 'Mieszkanie przy Katyńskiej 5 w Warszawie.'],
      ['Lokal na Bohaterów Getta 5.', 'Lokal na Bohaterów Getta 5, Warszawa.'],
      ['Holocaust Memorial Drive 7.', 'A home at Holocaust Memorial Drive 7, Miami.'],
      ['Holocaust Memorial Drive.', 'A home at Holocaust Memorial Drive 7, Miami.'],
    ])('own: %j on %j', async (text, original) => {
      expect(await body(text, original, {}, 'pl')).toBe('FIT');
      expect(await adapt(text, { listing_description: original })).toBe('served');
    });

    // A mention is no address, and the seller's verbatim sentence gets no pass from this rule:
    // the guard refuses "whoever wrote the words" (FOLLOW-1411).
    it.each<[string, string]>([
      ['Treblinka 12.', 'Dom, 5 min from Treblinka 12.'],
      ['Near Treblinka 12.', 'Dom, 5 min from Treblinka 12.'],
      ['Dom, 5 min from Treblinka 12.', 'Dom, 5 min from Treblinka 12.'],
      ['Sobibór 5.', 'Blisko Sobibór 5.'],
      ['Obok Pomnika Getta 5.', 'Obok Pomnika Getta 5.'],
      ['Treblinka 12.', 'Dom przy lesie. Treblinka 12 km stąd.'],
      ['Getta 2.', 'Obok Getta 2 pokoje.'],
    ])('a mention spares nothing: %j on %j', async (text, original) => {
      expect(await body(text, original, {}, 'pl')).toBe('protected_ground');
      expect(await adapt(text, { listing_description: original })).toBe('protected_ground');
    });
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
  ])('the mask reads what the guard reads: %j', (text) => {
    expect(maskStreetAddresses(text)).not.toBe(text);
  });
});
