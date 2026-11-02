import type { PlaybookEntry } from '../types.js';

export const studentParentPlaybook: PlaybookEntry = {
  archetype: 'student_parent',
  description: 'Parent buying for a child at university — investment-meets-own-use hybrid',
  slots: [
    {
      slot: 'headline',
      en: 'Student Investment — Near Campus | Let While Studying',
      variants: {
        en: [
          'Student Investment — Near Campus | Let While Studying',
          'University Property — Rental Income Throughout the Study Years',
          'Smart Student Buy — Rental Income Toward Study Costs',
        ],
      },
    },
    { slot: 'cta', en: 'Ask the Agent About Student Lets' },
    { slot: 'feature', en: 'Student Area Insights' },
  ],
  listing_rules: {
    boost_if: ['near_university', 'student_area', 'rental_possible', 'small_manageable'],
    suppress_if: ['far_from_university', 'luxury_tier'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'distance_to_university',
    'rental_yield_student',
    'condition',
    'security',
    'transport',
  ],
  signals: [
    'searches_university_proximity',
    'views_small_listings',
    'clicks_rental_calc',
    'quiz:investment+medium',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write in a parent-reassuring, dual-purpose, practical register. The reader is a parent buying for a child going to university and is balancing emotional concern (safety, study environment, peers) with financial logic (covering the mortgage from housemates, eventual exit). Lead with proximity to the university where the listing states it, in the listing's terms; say nothing of safety or noise it does not state. Frame the property as doing two jobs without compromising either: a calm home for the child today, a saleable or lettable asset on graduation. The closer positions letting or selling at graduation as the reader's plan, never as a fact about the market. Preferred lexicon: dual-purpose, calm parents, predictable, settled study environment; durable, sturdy, walking distance, exit market only where the listing says so. Avoid: family home, retirement, executive, luxury, premium.

HARD RULES:
Never name a specific university, quote a specific distance in minutes, or quote a specific student rental yield unless it is in verified_facts. "Walking distance to campus" only if the listing says so; specific university names or "7-minute walk to UCL" are forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz w rejestrze uspokajającym rodzica, dwufunkcyjnym, praktycznym. Czytelnik to rodzic kupujący dla dziecka idącego na studia, balansujący troskę emocjonalną (bezpieczeństwo, środowisko do nauki, rówieśnicy) z logiką finansową (pokrycie raty przez współlokatorów, ostateczne wyjście). Prowadź narracją bliskości uczelni, jeśli podaje ją oferta, jej słowami; o bezpieczeństwie i hałasie nie pisz nic, czego oferta nie podaje. Pokazuj nieruchomość jako wykonującą dwie role bez kompromisu: spokojny dom dla dziecka teraz, możliwy do sprzedaży lub wynajmu po dyplomie. Zamknięcie pokazuje wynajem lub sprzedaż po dyplomie jako plan czytelnika, nigdy jako fakt o rynku. Słownictwo preferowane: dwufunkcyjny, spokój rodziców, przewidywalny, dobre warunki do nauki; trwały, solidny, w zasięgu spaceru, rynek wyjścia tylko wtedy, gdy mówi tak oferta. Unikać: dom rodzinny, emerytura, wykonawcza klasa, luksus. O kampusie, mieście uniwersyteckim i nazwach uczelni pisz tylko wtedy, gdy są w opisie agenta.

HARD RULES:
Nigdy nie wymieniaj konkretnej uczelni, konkretnej odległości w minutach ani konkretnej rentowności najmu studenckiego, jeśli nie ma tego w verified_facts. "W zasięgu spaceru do kampusu" — tylko jeśli mówi tak oferta; "7 minut pieszo do UJ" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe en clave tranquilizadora para el padre o madre, multipropósito, práctica. El lector es progenitor que compra para un hijo que empieza la universidad y equilibra preocupación emocional (seguridad, entorno de estudio, compañeros) con lógica financiera (cubrir hipoteca con compañeros de piso, salida eventual). Lidera con la proximidad a la universidad si la indica el anuncio, con sus palabras; de seguridad y ruido no digas nada que el anuncio no indique. Presenta la propiedad como cumpliendo dos funciones sin sacrificar ninguna: hogar tranquilo para el hijo hoy, activo vendible o arrendable al graduarse. El cierre presenta alquilar o vender al graduarse como plan del lector, nunca como un hecho del mercado. Léxico preferido: multipropósito, padres tranquilos, predecible, entorno de estudio sereno; duradero, sólido, a pie, mercado de salida solo si lo dice el anuncio. Evitar: hogar familiar, jubilación, ejecutivo, lujo, premium. El campus y los nombres de universidades, solo si están en la descripción del agente.

HARD RULES:
Nunca menciones la universidad concreta, distancia concreta en minutos ni rentabilidad concreta de alquiler estudiantil salvo en verified_facts. "A pie del campus" solo si lo dice el anuncio; "7 minutos andando a la UCM" prohibido sin verificación.`,
  },
};
