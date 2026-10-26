import type { PlaybookEntry } from '../types.js';

export const familyBuyerPlaybook: PlaybookEntry = {
  archetype: 'family_buyer',
  description:
    'Buyer moving up to more space, flexible rooms and outdoor areas (the copy never refers to children or household composition, with or without the has_children trait)',
  slots: [
    {
      slot: 'headline',
      en: '{bedrooms}BR Home — Room to Grow',
      variants: {
        en: [
          '{bedrooms}BR Home — Room to Grow',
          'Moving Up — {bedrooms}BR with Space to Spare',
          'Your Next Move — {bedrooms}BR with {key_feature}',
        ],
      },
    },
    {
      slot: 'cta',
      en: 'Get the Moving-Up Guide',
      pl: 'Pobierz poradnik: przeprowadzka do większego lokum',
      es: 'Descarga la guía para mudarte a algo más grande',
    },
    {
      slot: 'feature',
      en: 'Space & Layout',
      pl: 'Przestrzeń i układ',
      es: 'Espacio y distribución',
    },
  ],
  listing_rules: {
    boost_if: ['garden_or_yard', '3plus_bedrooms', 'quiet_street'],
    suppress_if: ['studio', '1_bedroom', 'commercial_area'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'bedrooms',
    'school_rating',
    'garden_size',
    'nearby_parks',
    'safety_score',
    'storage',
  ],
  signals: [
    'filters_3plus_bedrooms',
    'clicks_school_info',
    'views_garden_photos',
    'quiz:own_use+long',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write practically and warmly, and quietly optimistic. The reader is moving up: they have outgrown their current home and are making one move that needs to last. Lead with space and headroom where rooms data permits: a flexible room that can change purpose, a layout with capacity for the next ten years, storage, outdoor space, how mornings flow. Frame features around day-to-day rhythm and the sense of room to spare, not around any particular household: never write about children, a partner or a family structure. The copy describes the home, not who lives in it. The closer positions the property as scope for the next decade, not the next two years. Preferred lexicon: moving up, room to grow, headroom, flexible layout, generous storage, daily rhythm, settled, quiet street, calm. Avoid: investment, yield, ROI, cap rate, exit strategy, asset, compact, low-maintenance.

HARD RULES:
Never quote school ratings, Ofsted bands, league-table positions, or specific catchment names unless they are in verified_facts. Never call an area family-friendly, safe, or suited to families, and never refer to the reader's children or household composition, even when the listing text does. "Ofsted Outstanding" or "primary rated 9/10" is forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz praktycznie, ciepło i ze spokojnym optymizmem. Czytelnik przeprowadza się do większego mieszkania: obecne jest już za małe i robi jedną przeprowadzkę, która musi wystarczyć na lata. Prowadź narracją przestrzeni i zapasu, jeśli są dane o pokojach: elastyczny pokój, który może zmienić przeznaczenie, układ z zapasem na kolejne dziesięć lat, miejsce do przechowywania, przestrzeń na zewnątrz, rytm poranków. Cechy osadzaj w codzienności i poczuciu zapasu miejsca, nie w konkretnym typie gospodarstwa domowego: nigdy nie pisz o dzieciach, partnerze ani strukturze rodziny. Tekst opisuje dom, nie jego mieszkańców. Zamknięcie pozycjonuje nieruchomość jako zapas miejsca na dekadę. Słownictwo preferowane: zmiana na większe, miejsce do rośnięcia, zapas, elastyczny układ, przestrzeń do przechowywania, codzienny rytm, spokojny, spokojna ulica. Unikać: inwestycja, rentowność, ROI, aktywo, wyjście kapitałowe, kompaktowy, niskie utrzymanie.

HARD RULES:
Nie cytuj ocen szkół, rankingów ani nazw rejonowych podstawówek, jeśli nie są w verified_facts. Nie nazywaj okolicy przyjazną rodzinom, bezpieczną ani dla rodzin i nie odnoś się do dzieci czytelnika ani do składu jego gospodarstwa domowego, nawet jeśli robi to opis oferty. "SP nr 31 z najlepszymi wynikami w rejonie" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe de forma práctica, cálida y con optimismo contenido. El lector da un paso a una vivienda mayor: se le ha quedado pequeña la actual y hace una mudanza que debe durar. Lidera con espacio y margen si los datos de habitaciones lo permiten: una habitación flexible que puede cambiar de uso, una distribución con capacidad para la próxima década, almacenamiento, espacio exterior, cómo se organizan las mañanas. Enmarca los elementos en el ritmo diario y la sensación de espacio de sobra, no en un tipo de hogar concreto: nunca escribas sobre hijos, pareja ni estructura familiar. El texto describe la vivienda, no a quién vive en ella. El cierre posiciona la vivienda como margen para los próximos diez años. Léxico preferido: dar el salto, espacio para crecer, margen, distribución flexible, almacenamiento amplio, ritmo diario, asentado, calle tranquila. Evitar: inversión, rentabilidad, ROI, activo, salida, compacto, bajo mantenimiento.

HARD RULES:
Nunca cites puntuaciones de colegios, rankings ni nombres de centros escolares concretos a menos que figuren en verified_facts. Nunca llames a una zona apta para familias o segura, ni hagas referencia a los hijos del lector ni a la composición de su hogar, aunque lo haga el propio anuncio. "Colegio X con nota 9" prohibido sin verificación.`,
  },
};
