import type { PlaybookEntry } from '../types.js';

export const familyBuyerPlaybook: PlaybookEntry = {
  archetype: 'family_buyer',
  description:
    'Family moving up to more space: bedrooms, flexible rooms, outdoor areas, and schools or parks where the listing names them (the has_children trait adds emphasis on children)',
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
Write warmly, practically, and grounded in everyday family life. The reader is moving up for their family: they have outgrown their current home and are making one move that needs to last. Lead with how the layout suits a family, as the listing describes it: enough bedrooms for a room each where the bedroom count allows, a flexible room that can become a study or a playroom, where homework gets done, storage, how mornings flow. Frame features around the family's day-to-day rhythm: mornings before school, weekends in the garden or on the terrace where the listing has one, growth phases as children become teenagers. Mention schools, nurseries, parks or playgrounds only where the listing names them; when it names none, leave them out entirely (do not point out that they are missing), and call the area safe or family-friendly only if the listing does. The closer positions the home as one a family grows into, not out of in three years. Preferred lexicon: family home, room to grow, a room each, daily rhythm, generous storage, flexible layout, settled, calm. Avoid: investment, yield, ROI, cap rate, exit strategy, asset, compact, low-maintenance. Picture a parent reading this on their phone after the school run; that's the register.

HARD RULES:
Never invent a school, nursery, playground, park, catchment, distance or safety claim: name one only where it is in original_description or listing_context. Never quote school ratings, Ofsted bands, league-table positions, or catchment names unless they are in verified_facts. "Close to schools" is acceptable only when the listing itself says so; "Ofsted Outstanding" or "primary rated 9/10" is forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz ciepło, praktycznie, w rytmie codziennego życia rodziny. Czytelnik przeprowadza się z rodziną do większego mieszkania: obecne jest już za małe i robi jedną przeprowadzkę, która musi wystarczyć na lata. Prowadź narracją układu, tak jak opisuje go oferta: liczba sypialni pozwalająca na osobny pokój dla każdego dziecka, jeśli na to pozwala, elastyczny pokój na gabinet albo pokój do zabawy, miejsce do odrabiania lekcji, przestrzeń do przechowywania, jak wyglądają poranki. Każdą cechę osadzaj w codzienności rodziny: poranki przed szkołą, weekendy w ogrodzie lub na tarasie, jeśli oferta je ma, kolejne etapy dorastania dzieci. Szkoły, przedszkola, parki i place zabaw wymieniaj tylko wtedy, gdy wymienia je oferta; gdy oferta żadnych nie wymienia, pomiń ten temat całkiem (nie pisz, że ich brakuje), a okolicę nazywaj bezpieczną lub przyjazną rodzinom tylko wtedy, gdy robi to oferta. Zamknięcie pozycjonuje dom jako miejsce, w które rodzina wrasta, a nie z którego "wyrośnie" za trzy lata. Słownictwo preferowane: dom dla rodziny, miejsce do rośnięcia, pokój dla każdego, codzienny rytm, przestrzeń do przechowywania, elastyczny układ, spokój. Unikać: inwestycja, rentowność, ROI, aktywo, wyjście kapitałowe, kompaktowy, niskie utrzymanie.

HARD RULES:
Nigdy nie wymyślaj szkoły, przedszkola, placu zabaw, parku, rejonu szkolnego, odległości ani bezpieczeństwa okolicy: wymieniaj je tylko wtedy, gdy są w original_description lub listing_context. Nie cytuj ocen szkół, rankingów ani nazw rejonowych podstawówek, jeśli nie są w verified_facts. "Szkoły w pobliżu" — tylko jeśli mówi o tym sama oferta; "SP nr 31 z najlepszymi wynikami w rejonie" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe con calidez, sentido práctico y anclado en la vida cotidiana familiar. El lector da el salto a una vivienda mayor con su familia: se le ha quedado pequeña la actual y hace una mudanza que debe durar. Lidera con cómo la distribución funciona para una familia, tal como la describe el anuncio: dormitorios suficientes para una habitación para cada hijo si el número lo permite, una habitación flexible que puede ser despacho o cuarto de juegos, dónde se hacen los deberes, almacenamiento, cómo se organizan las mañanas. Enmarca cada elemento en el ritmo diario de la familia: mañanas antes del colegio, fines de semana en el jardín o la terraza si el anuncio los tiene, etapas de crecimiento de los hijos. Menciona colegios, guarderías, parques o zonas infantiles solo si el anuncio los nombra; si no nombra ninguno, omite el tema por completo (no señales que faltan), y llama a la zona segura o familiar solo si lo hace el anuncio. El cierre posiciona la vivienda como un hogar en el que una familia crece, no del que se sale a los tres años. Léxico preferido: hogar familiar, espacio para crecer, una habitación para cada uno, ritmo diario, almacenamiento amplio, distribución flexible, asentado, tranquilo. Evitar: inversión, rentabilidad, ROI, activo, salida, compacto, bajo mantenimiento.

HARD RULES:
Nunca inventes un colegio, una guardería, una zona infantil, un parque, una zona escolar, una distancia ni la seguridad de la zona: nómbralos solo si figuran en original_description o listing_context. Nunca cites puntuaciones de colegios, rankings ni nombres de centros escolares concretos a menos que figuren en verified_facts. "Colegios cerca" sí, solo si lo dice el propio anuncio; "Colegio X con nota 9" prohibido sin verificación.`,
  },
};
