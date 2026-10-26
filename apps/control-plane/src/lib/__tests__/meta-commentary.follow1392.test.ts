/**
 * FOLLOW-1392 — model meta-commentary is refused on BOTH paths, never stripped.
 *
 * A Sonnet 5.5 body in the FOLLOW-1381 live run (`waw.first_time_buyer.en`) ended with a note to
 * the operator: "Correction: the first sentence above contains a slip (…)". The description now
 * fails as `FAILED / meta_commentary`, a headline is suppressed as `meta_commentary`, an adapt slot
 * is refused as `meta_commentary` (`lib/meta-commentary.ts`). Legitimate copy — the imperative
 * "Note the south-facing terrace", "Here is a home that…", "The listing names two items" — is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(() => ({ messages: { create: mockCreate } }));
  return { default: MockAnthropic };
});
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import type { DescriptionRequestedEvent } from '@estalara/shared';
import { getPlaybook } from '@estalara/shared/playbooks';
import { bodyViolatesContract } from '@/lib/grounding-check';
import { generateDescription } from '@/lib/description-generator';
import { callLlmGateway } from '@/lib/llm-gateway';
import { hasMetaCommentary } from '@/lib/meta-commentary';

/** The real leaked body (FOLLOW-1381 live run, Sonnet 5.5, `waw.first_time_buyer.en`). */
const LEAKED_BODY =
  "A two-bedroom... no, a two-room flat of 48 m² on the 5th floor of a building from 2015, on ul. Kłobucka in Warsaw's Mokotów. It is a manageable next step from renting, with a listed price of 799000 PLN and an administrative fee of 520 zł a month, so the main costs are clear from the start.\n\n" +
  'The flat is finished and furnished. The living room has a kitchenette and opens onto a loggia.\n\n' +
  'It is a place you can picture coming home to, and a realistic first step onto the ownership ladder.\n\n\n\n' +
  'Correction: the first sentence above contains a slip ("A two-bedroom... no, a two-room flat"). The corrected opening is: "A two-room flat of 48 m² on the 5th floor of a building from 2015, on ul. Kłobucka in Warsaw\'s Mokotów." The rest of the description stands as written.';

const LEAKS: readonly string[] = [
  // en — note markers
  'A bright flat in Mokotów.\n\nCorrection: the opening sentence should read "two-room".',
  'A bright flat in Mokotów. Note: the price excludes the parking space.',
  'Note: all figures are taken from the listing.',
  '(Note: I kept the tone neutral.) A bright flat in Mokotów.',
  'A bright flat in Mokotów.\nWord count: 112',
  'A bright flat in Mokotów.\nN.B.: the loggia faces east.',
  // en — phrases
  'As an AI, I cannot verify the floor area.',
  "I can't confirm the parking price, but the flat is bright.",
  'I apologise for the error above; the flat has two rooms.',
  'Here is the revised description: a bright flat in Mokotów.',
  "Here's the headline for a first-time buyer",
  'A bright flat, as described in the listing above.',
  'Based on the facts provided, the flat has two rooms.',
  'Everything here comes from the provided listing.',
  'I have kept to the facts in the prompt.',
  'The instructions ask for no outcome promises, so the flat is simply bright.',
  'A bright flat in Mokotów (98 words).',
  'Call [insert agent name] to arrange a viewing.',
  'Call {{agent_phone}} today.',
  'Here is the adapted copy for you:\nA bright flat in Mokotów.',
  // pl
  'Jasne mieszkanie na Mokotowie.\n\nPoprawka: pierwsze zdanie powinno brzmieć inaczej.',
  'Jasne mieszkanie na Mokotowie. Uwaga: cena nie obejmuje miejsca postojowego.',
  'Nota: wszystkie dane pochodzą z ogłoszenia.',
  'Oto opis dla kupującego: jasne mieszkanie na Mokotowie.',
  'Przepraszam, w pierwszym zdaniu jest błąd.',
  'Nie mogę potwierdzić powierzchni, ale mieszkanie jest jasne.',
  'Zgodnie z powyższym opisem mieszkanie ma dwa pokoje.',
  'Na podstawie podanych faktów mieszkanie ma dwa pokoje.',
  'Zadzwoń pod [wstaw numer telefonu].',
  'Jasne mieszkanie na Mokotowie (95 słów).',
  // es
  'Aquí tienes la descripción adaptada: un piso luminoso en Mokotów.',
  'Un piso luminoso en Mokotów. Nota: el precio no incluye la plaza de garaje.',
  'Corrección: la primera frase debe decir dos habitaciones.',
  'Lo siento, la frase anterior contenía un error.',
  'No puedo confirmar la superficie, pero el piso es luminoso.',
  'Según los datos proporcionados, el piso tiene dos habitaciones.',
  'Llame a [nombre del agente] para una visita.',
];

const LEGITIMATE: readonly string[] = [
  'Note the south-facing terrace and the oak floors.',
  'Notice how the living room opens onto the loggia.',
  'Here is a home that keeps the daily routine simple.',
  'Here you get a garden, a garage and a quiet street.',
  'The listing names two items: the upstairs windows and the electrics.',
  'The apartment is currently let; the tenant asks for 24 hours notice.',
  'Ask the agent for the details provided by the seller.',
  'A prompt handover is possible, and the title is clear.',
  'Ogrzewanie: gazowe. Garaż: dwustanowiskowy.',
  'Uwaga na detale: dębowe podłogi i potrójne szyby.',
  'Oto mieszkanie, w którym poranne słońce wpada do salonu.',
  'Aquí tiene una cocina amplia y una terraza cubierta.',
  'Precio: 189 000 EUR. Superficie: 32 m².',
  'Viewings by appointment; the agency answers within a day.',
  'Two bedrooms widen the pool of households that can rent it.',
  'Price: 799000 PLN. Notes on the building: a lift and a bike room.',
];

describe('FOLLOW-1392 — hasMetaCommentary', () => {
  it('flags the real leaked body', () => {
    expect(hasMetaCommentary(LEAKED_BODY)).toBe(true);
  });

  it('flags the leaked body even without its "Correction:" paragraph (the slip itself)', () => {
    const slipOnly = LEAKED_BODY.slice(0, LEAKED_BODY.indexOf('\n\n\n\nCorrection'));
    expect(hasMetaCommentary(slipOnly)).toBe(true);
  });

  it.each(LEAKS)('flags %j', (text) => {
    expect(hasMetaCommentary(text)).toBe(true);
  });

  it.each(LEGITIMATE)('lets %j through', (text) => {
    expect(hasMetaCommentary(text)).toBe(false);
  });
});

describe('FOLLOW-1392 — the description contract', () => {
  it('the real leaked body is meta_commentary', () => {
    expect(bodyViolatesContract(LEAKED_BODY)).toBe('meta_commentary');
  });

  it('the older leak markers keep their own code', () => {
    expect(bodyViolatesContract('As an AI, I cannot verify this.')).toBe('leak_marker');
  });
});

const EVENT = {
  tenant_id: '00000000-0000-4000-8000-000000001392',
  listing_id: 'listing-1392',
  archetype: 'first_time_buyer',
  locale: 'en',
  copy_template: 'Warm and practical.',
  original_description:
    'Na sprzedaż dwupokojowe mieszkanie o powierzchni 48 m² na 5. piętrze budynku z 2015 roku przy ul. Kłobuckiej na warszawskim Mokotowie. Mieszkanie jest wykończone i umeblowane. Czynsz administracyjny 520 zł miesięcznie.',
  listing_context: {
    listing_title: 'Dwupokojowe mieszkanie 48 m², Warszawa Mokotów',
    listing_price: '799000 PLN',
    listing_location: 'ul. Kłobucka, Warszawa, Mokotów',
  },
  cache_key: 'desc:t:listing-1392:first_time_buyer:en:m:r0',
  listing_revision: 0,
  generation_model: 'claude-sonnet-5-5',
} as DescriptionRequestedEvent;

const BODY = 'A two-room flat of 48 m² in Mokotów, finished and furnished.';

function reply(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

describe('FOLLOW-1392 — the generator', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('a body ending in a "Correction:" note is FAILED / meta_commentary, no headline call', async () => {
    mockCreate.mockResolvedValueOnce(
      reply(
        `<adaptation_verdict>FIT</adaptation_verdict>\n${BODY}\n\nCorrection: the first sentence ` +
          'above contains a slip. The rest of the description stands as written.\n' +
          '<verified_facts_used>\n[]\n</verified_facts_used>',
      ),
    );
    const report = await generateDescription(EVENT);
    expect(report.outcome).toEqual({ verdict: 'FAILED', reason: 'meta_commentary' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('a clean body is FIT; a headline that is a preamble is suppressed as meta_commentary', async () => {
    mockCreate
      .mockResolvedValueOnce(
        reply(
          `<adaptation_verdict>FIT</adaptation_verdict>\n${BODY}\n` +
            '<verified_facts_used>\n[]\n</verified_facts_used>',
        ),
      )
      .mockResolvedValueOnce(reply("Here's the headline: Two-room flat in Mokotów"));
    const report = await generateDescription(EVENT);
    expect(report.outcome.verdict).toBe('FIT');
    expect(report.headline).toBeNull();
    expect(report.headlineViolation).toBe('meta_commentary');
  });
});

describe('FOLLOW-1392 — /api/adapt refuses the slot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1392';
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: '0', data: [{ total: '0' }] }),
      text: () => Promise.resolve(''),
    });
  });
  afterEach(() => {
    delete process.env.CLICKHOUSE_URL;
  });

  const refusedSources = (): string[] =>
    (mockFetch.mock.calls as unknown as [unknown][])
      .map(([url]) => {
        try {
          return new URL(String(url)).searchParams.get('param_p_source');
        } catch {
          return null;
        }
      })
      .filter((s): s is string => !!s && s.startsWith('fact_check_slot_refused_'));

  it.each([
    'Two-bedroom apartment in Lisbon. Note: the facts provided do not state a price.',
    'Correction: two-bedroom apartment in Lisbon',
    'Oto nagłówek: dwupokojowe mieszkanie w Lizbonie',
    'Aquí tienes el titular: apartamento de dos dormitorios en Lisboa',
  ])('a cta %j is refused as meta_commentary; the grounded headline is served', async (cta) => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify([
            {
              type: 'text',
              slot: 'headline',
              value: 'Two-bedroom apartment in Lisbon',
              archetype: 'yield_hunter',
              confidence: 0.8,
            },
            { type: 'text', slot: 'cta', value: cta, archetype: 'yield_hunter', confidence: 0.8 },
          ]),
        },
      ],
      usage: { input_tokens: 150, output_tokens: 50 },
    });
    const result = await callLlmGateway({
      archetypeId: 'yield_hunter',
      confidence: 0.75,
      similarity: 0.75,
      basePlaybook: getPlaybook('yield_hunter'),
      listingContext: {
        listing_title: 'apartment',
        listing_description: 'an apartment with two bedrooms',
        listing_location: 'Lisbon',
      },
    });
    expect(result?.directives.map((d) => d.slot)).toEqual(['headline']);
    expect(refusedSources()).toEqual(['fact_check_slot_refused_cta_meta_commentary']);
    // Deterministic: no judge round trip.
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
