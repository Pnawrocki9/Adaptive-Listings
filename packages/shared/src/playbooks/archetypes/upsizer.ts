import type { PlaybookEntry } from '../types.js';

export const upsizerPlaybook: PlaybookEntry = {
  archetype: 'upsizer',
  description:
    'Current homeowner trading up to more space or better location (no longer assigned by the quiz; its wording is folded into family_buyer)',
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
Write practically and quietly optimistic. The reader has outgrown their current home and is making one move that needs to last. Lead with space flexibility and headroom where rooms data permits: a spare room or study the listing lists, a room that can change purpose, a layout with capacity for the next ten years. Describe rooms and space as the listing states them, never who will occupy them: never write about children, a partner or a family structure. The closer positions the property as scope for the next decade, not the next two years. Preferred lexicon: room to grow, flexible, generously sized, scope, headroom, capacity, settled. Avoid: compact, efficient, low-maintenance, single, manageable downscale.

HARD RULES:
Never quote school ratings, secondary school names, or league-table positions unless they are in verified_facts. "Schools within easy reach" is acceptable if the location is in the agent description; "Outstanding secondary 800m away" or specific school names are forbidden unless verified. Never call an area family-friendly, safe, or suited to families, and never refer to the reader's children or household composition, even when the listing text does.`,
    pl: `VOICE PATTERN:
Pisz praktycznie, ze spokojnym optymizmem. Czytelnik wyrósł z obecnego mieszkania i robi jedną przeprowadzkę, która musi się "trzymać" przez lata. Prowadź narracją elastyczności i zapasu przestrzeni, jeśli są dane o pokojach: dodatkowy pokój lub gabinet wymieniony w ofercie, pokój, który może zmienić przeznaczenie, układ z zapasem na kolejne dziesięć lat. Opisuj pokoje i przestrzeń tak, jak podaje je oferta, nigdy to, kto w nich zamieszka: nigdy nie pisz o dzieciach, partnerze ani strukturze rodziny. Zamknięcie pozycjonuje nieruchomość jako "zapas miejsca na dekadę". Słownictwo preferowane: miejsce do rośnięcia, elastyczny, przestronny, zakres, zapas, pojemność, ustabilizowany. Unikać: kompaktowy, efektywny, niskie utrzymanie, pojedynczy.

HARD RULES:
Nigdy nie cytuj ocen szkół, nazw konkretnych szkół ponadpodstawowych ani rankingów, jeśli nie są w verified_facts. "Szkoły w zasięgu spaceru" — tak, jeśli lokalizacja jest w opisie; "LO nr X z najlepszą zdawalnością" — zabronione bez weryfikacji. Nie nazywaj okolicy przyjazną rodzinom, bezpieczną ani dla rodzin i nie odnoś się do dzieci czytelnika ani do składu jego gospodarstwa domowego, nawet jeśli robi to opis oferty.`,
    es: `VOICE PATTERN:
Escribe de forma práctica, con optimismo contenido. El lector ha superado su vivienda actual y hace una mudanza que debe durar. Lidera con flexibilidad de espacio y margen de crecimiento si los datos lo permiten: una habitación extra o un despacho que figure en el anuncio, una habitación que puede cambiar de uso, una distribución con capacidad para la próxima década. Describe las habitaciones y el espacio tal como los indica el anuncio, nunca quién los ocupará: nunca escribas sobre hijos, pareja ni estructura familiar. El cierre la posiciona como margen para los próximos diez años. Léxico preferido: espacio para crecer, flexible, amplio, alcance, margen, capacidad, asentado. Evitar: compacto, eficiente, bajo mantenimiento, justo.

HARD RULES:
Nunca cites puntuaciones de colegios, nombres de institutos ni rankings salvo en verified_facts. "Colegios a un paseo" sí, si la ubicación está en la descripción; "Instituto X con nota Y" prohibido sin verificación. Nunca llames a una zona apta para familias o segura, ni hagas referencia a los hijos del lector ni a la composición de su hogar, aunque lo haga el propio anuncio.`,
  },
};
