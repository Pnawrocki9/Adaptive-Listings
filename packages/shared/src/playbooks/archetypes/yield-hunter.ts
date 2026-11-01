import type { PlaybookEntry } from '../types.js';

export const yieldHunterPlaybook: PlaybookEntry = {
  archetype: 'yield_hunter',
  description:
    'Long-term investor maximizing rental cashflow and ROI, including experienced portfolio owners (the seasoned_investor add-on carries the portfolio voice)',
  slots: [
    {
      slot: 'headline',
      en: 'Rental Investment — Attractive Yield Profile',
      variants: {
        en: [
          'Rental Investment — Attractive Yield Profile',
          'Investment Property — Income Asset with Tenant Demand',
          'Passive Income Potential — Cash-Flow Focused Asset',
        ],
      },
    },
    { slot: 'cta', en: 'Request Investment Pack' },
    { slot: 'feature', en: 'Investment Performance' },
  ],
  listing_rules: {
    boost_if: ['has_rental_income', 'yield_data_available'],
    suppress_if: ['no_rental_allowed', 'hoa_restricts_rental'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'rental_yield',
    'gross_annual_income',
    'occupancy_rate',
    'price_per_sqm',
    'management_fees',
  ],
  signals: [
    'views_yield_data',
    'clicks_rental_calculator',
    'long_dwell_on_financials',
    'quiz:investment+long',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write analytically, numbers-first, and dismissive of lifestyle framing. Lead with cashflow language where the listing's figures permit — tenant demand patterns, void risk, occupancy stability. Frame every feature in cashflow terms: a garden is an outdoor amenity that supports lettability and retention of family tenants, a long-staying tenant segment, stated as the listing states it, not "a place to unwind". The closer should position the property as a candidate for the reader's balance sheet, not a lifestyle purchase; it produces income only where the listing says so. Preferred lexicon: cashflow, yield, tenant demand, occupancy, ROI, defensible, gross/net, void risk, management overhead. Avoid: dream, perfect for, family-friendly, charming, your forever home, character. Keep sentences declarative and short; let the asset speak in financial language.

HARD RULES:
Never invent a yield percentage, occupancy percentage, ADR, or income figure unless it is supplied in verified_facts. "Attractive yield" only if the listing says so; "6.2% gross yield" is forbidden unless verified. Never quote a price per square metre. Never claim a tenant is in place.`,
    pl: `VOICE PATTERN:
Pisz analitycznie, liczbami, bez emocji "domu marzeń". Prowadź narracją cashflow tam, gdzie pozwalają na to dane oferty — popyt najemców, stabilność obłożenia, ryzyko pustostanu. Każdą cechę interpretuj finansowo: ogród to udogodnienie zwiększające atrakcyjność najmu i retencję najemców z rodzinami, segmentu, który zostaje na dłużej, opisane tak, jak podaje je oferta, nie "miejsce do odpoczynku". Zamknięcie pozycjonuj jako kandydata do bilansu czytelnika, nie zakup lifestyle'owy; dochód podawaj tylko wtedy, gdy podaje go oferta. Słownictwo preferowane: cashflow, rentowność, popyt najemców, obłożenie, ROI, brutto/netto, ryzyko pustostanu. Unikać: marzenie, idealny dla, rodzinny, urokliwy, wymarzony dom. Krótkie, oznajmujące zdania. O najmie długoterminowym, popycie najemców i presji czynszowej pisz tylko wtedy, gdy mówi o nich oferta.

HARD RULES:
Nie wymyślaj rentowności, obłożenia, ADR ani rocznego przychodu, jeśli nie ma ich w verified_facts. "Atrakcyjna rentowność" — tylko jeśli mówi tak oferta; "6,2% brutto" — zabronione bez weryfikacji. Nie cytuj ceny za m². Nie twierdź, że najemca jest na miejscu.`,
    es: `VOICE PATTERN:
Escribe de forma analítica, con lenguaje numérico y sin apelar al estilo de vida. Lidera con cashflow cuando los datos del anuncio lo permitan — demanda de inquilinos, estabilidad de ocupación, riesgo de vacancia. Encuadra cada elemento en términos de rentabilidad: una terraza es un atributo que mejora la retención del inquilino, también de las familias inquilinas, un segmento de larga estancia, tal como la describe el anuncio, no "un lugar para disfrutar el sol". El cierre debe posicionar la propiedad como candidata para el balance del lector, no como compra emocional; la renta, solo si la indica el anuncio. Léxico preferido: cashflow, rentabilidad, demanda locataria, ocupación, ROI, defendible, bruto/neto, riesgo de vacancia. Evitar: sueño, perfecto para, hogar familiar, encantador, con encanto. Frases declarativas y breves. Del mercado de alquiler de larga duración y de la presión locataria habla solo si los menciona el anuncio.

HARD RULES:
Nunca inventes rentabilidad, ocupación, ADR ni ingreso anual si no figuran en verified_facts. "Rentabilidad atractiva" solo si lo dice el anuncio; "6,2% bruto" prohibido sin verificación. No cites precio por m². No afirmes que hay inquilino en plaza.`,
  },
};
