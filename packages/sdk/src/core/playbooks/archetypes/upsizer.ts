import type { PlaybookEntry } from '../types.js';

export const upsizerPlaybook: PlaybookEntry = {
  archetype: 'upsizer',
  description: 'Current homeowner trading up to more space or better location',
  slots: [
    {
      slot: 'headline',
      en: 'Upsize to {bedrooms}BR — {key_feature}',
      variants: {
        en: [
          'Upsize to {bedrooms}BR — {key_feature}',
          'More Space, Better Location — {bedrooms}BR with {key_feature}',
          'Your Next Move — Spacious {bedrooms}BR Home, Ready to Upgrade',
        ],
      },
    },
    { slot: 'cta', en: 'Compare Properties' },
    { slot: 'feature', en: 'Why Upgrade?' },
  ],
  listing_rules: {
    boost_if: ['larger_than_area_avg', 'premium_finish', 'good_location_score'],
    suppress_if: ['small_sqm', 'studio'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: ['sqm', 'bedrooms', 'location_score', 'finish_quality', 'garden', 'garage'],
  signals: [
    'filters_sqm_high',
    'views_4plus_bedrooms',
    'quiz:own_use+medium',
    'compares_multiple_large_listings',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write practically, family-aware, and quietly optimistic. The reader has outgrown their current home and is making one move that needs to last. Lead with space flexibility and growth headroom where rooms data permits: a room that becomes the second child's bedroom, a study that becomes a teenager's space, a layout with capacity for the next ten years. Frame the home as the one where the next child has their own room, where weekends can host extended family. The closer positions the property as scope for the next decade, not the next two years. Preferred lexicon: room to grow, flexible, family-sized, scope, headroom, capacity, settled. Avoid: compact, efficient, low-maintenance, single, manageable downscale.

HARD RULES:
Never quote school ratings, secondary school names, or league-table positions unless they are in verified_facts. "Schools within easy reach" is acceptable if the location is in the agent description; "Outstanding secondary 800m away" or specific school names are forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz praktycznie, ze świadomością rodziny, ze spokojnym optymizmem. Czytelnik wyrósł z obecnego mieszkania i robi jedną przeprowadzkę, która musi się "trzymać" przez lata. Prowadź narracją elastyczności i zapasu przestrzeni, jeśli są dane o pokojach: pokój, który stanie się sypialnią drugiego dziecka, gabinet, który stanie się przestrzenią dla nastolatka, układ z zapasem na kolejne dziesięć lat. Pokazuj dom jako miejsce, gdzie kolejne dziecko ma swój pokój, gdzie weekendy goszczą bliską rodzinę. Zamknięcie pozycjonuje nieruchomość jako "zapas miejsca na dekadę". Słownictwo preferowane: miejsce do rośnięcia, elastyczny, rodzinnej wielkości, zakres, zapas, pojemność, ustabilizowany. Unikać: kompaktowy, efektywny, niskie utrzymanie, pojedynczy. W PL możesz odnosić się ogólnie do dzielnic dobrze ocenianych przez rodziny — bez nazw szkół.

HARD RULES:
Nigdy nie cytuj ocen szkół, nazw konkretnych szkół ponadpodstawowych ani rankingów, jeśli nie są w verified_facts. "Szkoły w zasięgu spaceru" — tak, jeśli lokalizacja jest w opisie; "LO nr X z najlepszą zdawalnością" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe de forma práctica, con conciencia familiar, optimismo contenido. El lector ha superado su vivienda actual y hace una mudanza que debe durar. Lidera con flexibilidad de espacio y margen de crecimiento si los datos lo permiten: una habitación que se convertirá en el cuarto del segundo hijo, un despacho que será espacio adolescente, una distribución con capacidad para la próxima década. Presenta la vivienda como aquella donde el próximo hijo tiene su propia habitación, donde los fines de semana acogen a la familia extendida. El cierre la posiciona como margen para los próximos diez años. Léxico preferido: espacio para crecer, flexible, dimensión familiar, alcance, margen, capacidad, asentado. Evitar: compacto, eficiente, bajo mantenimiento, justo. En contexto ES referencia genérica a zonas residenciales bien valoradas por familias.

HARD RULES:
Nunca cites puntuaciones de colegios, nombres de institutos ni rankings salvo en verified_facts. "Colegios a un paseo" sí, si la ubicación está en la descripción; "Instituto X con nota Y" prohibido sin verificación.`,
  },
};
