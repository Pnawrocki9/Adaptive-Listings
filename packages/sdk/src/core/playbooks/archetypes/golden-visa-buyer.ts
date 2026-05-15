import type { PlaybookEntry } from '../types.js';

export const goldenVisaBuyerPlaybook: PlaybookEntry = {
  archetype: 'golden_visa_buyer',
  description:
    'High-net-worth buyer seeking residency/citizenship via real estate investment (CY, ES)',
  slots: [
    {
      slot: 'headline',
      en: 'Golden Visa Eligible — Investment from €{threshold}',
      variants: {
        en: [
          'Golden Visa Eligible — Investment from €{threshold}',
          'Residency by Investment — Qualify from €{threshold}',
          'Golden Visa Property — Premium Development, Fast Track Residency',
        ],
      },
    },
    { slot: 'cta', en: 'Download Golden Visa Guide' },
    { slot: 'feature', en: 'Residency Requirements' },
  ],
  listing_rules: {
    boost_if: ['golden_visa_eligible', 'price_above_250k_eur', 'new_development'],
    suppress_if: ['price_below_threshold'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'golden_visa_eligibility',
    'price',
    'new_development',
    'developer_reputation',
    'completion_date',
  ],
  signals: [
    'filters_price_high',
    'views_new_developments',
    'searches_visa_terms',
    'international_ip',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write programme-aware, compliant, and quietly defensible. The reader is buying real estate as the structured vehicle for a residency or citizenship outcome, and cares about documentation, defensibility under scrutiny, and the cleanest path the regulation allows. Lead with programme fit where price and location data jointly support eligibility; if either is missing, frame as "may be eligible" rather than asserting. Frame the property as the cleanest, most defensible path the programme permits. The closer positions the purchase as capital preserved in real estate rather than parked in a fund. Preferred lexicon: programme-eligible, documented, defensible, qualifying, genuine residential, registered, KW/registry-clean, lawful, scrutinised. Avoid: loophole, easy, fast-track, guaranteed approval, workaround, shortcut.

HARD RULES:
Never name a specific programme (Spain Investor Visa, Portugal Golden Visa, Greece Golden Visa) unless it is in verified_facts. Never quote a specific investment threshold figure. Never promise approval timelines. "Eligible for residency-by-investment programmes" is acceptable if price and country generally support it.`,
    pl: `VOICE PATTERN:
Pisz w języku programów, zgodnie, z cichą obronnością. Czytelnik kupuje nieruchomość jako uporządkowany wehikuł dla wyniku rezydencji lub obywatelstwa, dba o dokumentację, obronność pod kontrolą i najczystszą ścieżkę dozwoloną przez regulator. Prowadź narracją dopasowania do programu, jeśli cena i lokalizacja wspólnie sugerują kwalifikowalność; jeśli któreś brakuje, używaj "może być kwalifikowane" zamiast twierdzenia. Pokazuj nieruchomość jako najczystszą, najlepiej obronną ścieżkę dopuszczalną przez program. Zamknięcie pozycjonuje zakup jako kapitał zachowany w nieruchomości, nie zaparkowany w funduszu. Słownictwo preferowane: kwalifikujący się do programu, udokumentowany, obronny, kwalifikujący, prawdziwie mieszkalny, czysta księga wieczysta, zgodny z prawem, pod nadzorem. Unikać: luka, łatwy, szybka ścieżka, gwarantowana zgoda, obejście. W PL: programy "Golden Visa" nie są standardem; ten archetyp jest rzadko trafiony w PL — pisz ostrożnie.

HARD RULES:
Nigdy nie wymieniaj konkretnego programu (Spain Investor Visa, Portugalska Golden Visa, Grecka Golden Visa), jeśli nie ma go w verified_facts. Nigdy nie cytuj konkretnego progu inwestycji. Nie obiecuj terminów akceptacji. "Może kwalifikować się do programów rezydencji za inwestycję" — tak, jeśli cena i kraj to ogólnie wspierają.`,
    es: `VOICE PATTERN:
Escribe con conciencia regulatoria, en clave de cumplimiento y defendibilidad sosegada. El lector compra inmueble como vehículo estructurado para una residencia o ciudadanía, y le importa la documentación, la defendibilidad ante escrutinio y la vía más limpia que la norma permite. IMPORTANTE en ES: la Golden Visa fue derogada en 2024 — no presupongas su disponibilidad. Reencuadra hacia Visado No Lucrativo o Visado para Nómadas Digitales si el perfil financiero del comprador lo justifica. Lidera con encaje de programa solo si verified_facts lo respalda; en caso contrario habla en términos genéricos de "residencia por solvencia". El cierre posiciona la compra como capital preservado en inmueble, no aparcado en fondo. Léxico preferido: elegible al programa, documentado, defendible, residencial genuino, registrado, legal, supervisado, escrutado. Evitar: laguna, fácil, vía rápida, aprobación garantizada, atajo. Recuerda que la NLV exige no ejercer actividad económica en España y la DNV exige relación laboral fuera; nunca afirmes elegibilidad sin verified_facts.

HARD RULES:
Nunca menciones la Golden Visa española como si siguiera vigente (fue derogada en 2024). Nunca cites umbrales de inversión concretos. Nunca prometas plazos de aprobación. "Compatible con vías de residencia por solvencia o nómada digital" sí, si el contexto general lo respalda; afirmaciones específicas de elegibilidad prohibidas sin verificación.`,
  },
};
