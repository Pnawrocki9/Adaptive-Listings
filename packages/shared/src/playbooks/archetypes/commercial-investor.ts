import type { PlaybookEntry } from '../types.js';

export const commercialInvestorPlaybook: PlaybookEntry = {
  archetype: 'commercial_investor',
  description: 'Commercial property investor (offices, retail, warehouses)',
  slots: [
    {
      slot: 'headline',
      en: 'Commercial Investment — {sqm}m² Income-Producing Asset',
      variants: {
        en: [
          'Commercial Investment — {sqm}m² Income-Producing Asset',
          'Commercial Asset — {sqm}m², Full Due Diligence Pack',
          'Office/Retail Investment — Triple Net Lease, Stable Returns',
        ],
      },
    },
    { slot: 'cta', en: 'Request Commercial Pack' },
    { slot: 'feature', en: 'Commercial Due Diligence Pack' },
  ],
  listing_rules: {
    boost_if: ['commercial_zoning', 'rental_tenant_in_place', 'triple_net_lease'],
    suppress_if: ['residential_only'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'commercial_zoning',
    'current_tenant',
    'lease_terms',
    'gross_yield',
    'cap_rate',
  ],
  signals: [
    'searches_commercial',
    'views_large_sqm',
    'clicks_zoning_info',
    'filters_commercial_type',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write institutionally, underwriting-fluent, defensible. The reader thinks in covenant strength, lease tail, reversion potential, capex profile, and exit liquidity. Lead with covenant quality where tenant data permits — name and credit profile of the occupier, lease length, indexation. Frame the property as an underwriting case: the underwrite IS the story, not the location pitch or the floorplate aesthetic. The closer positions the asset as a case to underwrite on the listing's facts; value-add levers only where the listing names them. Preferred lexicon: covenant, WAULT, reversion, underwrite, defensible, value-add, indexation, lease tail, capex profile, exit liquidity. Avoid: charming, opportunity for, character, home-like, cosy, hidden gem.

HARD RULES:
Never name specific tenants, quote WAULT in years, cite yield or cap rate figures, or claim a specific lease structure unless it is in verified_facts. "A long lease" is acceptable if the agent mentions one; "M&S anchor on 12-year FRI lease at 6.8% net initial yield" is forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz instytucjonalnie, w języku underwritingu, obronnie. Czytelnik myśli w kategoriach jakości najemcy, pozostałego okresu umowy najmu, potencjału rewersji, profilu CapEx i płynności wyjścia. Prowadź narracją jakości najemcy, jeśli są dane o najemcy — nazwa i profil kredytowy, długość umowy, indeksacja. Pokazuj nieruchomość jako sprawę pod underwriting: underwriting JEST historią, nie pitch lokalizacyjny ani estetyka lobby. Zamknięcie pozycjonuje aktywo jako sprawę do underwritingu na faktach z oferty; dźwignie value-add tylko wtedy, gdy wymienia je oferta. Słownictwo preferowane: najemca jakościowy, WAULT, rewersja, underwriting, obronny, value-add, indeksacja, pozostały okres najmu, profil CapEx, płynność wyjścia. Unikać: urokliwy, okazja, charakter, przytulny, perełka. Klasę budynku, lokalizację handlową i korytarze logistyczne opisuj tylko tak, jak podaje je oferta.

HARD RULES:
Nigdy nie wymieniaj konkretnych najemców, nie cytuj WAULT w latach, nie podawaj rentowności ani cap rate, nie twierdź o konkretnej strukturze najmu, jeśli nie ma tego w verified_facts. "Długa umowa najmu" — tak, jeśli agent o niej wspomina; "ankor M&S na 12-letnim FRI" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe en clave institucional, con fluidez de underwriting, defendible. El lector piensa en calidad de inquilino, plazo restante del contrato, potencial de reversión, perfil de capex y liquidez de salida. Lidera con calidad de inquilino si hay datos — nombre y perfil crediticio del ocupante, duración del contrato, indexación. Presenta la propiedad como caso de underwriting: el underwriting ES la historia, no el pitch de ubicación ni la estética del lobby. El cierre la posiciona como caso de underwriting sobre los hechos del anuncio; palancas value-add solo si las nombra el anuncio. Léxico preferido: covenant, WAULT, reversión, underwriting, defendible, value-add, indexación, plazo restante del contrato, perfil capex, liquidez de salida. Evitar: con encanto, oportunidad, carácter, hogareño, joya oculta. Clase de oficina, ejes comerciales y corredores logísticos, solo como los indique el anuncio.

HARD RULES:
Nunca menciones inquilinos concretos, no cites WAULT en años, no des cifras de rentabilidad ni yield, no afirmes estructura de contrato concreta salvo en verified_facts. "Contrato largo" sí, si el agente lo menciona; "ancla Mercadona en arrendamiento FRI a 12 años" prohibido sin verificación.`,
  },
};
