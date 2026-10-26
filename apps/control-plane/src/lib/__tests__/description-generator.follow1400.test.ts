/**
 * FOLLOW-1400 — the description path runs the familial-steering refusal `/api/adapt` runs.
 *
 * FOLLOW-1360 made `/api/adapt` refuse any directive `steersByFamilialStatus` matches, on every
 * request, with or without the `has_children` trait, whoever wrote the words (ESC-086; ESC-088
 * kept the trait as built on exactly that condition). The description generator did not run it:
 * in the FOLLOW-1399 comparison Sonnet 5.5 wrote "dla rodziny" in four Polish bodies and two were
 * served. The same function now runs on the body (`REFUSED / familial_steering`) and on the
 * headline (`headlineViolation: 'familial_steering'`): one vocabulary, one implementation
 * (`@estalara/shared/playbook-traits`), refuse — never strip.
 *
 * The four bodies below are the study's, verbatim (compare-1399 `gen.jsonl`, 2026-10-26). Two were
 * served (fx, wro); two were refused for another reason (jav: "pod klucz"; lis: "lat 30."), and
 * are now refused for steering first, as `/api/adapt` orders it.
 *
 * Controls: the vocabulary is phrases, not the word "family". A property type ("single-family
 * home", "dom jednorodzinny"), a diaspora's relatives recognising an address ("adres, który
 * rodzina rozpozna"), and "rodzinna okolica" are not in it and are served — the boundary is the
 * shared list, not decided here.
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
import { steersByFamilialStatus } from '@estalara/shared/playbook-traits';
import { generateDescription } from '@/lib/description-generator';

// ─── The FOLLOW-1399 outputs (Sonnet 5.5, PL pages), verbatim ─────────────────

const SONNET_FX_DIASPORA_PL =
  'Dom jednorodzinny przy 9 Blackberry Pl w Palm Coast na Florydzie, z trzema sypialniami i dwiema łazienkami, za 385000 USD. Dla kupującego, który ma w tym domu powód finansowy i osobisty, adres wpisuje się w obie księgi naraz. Ulica jest cicha i mieszkalna. Strefa dzienna ma otwarty plan, więc rodzina mieści się przy jednym stole bez dzielenia na pokoje. Do domu należy garaż na dwa samochody i zadaszona lanai z siatką, a całość otacza dojrzały ogród. Szkoły, Intracoastal Waterway i lokalne punkty usługowe są blisko. Zakup przez osobę mieszkającą poza USA jest tu standardową ścieżką. Konkretne kwestie podatkowe i formalne warto omówić z agentem. Dla kogoś, kto myśli o powrocie albo o zabezpieczeniu dla rodziny, głębszy zwrot to sam adres: dom, który można zapisać w księdze wieczystej jako rodzinny punkt oparcia.';

const SONNET_JAV_SECOND_HOME_PL =
  'Wolnostojąca willa w rejonie Montgó w Jávei, na Costa Blance, zaprojektowana pod więcej weekendów i mniej formalności. Sprzedawana z wyposażeniem, więc pod klucz: otwierasz drzwi i zaczynasz odpoczynek. Dom ma 210 m² zabudowy na działce o powierzchni 1050 m², a teren jest ogrodzony i zamykany, z miejscem na trzy samochody. To wygodne, gdy wracasz tu raz po raz i chcesz po prostu zamknąć bramę i wyjechać.\n\nWszystko, czego potrzeba na krótki pobyt, jest na jednym poziomie: sypialnia główna, kuchnia z pełnym wyposażeniem i salon z jadalnią, który wychodzi na zadaszony taras z widokiem na górę Montgó. Z tarasu na piętrze widać też morze. Dwie sypialnie gościnne mają własne wejście na dolnym poziomie, więc goście mają swoją przestrzeń, a dom jest dwufunkcyjny: sprawdzi się dla rodziny i dla gości. Łącznie są cztery sypialnie i trzy łazienki.\n\nNa zewnątrz czeka prywatny basen o wymiarach 10 x 5 m i kuchnia letnia. Klimatyzacja grzeje i chłodzi, w łazienkach jest ogrzewanie podłogowe, a posesja jest podłączona do kanalizacji miejskiej. Plaża Arenal i centrum miasta są oddalone o 10 minut jazdy samochodem.\n\nNieruchomość ma licencję na wynajem turystyczny zarejestrowaną we Wspólnocie Walenckiej. Podatek IBI wynosi 1120 EUR rocznie. Cena: 895 000 EUR.';

const SONNET_WRO_DIASPORA_PL =
  'Czteropokojowe mieszkanie o powierzchni 78,4 m² na parterze nowego budynku z 2024 roku, na wrocławskim Jagodnie. Dla kogoś, kto myśli o powrocie albo o zabezpieczeniu dla rodziny w kraju, to adres, który rodzina rozpozna od razu, w standardzie nowego budownictwa. Salon z aneksem kuchennym ma 29 m² i wychodzi na ogródek o powierzchni 60 m². Są trzy sypialnie, łazienka z wanną oraz osobna łazienka z prysznicem przy sypialni głównej. Taki układ sprawdza się na co dzień i na rodzinne wizyty, a dzięki trzem sypialniom dom pomieści też kilka pokoleń naraz. Mieszkanie jest w stanie deweloperskim, z wylewkami i tynkami, więc wykończenie zrobisz według własnego projektu, w standardzie, do jakiego jesteś przyzwyczajony. Komórka lokatorska 4 m² i miejsce postojowe w garażu podziemnym są w cenie 899 000 PLN. Osiedle jest zamknięte i ma plac zabaw. W odległości 400 m znajdują się przedszkole i szkoła podstawowa, w pobliżu market i przychodnia, a autobusem do centrum dojedziesz w około 25 minut. To rynek pierwotny, bez podatku PCC. Ogródek, szkoła za rogiem i miejsce dla rodziny sprawiają, że najgłębszy zwrot z tej inwestycji to sam adres.';

const SONNET_LIS_DIASPORA_PL =
  'Dwupokojowe mieszkanie o powierzchni 85 m² na drugim piętrze kamienicy z lat 30. w Campo de Ourique w Lizbonie. Cena: 640000 EUR. Adres znajomy dla rodziny, wykończenie na poziomie, do którego czytelnik zdążył się przyzwyczaić gdzie indziej: remont zakończono w 2021 roku, a oryginalne sosnowe podłogi i wysokie sufity zostały zachowane. Salon ma dwa okna balkonowe z małymi balkonami, wychodzące na ulicę obsadzoną drzewami. Kuchnia jest wyposażona, do tego łazienka i osobna toaleta dla gości. Budynek nie ma windy. Do Jardim da Estrela idzie się 7 minut. W dzielnicy działają targ pod dachem i kawiarnie, a przy pętli tramwaju 28 zaczyna się codzienny rytm okolicy. Świadectwo energetyczne: C. Czynsz administracyjny wynosi 65 EUR miesięcznie.\n\nTo nieruchomość na przecięciu dwóch ksiąg: finansowej i osobistej. Dwie sypialnie sprawdzą się jako dom rodzinny, miejsce na powrót albo adres dla bliskich, a jednocześnie jako lokal o jasno określonych kosztach stałych. Prawdziwy zwrot to tu sam adres, wpisany w księdze wieczystej, w dzielnicy z charakterem. Zanim przejdziecie do liczb, zapytajcie agenta o szczegóły formalne zakupu.';

// ─── Controls: FIT in the same study, served unchanged ──────────────────────

const HAIKU_FX_DIASPORA_EN =
  'A three-bedroom, two-bathroom single-family home at 9 Blackberry Pl, Palm Coast, Florida, on a quiet residential street. For a buyer with both a financial and a personal reason to look at a Florida address, this home offers the practical specification you have grown used to abroad: an open-plan living area, an attached two-car garage, and a screened lanai where the family can spend the evenings. The mature garden gives the property an established feel rather than a new-build one. The house sits close to schools, the intracoastal waterway and local amenities, so daily life stays practical from the day you arrive. The listing price is $385,000. Whether this becomes a home you return to, a family base, or both, the address does most of the work: a settled street in a town that is easy to live in.';

const HAIKU_WRO_DIASPORA_PL =
  'Czteropokojowe mieszkanie na parterze nowego budynku na wrocławskim Jagodnie, oddanego do użytku w 2024 roku. Jego 78,4 m² daje trzy sypialnie i salon z aneksem kuchennym o powierzchni 29 m², z wyjściem na ogródek o powierzchni 60 m². To układ, w którym dorosłe dzieci, rodzice albo goście mogą mieć własną przestrzeń, a wspólny dzień toczy się w jednym, dużym salonie.\n\nDla kogoś, kto wraca myślą do kraju albo chce zabezpieczyć rodzinę w Polsce, ważny jest też sam adres: osiedle zamknięte, plac zabaw na terenie, przedszkole i szkoła podstawowa w odległości 400 m, market i przychodnia w pobliżu. Autobus do centrum to około 25 minut. Mieszkanie należy do rynku pierwotnego, więc zakup odbywa się bez podatku PCC.\n\nLokal jest w stanie deweloperskim, z wylewkami i tynkami, i można go wykończyć według własnego projektu. Do ceny należą komórka lokatorska 4 m² oraz miejsce postojowe w garażu podziemnym. Cena katalogowa to 899 000 PLN. Wykończenie, kosztorys i ewentualne dodatkowe opłaty warto omówić bezpośrednio z deweloperem.';

// ─── The listings (compare-1399 `listings.json`) ────────────────────────────

const FX = {
  original:
    'A three-bedroom, two-bathroom single-family home on a quiet residential street. Open-plan living area, attached two-car garage, screened lanai and a mature garden. Close to schools, the intracoastal waterway and local amenities.',
  context: {
    listing_title: '9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath',
    listing_price: '385000 USD',
    listing_location: '9 Blackberry Pl, Palm Coast, FL',
  },
};

const JAV = {
  original:
    'Detached villa of 210 sqm built area on a 1,050 sqm plot in the Montgó area of Jávea, on the Costa Blanca. Four bedrooms, three bathrooms, a fully fitted kitchen and a living-dining room opening onto a covered terrace with views of the Montgó mountain and, from the upper terrace, of the sea. Private 10 x 5 m swimming pool, outdoor kitchen and parking for three cars inside the gated plot. The property holds a tourist rental licence registered with the Valencian Community. The master bedroom, kitchen and living room are all on the main floor; two guest bedrooms are on the lower floor with their own entrance. Air conditioning hot and cold, underfloor heating in the bathrooms, mains drainage. The Arenal beach and the town centre are a 10-minute drive. IBI property tax 1,120 EUR per year. Sold furnished.',
  context: {
    listing_title: 'Detached villa with pool and tourist licence, Jávea',
    listing_price: '895000 EUR',
    listing_location: 'Partida Montgó, Jávea, Alicante',
  },
};

const WRO = {
  original:
    'Czteropokojowe mieszkanie o powierzchni 78,4 m² na parterze nowego budynku (oddanie do użytku: 2024) na wrocławskim Jagodnie. Układ: salon z aneksem kuchennym (29 m²) z wyjściem do ogródka o powierzchni 60 m², trzy sypialnie, łazienka z wanną i oddzielna łazienka z prysznicem przy sypialni głównej. Mieszkanie w stanie deweloperskim, z wylewkami i tynkami, gotowe do wykończenia według własnego projektu. Do mieszkania przynależy komórka lokatorska 4 m² oraz miejsce postojowe w garażu podziemnym — oba w cenie. Osiedle zamknięte, z placem zabaw. W odległości 400 m przedszkole i szkoła podstawowa, w pobliżu market i przychodnia. Autobusem do centrum około 25 minut. Rynek pierwotny, bez podatku PCC.',
  context: {
    listing_title: '4 pokoje z ogródkiem, 78,4 m², Wrocław Jagodno',
    listing_price: '899000 PLN',
    listing_location: 'Jagodno, Wrocław, dolnośląskie',
  },
};

const LIS = {
  original:
    'Renovated two-bedroom apartment of 85 sqm on the second floor of a 1930s building in Campo de Ourique, Lisbon. The renovation was completed in 2021 and kept the original pine floors and high ceilings. The living room has two French windows with small balconies over a tree-lined street. Equipped kitchen, one bathroom and a guest WC. The building has no lift. The Jardim da Estrela is a 7-minute walk away, and the neighbourhood has a covered market, cafes and the tram 28 terminus. Energy certificate C. Condominium fees 65 EUR per month.',
  context: {
    listing_title: '2-bedroom apartment, Campo de Ourique, Lisbon — 85 sqm',
    listing_price: '640000 EUR',
    listing_location: 'Campo de Ourique, Lisboa',
  },
};

interface Listing {
  original: string;
  context: Record<string, string>;
}

function event(
  listing: Listing,
  archetype: string,
  locale: 'en' | 'pl' | 'es',
  traits?: string[],
): DescriptionRequestedEvent {
  return {
    tenant_id: '00000000-0000-4000-8000-000000001400',
    listing_id: 'listing-1400',
    archetype,
    locale,
    copy_template: 'Warm and practical.',
    original_description: listing.original,
    listing_context: listing.context,
    cache_key: `desc:t:listing-1400:${archetype}:${locale}:m:r0`,
    listing_revision: 0,
    generation_model: 'claude-sonnet-5-5',
    ...(traits ? { traits } : {}),
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

const STUDY: [string, Listing, string, string][] = [
  ['fx.diaspora_buyer.pl', FX, 'diaspora_buyer', SONNET_FX_DIASPORA_PL],
  ['jav.second_home_buyer.pl', JAV, 'second_home_buyer', SONNET_JAV_SECOND_HOME_PL],
  ['wro.diaspora_buyer.pl', WRO, 'diaspora_buyer', SONNET_WRO_DIASPORA_PL],
  ['lis.diaspora_buyer.pl', LIS, 'diaspora_buyer', SONNET_LIS_DIASPORA_PL],
];

describe('FOLLOW-1400 — a description that steers by familial status is refused', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(STUDY)('%s: REFUSED / familial_steering, nothing cached', async (_id, l, a, body) => {
    mockCreate.mockResolvedValueOnce(reply(fit(body)));
    const report = await generateDescription(event(l, a, 'pl'));
    expect(report.outcome).toEqual({ verdict: 'REFUSED', violation: 'familial_steering' });
    expect(report.claimsValidation).toBeNull();
    expect(report.writes).toEqual({ pg: 'skipped', redis: 'skipped', audit: 'skipped' });
    // No headline is requested for a refused body.
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it.each(STUDY)(
    '%s: refused for a buyer who declared has_children too (ESC-088: every request)',
    async (_id, l, a, body) => {
      mockCreate.mockResolvedValueOnce(reply(fit(body)));
      const report = await generateDescription(event(l, a, 'pl', ['has_children']));
      expect(report.outcome).toEqual({ verdict: 'REFUSED', violation: 'familial_steering' });
    },
  );

  it('refuses even where the listing itself says it (the seller is no licence)', async () => {
    const listing: Listing = {
      original: 'Family-friendly three-bedroom house with a garden.',
      context: { listing_title: '3 bed house' },
    };
    mockCreate.mockResolvedValueOnce(
      reply(fit('A family-friendly three-bedroom house with a garden.')),
    );
    const report = await generateDescription(event(listing, 'family_buyer', 'en'));
    expect(report.outcome).toEqual({ verdict: 'REFUSED', violation: 'familial_steering' });
  });

  const ES_VILLA: Listing = {
    original: 'Villa de cuatro dormitorios con piscina privada y jardín en Jávea.',
    context: { listing_title: 'Villa con piscina, Jávea' },
  };
  const ES_BODY = 'Una villa de cuatro dormitorios en Jávea, con piscina privada y jardín.';

  it.each([
    ['en', FX, HAIKU_FX_DIASPORA_EN, 'Family-friendly three-bedroom home in Palm Coast, FL'],
    ['pl', WRO, HAIKU_WRO_DIASPORA_PL, 'Mieszkanie dla rodziny z ogródkiem na Jagodnie'],
    ['es', ES_VILLA, ES_BODY, 'Villa para familias con piscina en Jávea'],
  ] as const)(
    'a %s headline that steers is suppressed as familial_steering; the body is served',
    async (locale, l, body, headline) => {
      mockCreate.mockResolvedValueOnce(reply(fit(body))).mockResolvedValueOnce(reply(headline));
      const report = await generateDescription(event(l, 'diaspora_buyer', locale));
      expect(report.outcome.verdict).toBe('FIT');
      expect(report.headline).toBeNull();
      expect(report.headlineViolation).toBe('familial_steering');
    },
  );
});

describe('FOLLOW-1400 — controls: the vocabulary is phrases, not the word "family"', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('fx.diaspora_buyer.en (Haiku, "single-family home") is served with its headline', async () => {
    mockCreate
      .mockResolvedValueOnce(reply(fit(HAIKU_FX_DIASPORA_EN)))
      .mockResolvedValueOnce(
        reply('Three-bedroom home with screened lanai and garden in Palm Coast, FL'),
      );
    const report = await generateDescription(event(FX, 'diaspora_buyer', 'en'));
    expect(report.outcome.verdict).toBe('FIT');
    expect(report.headlineViolation).toBeNull();
  });

  it('wro.diaspora_buyer.pl (Haiku, "dorosłe dzieci, rodzice albo goście") is served', async () => {
    mockCreate
      .mockResolvedValueOnce(reply(fit(HAIKU_WRO_DIASPORA_PL)))
      .mockResolvedValueOnce(
        reply('4 pokoje z ogródkiem, 78,4 m², Wrocław Jagodno, stan deweloperski'),
      );
    const report = await generateDescription(event(WRO, 'diaspora_buyer', 'pl'));
    expect(report.outcome.verdict).toBe('FIT');
    expect(report.headlineViolation).toBeNull();
  });

  it.each([
    'A three-bedroom single-family home on a quiet residential street.',
    'Dom jednorodzinny przy cichej ulicy.',
    'Vivienda unifamiliar con jardín.',
    'To adres, który rodzina rozpozna od razu.',
    'Spokojna, rodzinna okolica z parkiem.',
    'Una dirección reconocible para la familia.',
  ])('%j is not steering under the shared vocabulary', (text) => {
    expect(steersByFamilialStatus(text)).toBe(false);
  });
});
