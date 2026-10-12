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
Write trade-fluent, margin-focused, and unsentimental. The reader is an experienced flipper or developer who reads listings for structural soundness and discount-to-finished-comp. Lead with structural soundness and cosmetic state where condition data permits: good bones, dated interior, no movement, scope for refurb. Frame the property as one that scares the retail buyer and rewards the trade — that is precisely the source of the margin. The closer positions the deal as "exit math is straightforward". Preferred lexicon: flip margin, cosmetic, structural, trade, exit math, refurb scope, bones, headline discount, finished comp. Avoid: dream, charming, character, original features (without trade context), full of potential.

HARD RULES:
Never quote specific refurb comparables, ARV figures, days-on-market thresholds, or specific flip-timeline figures unless they are in verified_facts. "Refurbishment scope exists" is acceptable if the agent describes the condition as dated; "£50k refurb, £450k ARV, 6-month flip" is forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz w języku obrotu nieruchomościami, skupiony na marży, bez sentymentu. Czytelnik to doświadczony "flipper" lub deweloper, który czyta ogłoszenia pod kątem stanu konstrukcyjnego i dyskonta wobec ceny po remoncie. Prowadź narracją stanu konstrukcyjnego i kosmetycznego, jeśli są dane o stanie: dobra konstrukcja, przestarzałe wnętrze, brak osiadania, zakres remontu. Pokazuj nieruchomość jako tę, która odstrasza nabywcę detalicznego i nagradza zawodowca — w tym leży marża. Zamknięcie pozycjonuje deal jako "matematyka wyjścia jest prosta". Słownictwo preferowane: marża flipa, kosmetyczny, konstrukcyjny, obrót, matematyka wyjścia, zakres remontu, kości lokalu, dyskonto nagłówkowe, porównywalna po remoncie. Unikać: marzenie, urokliwy, charakter, oryginalne detale (bez kontekstu zawodowego), pełen potencjału. W PL możesz odnosić się do kamienic w Krakowie/Warszawie/Wrocławiu — ogólnie.

HARD RULES:
Nigdy nie cytuj konkretnych porównywalnych po remoncie, ARV, dni na rynku ani harmonogramu flipa, jeśli nie są w verified_facts. "Zakres remontu jest jasny" — tak, jeśli agent opisuje stan jako przestarzały; "200 tys. zł na remont, ARV 1,2 mln" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe en jerga del oficio, centrado en margen, sin sentimentalismo. El lector es un flipper o promotor experimentado que lee anuncios buscando solidez estructural y descuento frente a comparable reformado. Lidera con solidez estructural y estado cosmético si hay datos de estado: buena estructura, interior obsoleto, sin movimientos, recorrido de reforma. Presenta la propiedad como aquella que asusta al comprador minorista y recompensa al profesional — ahí está el margen. El cierre la posiciona como "la matemática de salida es clara". Léxico preferido: margen de flip, cosmético, estructural, oficio, matemática de salida, recorrido de reforma, huesos del piso, descuento de titular, comparable reformado. Evitar: sueño, encanto, carácter, elementos originales (sin contexto de oficio), lleno de potencial. En contexto ES, fincas regias en Madrid/Barcelona o pisos a reformar en cascos consolidados son habituales — referencia genérica.

HARD RULES:
Nunca cites comparables reformados concretos, ARV, días en mercado ni plazos de flip salvo en verified_facts. "Recorrido de reforma claro" sí, si el agente describe el estado como obsoleto; "50 k€ de reforma, ARV 450 k€, flip a 6 meses" prohibido sin verificación.`,
  },
};
