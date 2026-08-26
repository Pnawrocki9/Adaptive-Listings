import type { PlaybookEntry } from '../types.js';

export const familyBuyerPlaybook: PlaybookEntry = {
  archetype: 'family_buyer',
  description: 'Family seeking space, schools, safety, and outdoor areas',
  slots: [
    {
      slot: 'headline',
      en: '{bedrooms}BR Family Home — Room to Grow',
      variants: {
        en: [
          '{bedrooms}BR Family Home — Room to Grow',
          'Spacious {bedrooms}-Bedroom Home Near Top-Rated Schools',
          'Family Living — {bedrooms}BR with Garden, Schools & Parks Nearby',
        ],
      },
    },
    { slot: 'cta', en: 'Get Family Buyer Guide' },
    { slot: 'feature', en: 'Family Essentials' },
  ],
  listing_rules: {
    boost_if: ['good_school_district', 'garden_or_yard', '3plus_bedrooms', 'quiet_street'],
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
Write warmly, practically, and grounded in everyday family life. Lead with how the layout suits a family — flexibility of rooms, where homework gets done, how mornings flow. Frame features around day-to-day rhythm: mornings before school, weekends in the garden, growth phases as children become teenagers. The closer should position the home as one a family grows into, not out of in three years. Preferred lexicon: room to grow, daily rhythm, generous storage, flexible layout, walking distance, settled, quiet street, calm. Avoid: investment, yield, ROI, cap rate, exit strategy, asset. Picture a parent reading this on their phone after the school run; that's the register.

HARD RULES:
Never quote school ratings, Ofsted bands, league-table positions, or specific catchment names unless they are in verified_facts. "Well-regarded local schools" is acceptable if the neighbourhood is mentioned in the agent description; "Ofsted Outstanding" or "primary rated 9/10" is forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz ciepło, praktycznie, w rytmie codziennego życia rodziny. Prowadź narracją układu mieszkania — elastyczność pokoi, gdzie dzieci odrabiają lekcje, jak wyglądają poranki przed szkołą. Każdą cechę osadzaj w codzienności: poranki, weekendy w ogrodzie lub na balkonie, kolejne etapy dorastania dzieci. Zamknięcie pozycjonuje dom jako miejsce, w które rodzina wrasta, a nie z którego "wyrośnie" za trzy lata. Słownictwo preferowane: miejsce do rośnięcia, codzienny rytm, przestrzeń do przechowywania, elastyczny układ, w zasięgu spaceru, spokojna ulica. Unikać: inwestycja, rentowność, ROI, aktywo, wyjście kapitałowe. W kontekście PL możesz odnosić się do "okolicy ze szkołą podstawową w pieszej odległości", parków, placów zabaw — bez konkretnych nazw szkół czy rankingów.

HARD RULES:
Nie cytuj ocen szkół, rankingów, ani konkretnych nazw rejonowych podstawówek, jeśli nie są w verified_facts. "Cenione okoliczne szkoły" — tak, jeśli dzielnica jest wymieniona; "SP nr 31 z najlepszymi wynikami w rejonie" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe con calidez, sentido práctico y anclado en la vida cotidiana familiar. Lidera con cómo la distribución funciona para una familia — flexibilidad de habitaciones, dónde se hacen los deberes, cómo se organizan las mañanas. Enmarca cada elemento en el ritmo diario: mañanas antes del colegio, fines de semana en la terraza, etapas de crecimiento de los hijos. El cierre posiciona la vivienda como un hogar en el que una familia crece, no del que se sale a los tres años. Léxico preferido: espacio para crecer, ritmo diario, almacenamiento amplio, distribución flexible, a pie, calle tranquila, asentado. Evitar: inversión, rentabilidad, ROI, activo, salida. En contexto ES puedes hacer referencia genérica a colegios cercanos, parques de barrio, comercio de proximidad — sin nombres concretos.

HARD RULES:
Nunca cites puntuaciones de colegios, rankings ni nombres de centros escolares concretos a menos que figuren en verified_facts. "Colegios bien valorados en la zona" sí, si el barrio está en la descripción; "Colegio X con nota 9" prohibido sin verificación.`,
  },
};
