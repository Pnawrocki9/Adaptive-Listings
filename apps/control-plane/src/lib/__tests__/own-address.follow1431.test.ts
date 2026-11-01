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

  it('own, as the description states it, with no address field', async () => {
    const original = 'Mieszkanie przy Katyńskiej 5 w Warszawie.';
    const text = 'Mieszkanie przy Katyńskiej 5.';
    expect(await body(text, original, {}, 'pl')).toBe('FIT');
    expect(await adapt(text, { listing_description: original })).toBe('served');
  });

  // Each of these holds the sensitive word outside the address, or an address not the listing's.
  const STAYS: [string, string, Locale][] = [
    ['Obok Pomnika Zbrodni Katyńskiej.', 'ul. Katyńska 5, Warszawa', 'pl'],
    ['Blisko Katyńskiej 5 minut pieszo.', 'ul. Katyńska 5, Warszawa', 'pl'],
    ['Widok na Zbrodnię Katyńską.', 'ul. Katyńska 5, Warszawa', 'pl'],
    ['Obok Pomnika Bohaterów Getta.', 'Bohaterów Getta 5, Warszawa', 'pl'],
    ['Mieszkanie przy ul. Bohaterów Getta 5, obok dawnego getta.', 'ul. Bohaterów Getta 5', 'pl'],
    ['The former ghetto is nearby.', 'Bohaterów Getta 5, Warszawa', 'en'],
    ['A short walk from the Holocaust memorial', 'Holocaust Memorial Drive 7', 'en'],
    ['Dom w Treblince.', 'Treblinka, mazowieckie', 'pl'],
    ['Dom w Sobiborze.', 'Sobibór 12, Włodawa', 'pl'],
    ['Majdanek 1944.', 'Majdanek 12, Lublin', 'pl'],
    ['Żydowska dzielnica.', 'ul. Żydowska 5, Lublin', 'pl'],
    // Marker-free, and not this listing's: as text alone it is no address.
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

  // The street rule, not the guard, judges an address that is not the listing's.
  describe.each<[string, Locale]>([
    ['Mieszkanie przy alei Katyńskiej.', 'pl'],
    ['Calle del Gueto 5.', 'es'],
    ['Holocaust Memorial Drive 7.', 'en'],
    ['os. Bohaterów Getta 3.', 'pl'],
    ['ul. bohaterów getta 5.', 'pl'],
  ])('%j, not the listing own: past the guard', (text, locale) => {
    const context = { listing_location: 'Warszawa' };
    it('description body', async () => {
      expect(await body(text, '', context, locale)).not.toBe('protected_ground');
    });
    it('/api/adapt', async () => {
      expect(await adapt(text, context)).not.toBe('protected_ground');
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
