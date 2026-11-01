import type { PlaybookEntry } from '../types.js';

export const flipInvestorPlaybook: PlaybookEntry = {
  archetype: 'flip_investor',
  description: 'Fix & flip investor seeking below-market properties with upside potential',
  slots: [
    {
      slot: 'headline',
      en: 'Below Market Value — Renovation Opportunity',
      variants: {
        en: [
          'Below Market Value — Renovation Opportunity',
          'Motivated Seller — Below Market, Full Renovation Potential',
          'Fix & Flip Candidate — Full Renovation Scope',
        ],
      },
    },
    { slot: 'cta', en: 'Get Renovation Report' },
    { slot: 'feature', en: 'Renovation Scope' },
  ],
  listing_rules: {
    boost_if: ['price_below_area_median', 'needs_renovation', 'motivated_seller'],
    suppress_if: ['premium_finished', 'price_above_median'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'price_vs_market',
    'condition',
    'renovation_estimate',
    'arv_estimate',
    'days_on_market',
  ],
  signals: [
    'filters_by_price_low',
    'views_older_listings',
    'quiz:investment+short',
    'clicks_price_history',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write trade-fluent, margin-focused, and unsentimental. The reader is an experienced flipper or developer who reads listings for structural soundness and discount-to-finished-comp. Lead with structural soundness and cosmetic state where condition data permits: good bones, dated interior, no movement, scope for refurb. Frame the property by what the trade reads differently from a retail buyer; state no margin the listing does not state. The closer leaves the exit math to the reader, on the listing's figures. Preferred lexicon: flip margin, cosmetic, structural, trade, exit math, refurb scope, bones, finished comp. Avoid: dream, charming, character, original features (without trade context), full of potential.

HARD RULES:
Never quote specific refurb comparables, ARV figures, days-on-market thresholds, or specific flip-timeline figures unless they are in verified_facts. "Refurbishment scope exists" is acceptable if the agent describes the condition as dated; "£50k refurb, £450k ARV, 6-month flip" is forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz w języku obrotu nieruchomościami, skupiony na marży, bez sentymentu. Czytelnik to doświadczony "flipper" lub deweloper, który czyta ogłoszenia pod kątem stanu konstrukcyjnego i dyskonta wobec ceny po remoncie. Prowadź narracją stanu konstrukcyjnego i kosmetycznego, jeśli są dane o stanie: dobra konstrukcja, przestarzałe wnętrze, brak osiadania, zakres remontu. Pokazuj nieruchomość przez to, co zawodowiec czyta inaczej niż nabywca detaliczny; nie podawaj marży, której nie podaje oferta. Zamknięcie zostawia czytelnikowi rachunek ze sprzedaży, na liczbach z oferty. Słownictwo preferowane: marża flipa, kosmetyczny, konstrukcyjny, obrót, rachunek ze sprzedaży, zakres remontu, stan konstrukcji, porównywalna po remoncie. Unikać: marzenie, urokliwy, charakter, oryginalne detale (bez kontekstu zawodowego), pełen potencjału. Kamienice wymieniaj tylko wtedy, gdy wymienia je oferta.

HARD RULES:
Nigdy nie cytuj konkretnych porównywalnych po remoncie, ARV, dni na rynku ani harmonogramu flipa, jeśli nie są w verified_facts. "Zakres remontu jest jasny" — tak, jeśli agent opisuje stan jako przestarzały; "200 tys. zł na remont, ARV 1,2 mln" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe en jerga del oficio, centrado en margen, sin sentimentalismo. El lector es un flipper o promotor experimentado que lee anuncios buscando solidez estructural y descuento frente a comparable reformado. Lidera con solidez estructural y estado cosmético si hay datos de estado: buena estructura, interior obsoleto, sin movimientos, alcance de la reforma. Presenta la propiedad por lo que el profesional lee distinto del comprador minorista; no afirmes un margen que el anuncio no indique. El cierre deja al lector las cuentas de la venta, con las cifras del anuncio. Léxico preferido: margen de flip, cosmético, estructural, oficio, cuentas de la venta, alcance de la reforma, estructura del piso, comparable reformado. Evitar: sueño, encanto, carácter, elementos originales (sin contexto de oficio), lleno de potencial. Fincas regias o pisos a reformar en cascos consolidados, solo si los menciona el anuncio.

HARD RULES:
Nunca cites comparables reformados concretos, ARV, días en mercado ni plazos de flip salvo en verified_facts. "Alcance de la reforma claro" sí, si el agente describe el estado como obsoleto; "50 k€ de reforma, ARV 450 k€, flip a 6 meses" prohibido sin verificación.`,
  },
};
