import type { PlaybookEntry } from '../types.js';

export const firstTimeBuyerPlaybook: PlaybookEntry = {
  archetype: 'first_time_buyer',
  description: 'First-time buyer navigating mortgage, budget, and unfamiliar process',
  slots: [
    {
      slot: 'headline',
      en: 'Your First Home — Clear Guidance from Offer to Keys',
      variants: {
        en: [
          'Your First Home — Clear Guidance from Offer to Keys',
          'Your First Home — Mortgage-Ready, Move-In Condition',
          'Step on the Ladder — First-Time Buyer Schemes Available',
        ],
      },
    },
    { slot: 'cta', en: 'Ask the Agent About Buying Your First Home' },
    { slot: 'feature', en: 'Your First Step' },
  ],
  listing_rules: {
    boost_if: ['starter_home', 'price_below_area_median', 'move_in_ready', 'ftb_scheme_eligible'],
    suppress_if: ['renovation_needed', 'price_above_median'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'monthly_mortgage_estimate',
    'ftb_scheme_eligible',
    'condition',
    'total_costs',
    'school_proximity',
  ],
  signals: [
    'views_mortgage_calculator',
    'clicks_ftb_content',
    'price_filters_low',
    'quiz:own_use+long',
    'long_dwell_on_financing',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write encouragingly, honestly, and with a reassuring tone — the reader is doing this for the first time and is anxious about complexity. Lead with affordability framing on the price the listing states: a next step the reader can plan for; call it within reach only if the listing does. Frame the home as a foot in the door, a manageable next step from renting, not a trophy. The closer should be human: a place you'll be happy to wake up in, not "an asset that compounds". Preferred lexicon: manageable, predictable, foot in the door, planable, achievable, no surprises, clear costs. Avoid: trophy, prestige, investment-grade, luxury, exclusive, premium tier. Treat the reader as smart but new to the process.

HARD RULES:
Never name specific first-time-buyer schemes (Help to Buy, Lifetime ISA, First Homes, Pierwsze Mieszkanie) unless they appear in the agent description. Never quote a mortgage rate or monthly payment figure. "Affordable for first-time buyers" only if the listing says so; specific scheme eligibility claims are forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz zachęcająco, uczciwie i uspokajająco — czytelnik kupuje pierwsze mieszkanie i obawia się skomplikowanej procedury. Prowadź narracją dostępności na cenie, którą podaje oferta: następny krok, który czytelnik może zaplanować; "w zasięgu" pisz tylko wtedy, gdy mówi tak oferta. Pokazuj mieszkanie jako pierwszy krok od najmu do własności, nie nagrodę życia. Zamknięcie ma być ludzkie: "miejsce, w którym chce się budzić", nie "aktywo procentujące". Słownictwo preferowane: do ogarnięcia, przewidywalny, pierwszy krok, planowalny, bez niespodzianek, jasne koszty. Unikać: nagroda, prestiż, klasa premium, inwestycja, luksus. Traktuj czytelnika jak inteligentnego, ale nowego w temacie. O wsparciu dla młodych i programach pierwszego mieszkania pisz tylko wtedy, gdy mówi o nich oferta.

HARD RULES:
Nigdy nie wymieniaj konkretnych nazw programów (Bezpieczny Kredyt 2%, Pierwsze Mieszkanie, Mieszkanie na Start), jeśli nie ma ich w opisie agenta. Nie cytuj oprocentowania kredytu ani raty miesięcznej. "Cena w zasięgu pierwszego nabywcy" — tylko jeśli mówi tak oferta; konkretna kwalifikowalność do programu — zabroniona bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe con tono alentador, honesto y tranquilizador — el lector compra por primera vez y le preocupa la complejidad. Lidera con accesibilidad sobre el precio que indica el anuncio: un siguiente paso que el lector puede planificar; "al alcance" solo si lo dice el anuncio. Presenta la vivienda como un pie en la escalera, un paso manejable desde el alquiler, no un trofeo. El cierre debe ser humano: "un lugar donde te alegrará despertar", no "un activo que compone interés". Léxico preferido: manejable, predecible, primer paso, planificable, alcanzable, sin sorpresas, costes claros. Evitar: trofeo, prestigio, premium, exclusivo, inversión. Trata al lector como inteligente pero nuevo en el proceso. De ayudas a la compra o avales habla solo si los menciona el anuncio.

HARD RULES:
Nunca menciones programas específicos (avales ICO, ayudas autonómicas concretas) si no aparecen en la descripción del agente. No cites tipos de interés ni cuotas mensuales. "Asequible para una primera compra" solo si lo dice el anuncio; elegibilidad concreta a un programa, prohibida sin verificación.`,
  },
};
