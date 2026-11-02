import type { PlaybookEntry } from '../types.js';

export const goldenVisaBuyerPlaybook: PlaybookEntry = {
  archetype: 'golden_visa_buyer',
  description:
    'High-net-worth buyer seeking residency/citizenship via real estate investment (CY, ES)',
  slots: [
    {
      slot: 'headline',
      en: 'Golden Visa Eligible — Residency by Investment',
      variants: {
        en: [
          'Golden Visa Eligible — Residency by Investment',
          'Residency by Investment — Programme Guidance Included',
          'Golden Visa Property — Premium Development, Fast Track Residency',
        ],
      },
    },
    { slot: 'cta', en: 'Ask the Agent About Residency' },
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
Write programme-aware, compliant, and quietly defensible. The reader is buying real estate as the structured vehicle for a residency or citizenship outcome, and cares about documentation, defensibility under scrutiny, and the cleanest path the regulation allows. Lead with programme fit only where the listing itself states it; otherwise lead with the documentation the listing gives and state no eligibility, not even "may be eligible". Frame the property through what the listing documents, for a reader who will check eligibility themselves. The closer positions the purchase as the reader's choice of real estate over a fund. Preferred lexicon: documented, defensible, genuine residential, registered, KW/registry-clean, lawful, scrutinised. Avoid: loophole, easy, fast-track, guaranteed approval, workaround, shortcut.

HARD RULES:
Never name a specific programme (Spain Investor Visa, Portugal Golden Visa, Greece Golden Visa) unless it is in verified_facts. Never quote a specific investment threshold figure. Never promise approval timelines. Say "eligible" or name residency by investment only if the listing does.`,
    pl: `VOICE PATTERN:
Pisz w języku programów, zgodnie, z cichą obronnością. Czytelnik kupuje nieruchomość jako uporządkowany wehikuł dla wyniku rezydencji lub obywatelstwa, dba o dokumentację, obronność pod kontrolą i najczystszą ścieżkę dozwoloną przez regulator. Prowadź narracją dopasowania do programu tylko wtedy, gdy podaje je sama oferta; w przeciwnym razie prowadź dokumentacją, którą podaje oferta, i nie twierdź o kwalifikowalności, nawet jako "może być kwalifikowane". Pokazuj nieruchomość przez to, co oferta dokumentuje, czytelnikowi, który kwalifikowalność sprawdzi sam. Zamknięcie pozycjonuje zakup jako wybór czytelnika: nieruchomość zamiast funduszu. Słownictwo preferowane: udokumentowany, obronny, prawdziwie mieszkalny, czysta księga wieczysta, zgodny z prawem, pod nadzorem. Unikać: luka, łatwy, szybka ścieżka, gwarantowana zgoda, obejście. W PL: programy "Golden Visa" nie są standardem; ten archetyp jest rzadko trafiony w PL — pisz ostrożnie.

HARD RULES:
Nigdy nie wymieniaj konkretnego programu (Spain Investor Visa, Portugalska Golden Visa, Grecka Golden Visa), jeśli nie ma go w verified_facts. Nigdy nie cytuj konkretnego progu inwestycji. Nie obiecuj terminów akceptacji. O kwalifikowalności i rezydencji za inwestycję pisz tylko wtedy, gdy mówi o nich oferta.`,
    es: `VOICE PATTERN:
Escribe con conciencia regulatoria, en clave de cumplimiento y defendibilidad sosegada. El lector compra inmueble como vehículo estructurado para una residencia o ciudadanía, y le importa la documentación, la defendibilidad ante escrutinio y la vía más limpia que la norma permite. IMPORTANTE en ES: la Golden Visa fue derogada en 2024 — no presupongas su disponibilidad. Menciona un visado o programa solo si lo nombra el anuncio. Lidera con encaje de programa solo si verified_facts lo respalda; en caso contrario lidera con la documentación que indica el anuncio, sin hablar de residencia. El cierre posiciona la compra como elección del lector: inmueble en lugar de fondo. Léxico preferido: documentado, defendible, residencial genuino, registrado, legal, supervisado, escrutado. Evitar: laguna, fácil, vía rápida, aprobación garantizada, atajo. Nunca afirmes elegibilidad sin verified_facts.

HARD RULES:
Nunca menciones la Golden Visa española como si siguiera vigente (fue derogada en 2024). Nunca cites umbrales de inversión concretos. Nunca prometas plazos de aprobación. De vías de residencia por solvencia o nómada digital habla solo si las menciona el anuncio; afirmaciones específicas de elegibilidad prohibidas sin verificación.`,
  },
};
