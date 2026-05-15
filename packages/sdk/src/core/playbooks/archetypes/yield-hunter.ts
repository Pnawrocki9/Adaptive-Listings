import type { PlaybookEntry } from '../types.js';

export const yieldHunterPlaybook: PlaybookEntry = {
  archetype: 'yield_hunter',
  description: 'Long-term investor maximizing rental cashflow and ROI',
  slots: [
    {
      slot: 'headline',
      en: 'Rental Yield: {yield}% | Gross Income: {income}/yr',
      variants: {
        en: [
          'Rental Yield: {yield}% | Gross Income: {income}/yr',
          'Investment Property — {yield}% Gross Yield, Tenant in Place',
          'Passive Income: {income}/yr — Cash-Flow Positive from Day One',
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
Write analytically, numbers-first, and dismissive of lifestyle framing. Lead with cashflow language where data permits — tenant demand patterns, void risk, occupancy stability. Frame every feature in cashflow terms: a garden is outdoor amenity that supports family-tenant retention, not "a place for children to play". The closer should position the property as an income asset on a balance sheet, not a lifestyle purchase. Preferred lexicon: cashflow, yield, tenant demand, occupancy, ROI, defensible, cycle-resistant, gross/net, void risk, management overhead. Avoid: dream, perfect for, family-friendly, charming, your forever home, character. Keep sentences declarative and short; let the asset speak in financial language.

HARD RULES:
Never invent a yield percentage, occupancy percentage, ADR, or income figure unless it is supplied in verified_facts. "Attractive yield" is acceptable; "6.2% gross yield" is forbidden unless verified. Never quote a price per square metre. Never claim a tenant is in place.`,
    pl: `VOICE PATTERN:
Pisz analitycznie, liczbami, bez emocji "domu marzeń". Prowadź narracją cashflow tam, gdzie dane na to pozwalają — popyt najemców, stabilność obłożenia, ryzyko pustostanu. Każdą cechę interpretuj finansowo: ogród to udogodnienie zwiększające retencję rodzinnego najemcy, nie "miejsce dla dzieci". Zamknięcie pozycjonuj jako aktywo dochodowe w bilansie, nie zakup lifestyle'owy. Słownictwo preferowane: cashflow, rentowność, popyt najemców, obłożenie, ROI, odporność na cykl, brutto/netto, ryzyko pustostanu. Unikać: marzenie, idealny dla, rodzinny, urokliwy, wymarzony dom. Krótkie, oznajmujące zdania. W kontekście PL możesz odnosić się do realiów: najem długoterminowy, popyt najemców w Krakowie/Warszawie/Wrocławiu, presja czynszowa.

HARD RULES:
Nie wymyślaj rentowności, obłożenia, ADR ani rocznego przychodu, jeśli nie ma ich w verified_facts. "Atrakcyjna rentowność" — tak; "6,2% brutto" — zabronione bez weryfikacji. Nie cytuj ceny za m². Nie twierdź, że najemca jest na miejscu.`,
    es: `VOICE PATTERN:
Escribe de forma analítica, con lenguaje numérico y sin apelar al estilo de vida. Lidera con cashflow cuando los datos lo permitan — demanda de inquilinos, estabilidad de ocupación, riesgo de vacancia. Encuadra cada elemento en términos de rentabilidad: una terraza es un atributo que mejora la retención del inquilino, no "un lugar para disfrutar el sol". El cierre debe posicionar la propiedad como activo de renta en balance, no como compra emocional. Léxico preferido: cashflow, rentabilidad, demanda locataria, ocupación, ROI, defendible, resistente al ciclo, bruto/neto, riesgo de vacancia. Evitar: sueño, perfecto para, hogar familiar, encantador, con encanto. Frases declarativas y breves. En contexto ES puedes referirte a realidades del mercado de alquiler residencial de larga duración, presión locataria en Madrid/Barcelona/Valencia.

HARD RULES:
Nunca inventes rentabilidad, ocupación, ADR ni ingreso anual si no figuran en verified_facts. "Rentabilidad atractiva" sí; "6,2% bruto" prohibido sin verificación. No cites precio por m². No afirmes que hay inquilino en plaza.`,
  },
};
