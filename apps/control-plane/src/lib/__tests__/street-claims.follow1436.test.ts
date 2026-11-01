// @vitest-environment node
/**
 * FOLLOW-1436 — a count in title case is no house number, and "Alej…" no street prefix. A number
 * before `Terrace`, `Court`, `Close`, `Place` or `Way` counts only after a locating word: these
 * five are ordinary nouns, and nothing else in "3 Season Terrace" tells it from "12 Elm Terrace".
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

import { getPlaybook } from '@estalara/shared/playbooks';
import { generateDescription } from '@/lib/description-generator';
import { callLlmGateway } from '@/lib/llm-gateway';
import { checkTypedClaims } from '@/lib/typed-claims';

const street = (original: string, text: string) =>
  checkTypedClaims(text, [{ field: 'original_description', text: original }]).find(
    (c) => c.kind === 'street' && c.violation !== null,
  )?.violation ?? null;

const reply = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
});

/** The description path's code for a body: `FIT`, or the violation. */
async function body(text: string, original: string, locale: 'en' | 'pl' | 'es') {
  mockCreate.mockReset();
  mockCreate
    .mockResolvedValueOnce(
      reply(
        `<adaptation_verdict>FIT</adaptation_verdict>\n${text}\n<verified_facts_used>\n[]\n</verified_facts_used>`,
      ),
    )
    .mockResolvedValueOnce(reply('Home'));
  const { outcome } = await generateDescription({
    tenant_id: '00000000-0000-4000-8000-000000001436',
    listing_id: 'listing-1436',
    archetype: 'lifestyle_expat',
    locale,
    copy_template: 'Warm and practical.',
    original_description: original,
    listing_context: {},
    cache_key: `desc:t:listing-1436:lifestyle_expat:${locale}:m:r0`,
    listing_revision: 0,
    generation_model: 'claude-sonnet-5-5',
  });
  const o = outcome as { verdict: string; violation?: string; reason?: string };
  return o.violation ?? o.reason ?? o.verdict;
}

/** The gateway's logged violation for a cta, or `served`. */
async function adapt(value: string, listing: string) {
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
    listingContext: { listing_description: listing },
  });
  const logged = warn.mock.calls
    .map((c) => /violation: (\w+)/u.exec(String(c[0]))?.[1])
    .find((v) => v !== undefined);
  warn.mockRestore();
  if (logged !== undefined) return logged;
  return output?.directives.some((d) => 'value' in d && d.value === value) ? 'served' : 'dropped';
}

const FALSE_REFUSALS: [string, string][] = [
  ['A 2 Story Terrace.', 'A 2 story home with a terrace.'],
  ['3 Season Terrace.', 'Home with a 3 season room and a terrace.'],
  ['360 Degree Terrace.', '360 degree views from the terrace.'],
  ['A 20 Foot Terrace.', 'A 20 foot terrace.'],
  ['With 2 Separate Terrace.', 'With 2 separate terraces.'],
  ['1 Acre Close.', 'On a 1 acre lot, close to town.'],
  // Locating words decide nothing when the words after the number are a measure.
  ['Located on 2 Story Terrace.', 'A 2 story home with a terrace.'],
  // The same count before an unambiguous street word.
  ['4 Wheel Drive Access.', 'With 4 wheel drive access.'],
  ['2 Lane Road Nearby.', 'On a 2 lane road nearby.'],
  ['20 Foot Drive.', 'A 20 foot drive.'],
  ['2 Modern Court.', 'With 2 modern courts.'],
  ['3 Palms Way.', 'Near 3 palms and a way down.'],
];

const NOT_STREETS: [string, string, 'en' | 'pl' | 'es'][] = [
  ['Alejandra Ruiz will show you round.', 'Ask for Alejandra Ruiz.', 'en'],
  ['Alejandría Beach is near.', 'Near Alejandría Beach.', 'en'],
  ['Alejka Spacerowa prowadzi do parku.', 'Alejka Spacerowa prowadzi do parku.', 'pl'],
  ['Alejo Ruiz will show you round.', 'Ask for Alejo Ruiz.', 'en'],
];

describe('FOLLOW-1436: false refusals', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1436';
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(FALSE_REFUSALS)('no street: %j on %j', (text, original) => {
    expect(street(original, text)).toBeNull();
    // Nor where the listing does not state the number: it was no street either way.
    expect(street('A flat.', text)).toBeNull();
  });

  it.each(FALSE_REFUSALS)('whole paths: %j on %j', async (text, original) => {
    expect(await body(text, original, 'en')).not.toBe('unsupported_street');
    expect(await adapt(text, original)).not.toBe('unsupported_street');
  });

  it.each(NOT_STREETS)('no street: %j', (text, original) => {
    expect(street(original, text)).toBeNull();
    // Not on the listing either: no street at all, so no street rule.
    expect(street('A flat.', text)).toBeNull();
  });

  it.each(NOT_STREETS)('whole paths: %j', async (text, original, locale) => {
    expect(await body(text, original, locale)).toBe('FIT');
    expect(await adapt(text, original)).toBe('served');
    expect(await body(text, 'A flat.', locale)).not.toBe('unsupported_street');
    expect(await adapt(text, 'A flat.')).not.toBe('unsupported_street');
  });
});

describe('FOLLOW-1431: a loosening, so a listing loses no fact to the wider aleja', () => {
  it.each([
    ['Przy Alejach Umeblowane Mieszkanie.', 'Umeblowane mieszkanie.'],
    ['Apartament w Alejach Jerozolimskich Umeblowany.', 'Umeblowany apartament.'],
  ])('%j still grounds %j', (listing, text) => {
    expect(
      checkTypedClaims(text, [{ field: 'original_description', text: listing }]).filter(
        (c) => c.violation !== null,
      ),
    ).toEqual([]);
  });
});

describe('FOLLOW-1436: what stays read', () => {
  const PLAIN = 'A bright flat with a balcony.';
  it.each([
    'A home at 12 Elm St',
    '12 Elm St',
    '9 Blackberry Pl',
    'Next to 9 Ocean Terrace.',
    'A home at 12 Elm Court.',
    'Located on 7 Harbour Close.',
    'Near 12 Bath Place.',
    'Along 12 Ocean Way.',
    '12 Elm Road.',
    '12 Elm Crescent.',
  ])('%j', (text) => {
    expect(street(PLAIN, text)).toBe('unsupported_street');
  });

  it.each([
    'Mieszkanie w Alejach Jerozolimskich.',
    'Mieszkanie przy alei Róż.',
    'Aleja Róż prowadzi do parku.',
    'Mieszkanie przy Alei Róż.',
    'Dojazd z Alej Jerozolimskich.',
    'Nad Aleją Róż.',
    'Na Aleję Róż.',
    'Aleje Jerozolimskie.',
    'Alejami Jerozolimskimi do centrum.',
  ])('every form of aleja: %j', (text) => {
    expect(street(PLAIN, text)).toBe('unsupported_street');
  });
});
