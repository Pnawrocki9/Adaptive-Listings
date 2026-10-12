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
          'University Property — Rental Income While Your Child Studies',
          'Smart Student Buy — Rental Income Toward Study Costs',
        ],
      },
    },
    { slot: 'cta', en: 'Calculate Student Rental Return' },
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
Write in a parent-reassuring, dual-purpose, practical register. The reader is a parent buying for a child going to university and is balancing emotional concern (safety, study environment, peers) with financial logic (covering the mortgage from housemates, eventual exit). Lead with proximity to the university where location data permits — close enough to be safe and convenient, far enough from the loudest student streets. Frame the property as doing two jobs without compromising either: a calm home for the child today, a saleable or lettable asset on graduation. The closer positions the property as one that slides straight into the student rental market at graduation. Preferred lexicon: dual-purpose, calm parents, durable, walking distance, exit market, predictable, settled study environment, sturdy. Avoid: family home, retirement, executive, luxury, premium.

HARD RULES:
Never name a specific university, quote a specific distance in minutes, or quote a specific student rental yield unless it is in verified_facts. "Walking distance to campus" is acceptable if the location is near a university by general knowledge; specific university names or "7-minute walk to UCL" are forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz w rejestrze uspokajającym rodzica, dwufunkcyjnym, praktycznym. Czytelnik to rodzic kupujący dla dziecka idącego na studia, balansujący troskę emocjonalną (bezpieczeństwo, środowisko do nauki, rówieśnicy) z logiką finansową (pokrycie raty przez współlokatorów, ostateczne wyjście). Prowadź narracją bliskości uczelni, jeśli dane lokalizacyjne na to pozwalają — wystarczająco blisko, by było wygodnie i bezpiecznie, wystarczająco daleko od najgłośniejszych ulic studenckich. Pokazuj nieruchomość jako wykonującą dwie role bez kompromisu: spokojny dom dla dziecka teraz, możliwy do sprzedaży lub wynajmu po dyplomie. Zamknięcie pozycjonuje nieruchomość jako "wchodzącą prosto w rynek najmu studenckiego po dyplomie". Słownictwo preferowane: dwufunkcyjny, spokój rodziców, trwały, w zasięgu spaceru, rynek wyjścia, przewidywalny, dobre warunki do nauki, solidny. Unikać: dom rodzinny, emerytura, wykonawcza klasa, luksus. W PL możesz odnosić się ogólnie do "kampusu" lub "głównego miasta uniwersyteckiego", nazwy uczelni (UJ, UW, AGH, PW) tylko jeśli są w opisie agenta.

HARD RULES:
Nigdy nie wymieniaj konkretnej uczelni, konkretnej odległości w minutach ani konkretnej rentowności najmu studenckiego, jeśli nie ma tego w verified_facts. "W zasięgu spaceru do kampusu" — tak, jeśli lokalizacja jest blisko uczelni ogólnie znanej; "7 minut pieszo do UJ" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe en clave tranquilizadora para el padre o madre, multipropósito, práctica. El lector es progenitor que compra para un hijo que empieza la universidad y equilibra preocupación emocional (seguridad, entorno de estudio, compañeros) con lógica financiera (cubrir hipoteca con compañeros de piso, salida eventual). Lidera con la proximidad a la universidad si los datos de ubicación lo permiten — lo bastante cerca para ser seguro y cómodo, lo bastante lejos de las calles más ruidosas de la zona estudiantil. Presenta la propiedad como cumpliendo dos funciones sin sacrificar ninguna: hogar tranquilo para el hijo hoy, activo vendible o arrendable al graduarse. El cierre la posiciona como "encaja directamente en el mercado de alquiler estudiantil al graduarse". Léxico preferido: multipropósito, padres tranquilos, duradero, a pie, mercado de salida, predecible, entorno de estudio sereno, sólido. Evitar: hogar familiar, jubilación, ejecutivo, lujo, premium. En contexto ES referencia genérica a campus universitario; nombres concretos (UAB, UCM, UB) solo si están en la descripción del agente.

HARD RULES:
Nunca menciones la universidad concreta, distancia concreta en minutos ni rentabilidad concreta de alquiler estudiantil salvo en verified_facts. "A pie del campus" sí, si la ubicación está cerca de una universidad de conocimiento general; "7 minutos andando a la UCM" prohibido sin verificación.`,
  },
};
