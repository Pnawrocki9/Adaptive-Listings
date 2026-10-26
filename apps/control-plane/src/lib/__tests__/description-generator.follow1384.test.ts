/**
 * FOLLOW-1384 — the generator checks the language of what it serves.
 *
 * The FOLLOW-1381 live re-run of the FOLLOW-1380 cases served three Polish descriptions on English
 * pages (Haiku 5.5: waw.lifestyle_expat.en, gda.family_buyer.en, gda.flip_investor.en — their
 * bodies are below, verbatim). A body in another supported language than the page's locale is now
 * a contract failure: `FAILED / wrong_language`, not cached, never translated. A headline in the
 * wrong language is suppressed with `headlineViolation: 'wrong_language'`.
 *
 * Negative controls: English copy that names Polish streets and districts ("ul. Kłobucka",
 * "Mokotów", "Straszyn") or Spanish place names with function words inside them ("Playa de la
 * Arenal") is not refused, and neither is a short text with only a name or two.
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
import { checkOutputLanguage } from '@/lib/output-language';

// ─── The FOLLOW-1381 live outputs (scratch run, 2026-10-25) ──────────────────

const HAIKU_WAW_LIFESTYLE_EXPAT_EN =
  'Mieszkanie na Mokotowie, które od pierwszego dnia działa bez wielkich planów remontowych. Dwa pokoje na 48 m², wykończone i umeblowane, z salonem połączonym z aneksem kuchennym i wyjściem na loggię, oddzielną sypialnią oraz łazienką z wanną. Okna wychodzą na wschód, więc poranne światło wchodzi do mieszkania od razu.\n\nBudynek z 2015 roku ma windę, rowerownię i ochronę, a miejsce postojowe w hali garażowej jest dostępne za dodatkową opłatą. Do stacji metra Wierzbno jest około 10 minut tramwajem, co daje prosty, przewidywalny dojazd do centrum. W okolicy są park Dreszera, sklepy i punkty usługowe, więc codzienne sprawy załatwia się blisko domu.\n\nCzynsz administracyjny wynosi 520 zł miesięcznie. Księga wieczysta jest założona, a mieszkanie można odebrać szybko, bez długiego oczekiwania.';

const SONNET_WAW_LIFESTYLE_EXPAT_EN =
  "A two-room, 48 m² apartment on ul. Kłobucka in Warsaw's Mokotów, made for a soft landing in a new city. It is finished and furnished, so there is nothing to renovate and nothing to buy before you unpack. The living room with kitchenette opens onto a loggia, and a separate bedroom and a bathroom with a bathtub complete a layout that is simple and predictable. The windows face east. The flat is on the 5th floor of a building from 2015, with a lift, a bicycle room and security, the kind of established setup that suits someone settling in from abroad. The metro station Wierzbno is around 10 minutes away by tram, so the commute stays uncomplicated. Dreszer Park, shops and service points sit nearby, which keeps daily life walkable and well-connected. A parking space in the garage hall is available for an additional 45,000 zł. The administrative fee is 520 zł per month. The land and mortgage register is established, and the flat can be handed over quickly, so the move can start soon. The price is 799,000 PLN.";

const HAIKU_GDA_FAMILY_BUYER_EN =
  'Dom wolnostojący z 1998 roku w Straszynie pod Gdańskiem, o powierzchni użytkowej 165 m², stojący na działce 920 m². Na parterze znajdują się salon z kominkiem, kuchnia, pokój i łazienka, a na piętrze trzy sypialnie oraz druga łazienka. Ta układanka daje przestrzeń na codzienne życie i zmiany, które przychodzą z czasem.\n\nGaraż dwustanowiskowy jest częścią bryły budynku, więc samochody mają miejsce pod ręką. Ogrzewanie gazowe, a w nim piec wymieniony w 2021 roku, to konkretna pozycja, na której można się oprzeć przy planowaniu. Dom wymaga odświeżenia: okna na piętrze i instalacja elektryczna w części budynku są do wymiany, więc warto to uwzględnić w budżecie od początku.\n\nOgród jest ogrodzony i ma drzewa owocowe, czyli miejsce na poranną kawę na zewnątrz i na spokojne popołudnia. Do obwodnicy Trójmiasta jest 5 km, a w miejscowości znajdują się szkoła podstawowa i sklepy.';

const SONNET_GDA_FAMILY_BUYER_EN =
  'A detached house from 1998 in Straszyn, near Gdańsk, with 165 m² of usable space on a 920 m² plot. This is a move-up home with room to spare, and a layout that will still work in ten years. On the ground floor, the living room has a fireplace, and there is a kitchen, a further room and a bathroom. That extra room can change purpose as your needs do. Upstairs are three bedrooms and a second bathroom, so mornings have somewhere to flow. The double garage is built into the house, which gives generous storage and parking under one roof. The garden is fenced and has fruit trees, with plenty of outdoor space. Heating is gas, with a new boiler installed in 2021. The house needs refreshing: the upstairs windows and the wiring in part of the building are due for replacement. It is a chance to settle in and shape the place to your own daily rhythm. The ring road around the Tricity is 5 km away, and the village has a primary school and shops. A settled address with scope for the next decade, not just the next two years. Asking price: 1,150,000 PLN.';

const HAIKU_GDA_FLIP_INVESTOR_EN =
  'Wolnostojący dom z 1998 roku w Straszynie pod Gdańskiem, o powierzchni użytkowej 165 m² na działce 920 m². Konstrukcja budynku jest stabilna, a zakres prac to przede wszystkim odświeżenie: wymiana okien na piętrze i modernizacja instalacji elektrycznej w części budynku. Wnętrza wymagają pracy kosmetycznej i nadają się pod zmianę standardu wykończenia.\n\nNa parterze znajdują się salon z kominkiem, kuchnia, pokój i łazienka. Na piętrze są trzy sypialnie i druga łazienka. Garaż dwustanowiskowy jest w bryle budynku, więc nie trzeba go dobudowywać.\n\nOgrzewanie gazowe, nowy piec z 2021 roku, czyli jeden element instalacji nie wymaga pilnej interwencji. Ogród ogrodzony, z drzewami owocowymi, to działka z gotowym zagospodarowaniem zieleni.\n\nObwodnica Trójmiasta jest w odległości 5 km, a w miejscowości działają szkoła podstawowa i sklepy. Dla inwestora to przewidywalny zakres prac przy cenie wywoławczej 1 150 000 PLN. Matematyka wyjścia jest prosta: znany zakres remontu, znana lokalizacja, znany stan techniczny.';

const WAW = {
  original:
    'Na sprzedaż dwupokojowe mieszkanie o powierzchni 48 m² na 5. piętrze budynku z 2015 roku przy ul. Kłobuckiej na warszawskim Mokotowie. Salon z aneksem kuchennym i wyjściem na loggię, osobna sypialnia, łazienka z wanną. Mieszkanie jest wykończone i umeblowane, okna wychodzą na wschód. W budynku winda, rowerownia i ochrona; miejsce postojowe w hali garażowej za dodatkową opłatą 45 000 zł. Do stacji metra Wierzbno około 10 minut tramwajem. W okolicy park Dreszera, sklepy i punkty usługowe. Czynsz administracyjny 520 zł miesięcznie. Księga wieczysta założona, możliwość szybkiego wydania mieszkania.',
  context: {
    listing_title: 'Dwupokojowe mieszkanie 48 m², Warszawa Mokotów',
    listing_price: '799000 PLN',
    listing_location: 'ul. Kłobucka, Warszawa, Mokotów',
  },
};
const GDA = {
  original:
    'Dom wolnostojący z 1998 roku w Straszynie pod Gdańskiem, 165 m² powierzchni użytkowej na działce 920 m². Na parterze salon z kominkiem, kuchnia, pokój i łazienka; na piętrze trzy sypialnie i druga łazienka. Garaż dwustanowiskowy w bryle budynku. Ogrzewanie gazowe, nowy piec z 2021 roku. Dom wymaga odświeżenia: do wymiany są okna na piętrze i instalacja elektryczna w części budynku. Ogród ogrodzony, z drzewami owocowymi. Do obwodnicy Trójmiasta 5 km, w miejscowości szkoła podstawowa i sklepy.',
  context: {
    listing_title: 'Dom wolnostojący 165 m², Straszyn',
    listing_price: '1150000 PLN',
    listing_location: 'Straszyn, pomorskie',
  },
};

function event(
  listing: { original: string; context: Record<string, string> },
  archetype: string,
  locale: 'en' | 'pl' | 'es',
): DescriptionRequestedEvent {
  return {
    tenant_id: '00000000-0000-4000-8000-000000001384',
    listing_id: 'listing-1384',
    archetype,
    locale,
    copy_template: 'Warm and practical.',
    original_description: listing.original,
    listing_context: listing.context,
    cache_key: `desc:t:listing-1384:${archetype}:${locale}:m:r0`,
    listing_revision: 0,
    generation_model: 'claude-haiku-5-5',
  } as DescriptionRequestedEvent;
}

function reply(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

const fit = (body: string): string =>
  `<adaptation_verdict>FIT</adaptation_verdict>\n${body}\n<verified_facts_used>\n[]\n</verified_facts_used>`;

describe('FOLLOW-1384 — a description in the wrong language is not served', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['waw.lifestyle_expat.en', WAW, 'lifestyle_expat', HAIKU_WAW_LIFESTYLE_EXPAT_EN],
    ['gda.family_buyer.en', GDA, 'family_buyer', HAIKU_GDA_FAMILY_BUYER_EN],
    ['gda.flip_investor.en', GDA, 'flip_investor', HAIKU_GDA_FLIP_INVESTOR_EN],
  ])(
    '%s: the Polish body on an English page is FAILED / wrong_language',
    async (_id, l, a, body) => {
      mockCreate.mockResolvedValueOnce(reply(fit(body)));
      const report = await generateDescription(event(l, a, 'en'));
      expect(report.outcome).toEqual({ verdict: 'FAILED', reason: 'wrong_language' });
      expect(report.claimsValidation).toBeNull();
      expect(report.writes).toEqual({ pg: 'skipped', redis: 'skipped', audit: 'skipped' });
      // No headline is requested for a failed body.
      expect(mockCreate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['waw.lifestyle_expat', WAW, 'lifestyle_expat', HAIKU_WAW_LIFESTYLE_EXPAT_EN],
    ['gda.family_buyer', GDA, 'family_buyer', HAIKU_GDA_FAMILY_BUYER_EN],
    ['gda.flip_investor', GDA, 'flip_investor', HAIKU_GDA_FLIP_INVESTOR_EN],
  ])('%s: the same Polish body on a Polish page is FIT', async (_id, l, a, body) => {
    mockCreate
      .mockResolvedValueOnce(reply(fit(body)))
      .mockResolvedValueOnce(reply('Dom w Straszynie'));
    const report = await generateDescription(event(l, a, 'pl'));
    expect(report.outcome.verdict).toBe('FIT');
  });

  it.each([
    ['waw.lifestyle_expat.en', SONNET_WAW_LIFESTYLE_EXPAT_EN],
    ['gda.family_buyer.en', SONNET_GDA_FAMILY_BUYER_EN],
  ])('%s: English copy naming Polish streets and towns is English', (_id, body) => {
    expect(checkOutputLanguage(body, 'en')).toBeNull();
  });

  it('a wrong-language headline is suppressed as wrong_language; the body is still served', async () => {
    mockCreate
      .mockResolvedValueOnce(reply(fit(SONNET_WAW_LIFESTYLE_EXPAT_EN)))
      .mockResolvedValueOnce(
        reply('Dwupokojowe mieszkanie 48 m² przy ul. Kłobuckiej na Mokotowie z loggią'),
      );
    const report = await generateDescription(event(WAW, 'lifestyle_expat', 'en'));
    expect(report.outcome.verdict).toBe('FIT');
    expect(report.headline).toBeNull();
    expect(report.headlineViolation).toBe('wrong_language');
  });
});

describe('FOLLOW-1384 — checkOutputLanguage boundaries', () => {
  it.each([
    ['Detached villa with pool and tourist licence, Jávea', 'pl'],
    ['Dom wolnostojący z ogrodem w Straszynie', 'en'],
    ['Casa con piscina y jardín en la costa', 'en'],
    ['A detached house with a garden and a pool', 'es'],
    ['Dwupokojowe mieszkanie 48 m² przy ul. Kłobuckiej na Mokotowie z loggią', 'en'],
  ] as const)('%j is the wrong language for %s', (text, locale) => {
    expect(checkOutputLanguage(text, locale)).toBe('wrong_language');
  });

  it.each([
    // English with Polish and Spanish names.
    [
      'Two-bedroom flat in Warszawa Mokotów, lift, loggia and secure building on ul. Kłobucka',
      'en',
    ],
    ['Detached house in Straszyn, 165 m² on 920 m² plot, three bedrooms and garden', 'en'],
    ['Villa near Playa de la Arenal', 'en'],
    ['Villa, Playa de la Arenal', 'en'],
    ['Apartment on the Costa del Sol', 'en'],
    ['Flat in Nowe Miasto nad Wartą', 'en'],
    ['Flat on ul. Na Uboczu.', 'en'],
    ['Krakow Podgorze', 'pl'],
    // Short texts and names only.
    ['Jávea', 'en'],
    ['Mokotów, Warszawa', 'en'],
    ['', 'en'],
    // The right language.
    ['Dom wolnostojący z ogrodem w Straszynie', 'pl'],
    ['Casa con piscina y jardín en la costa', 'es'],
    ['A detached house with a garden and a pool', 'en'],
    // Polish copy that quotes English names.
    ['Mieszkanie w budynku The Tower, blisko Old Town', 'pl'],
  ] as const)('%j is accepted for %s', (text, locale) => {
    expect(checkOutputLanguage(text, locale)).toBeNull();
  });
});
