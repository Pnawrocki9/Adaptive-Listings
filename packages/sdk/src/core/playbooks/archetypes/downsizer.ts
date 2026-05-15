import type { PlaybookEntry } from '../types.js';

export const downsizerPlaybook: PlaybookEntry = {
  archetype: 'downsizer',
  description: 'Senior or empty-nester moving to smaller, more manageable property',
  slots: [
    {
      slot: 'headline',
      en: 'Easy Living — {bedrooms}BR with Lift & No Garden Maintenance',
      variants: {
        en: [
          'Easy Living — {bedrooms}BR with Lift & No Garden Maintenance',
          'Right-Size Your Life — {bedrooms}BR, Low Maintenance, Lift Access',
          'Managed Living — {bedrooms}BR, No Garden Hassle, All Inclusive',
        ],
      },
    },
    { slot: 'cta', en: 'Book a Viewing' },
    { slot: 'feature', en: 'Downsizer Friendly' },
  ],
  listing_rules: {
    boost_if: ['lift_available', 'low_maintenance', 'ground_floor_or_lift', 'accessible'],
    suppress_if: ['large_garden', 'steep_access', 'multi_story_no_lift'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'accessibility',
    'lift',
    'maintenance_costs',
    'heating_efficiency',
    'proximity_to_amenities',
  ],
  signals: [
    'filters_sqm_low',
    'views_accessible_listings',
    'quiz:own_use+long',
    'clicks_accessibility_info',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write with dignity, practicality, and calm. The reader is at a life stage where simplicity is a value, not a compromise. Lead with right-sizing framing — single-level features, lift access, manageable maintenance — where layout data exists. Frame the home as the next chapter, not the one the reader has outgrown. The closer should position the move as freeing up time, capital and head-space, not as "downsizing your dreams". Preferred lexicon: right-sized, manageable, single-level, dignified, calm, predictable, low-maintenance, level access. Avoid: investment, scale, portfolio, family-sized, ambition, room to grow, expansive. Treat the reader as someone in their 60s who has done this before in other forms.

HARD RULES:
Never quote specific service charge figures, ground rent, or EPC ratings unless they are in verified_facts. "Efficient heating" or "predictable running costs" are acceptable; "EPC B rated, £180/month service charge" is forbidden unless explicitly verified.`,
    pl: `VOICE PATTERN:
Pisz z godnością, praktycznością i spokojem. Czytelnik wchodzi w etap, gdzie prostota jest wartością, a nie kompromisem. Prowadź narracją "right-sizing" — jednopoziomowy układ, winda, łatwa obsługa — jeśli są dane o układzie. Pokazuj nieruchomość jako kolejny rozdział, nie ten, z którego się wyrasta. Zamknięcie pozycjonuje przeprowadzkę jako uwolnienie czasu, kapitału i głowy, nie jako "rezygnację z marzeń". Słownictwo preferowane: właściwie dobrana wielkość, do ogarnięcia, jeden poziom, godna, spokojna, przewidywalny, niskie utrzymanie, dostępne. Unikać: inwestycja, skala, portfel, rodzinna wielkość, ambicja, miejsce do rośnięcia. W PL możesz odnosić się ogólnie do mieszkań w cichszych dzielnicach, blisko komunikacji i podstawowych usług.

HARD RULES:
Nigdy nie cytuj konkretnych kosztów eksploatacyjnych, czynszu administracyjnego ani klasy energetycznej, jeśli nie ma ich w verified_facts. "Efektywne ogrzewanie" lub "przewidywalne koszty utrzymania" — tak; "klasa energetyczna B, 380 zł/mies. czynszu administracyjnego" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe con dignidad, sentido práctico y calma. El lector está en una etapa donde la simplicidad es un valor, no una renuncia. Lidera con encuadre de "tamaño adecuado" — vivienda en una planta, ascensor, mantenimiento manejable — si hay datos de distribución. Presenta la vivienda como el próximo capítulo, no aquel del que se ha salido. El cierre posiciona la mudanza como liberación de tiempo, capital y carga mental, no como "renuncia a sueños". Léxico preferido: dimensión adecuada, manejable, en una planta, digno, sereno, predecible, bajo mantenimiento, accesible. Evitar: inversión, escala, cartera, dimensión familiar, ambición, espacio para crecer. En contexto ES la oferta de pisos accesibles con ascensor en zonas urbanas tranquilas es relevante — referencia genérica.

HARD RULES:
Nunca cites cifras concretas de comunidad, IBI ni certificación energética salvo en verified_facts. "Calefacción eficiente" o "costes de comunidad predecibles" sí; "certificación B, 180 €/mes de comunidad" prohibido sin verificación.`,
  },
};
