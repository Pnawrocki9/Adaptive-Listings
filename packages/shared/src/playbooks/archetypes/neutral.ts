import type { PlaybookEntry } from '../types.js';

/** Neutral fallback — no adaptation applied. Used when archetype is unclassified. */
export const neutralPlaybook: PlaybookEntry = {
  archetype: 'neutral',
  description: 'Unclassified — no adaptation applied',
  slots: [],
  listing_rules: {
    boost_if: [],
    suppress_if: [],
    boost_class: '',
    suppress_class: '',
  },
  feature_priority: [],
  signals: [],
  copy_template: {
    en: `VOICE PATTERN:
Write in a balanced, fundamentals-focused, non-leading register. The reader's intent is unclassified — they may be an investor, a family, a downsizer, or someone simply browsing. Lead with a practical accommodation summary: what the home is, what it offers, who it would suit. Frame features in neutral terms, letting fundamentals speak: sound construction, sensible layout, reasonable location, fair pricing. The closer positions the property as having sound fundamentals at a fair asking price; specific suitability depends on the buyer's priorities. Preferred lexicon: practical, sound, balanced, conventional, fair, considered, reasonable, well-presented, suitable. Avoid: opportunity, perfect, dream, must-see, exclusive, urgent, once-in-a-lifetime, transformative. Default to safe, descriptive language whenever uncertainty exists about reader intent.

HARD RULES:
Never quote ratings, scores, percentages, distances, school positions, yield figures, or any numeric claim unless it is in verified_facts. Use generic descriptors throughout. This is the safest archetype — when in doubt about any specific claim, drop it rather than invent it.`,
    pl: `VOICE PATTERN:
Pisz w rejestrze wyważonym, skupionym na fundamentach, nieprowadzącym. Intencja czytelnika jest nieskategoryzowana — może być inwestorem, rodziną, osobą zmieniającą mieszkanie na mniejsze lub po prostu przeglądającą. Prowadź praktycznym streszczeniem: czym jest nieruchomość, co oferuje, komu może pasować. Cechy ujmuj w neutralnych terminach, pozwól fundamentom mówić: solidna konstrukcja, sensowny układ, rozsądna lokalizacja, uczciwa cena. Zamknięcie pozycjonuje nieruchomość jako posiadającą zdrowe fundamenty przy uczciwej cenie wywoławczej; konkretne dopasowanie zależy od priorytetów kupującego. Słownictwo preferowane: praktyczny, solidny, wyważony, konwencjonalny, uczciwy, rozważny, rozsądny, dobrze prezentowany, odpowiedni. Unikać: okazja, idealny, marzenie, must-see, ekskluzywny, pilny, raz na całe życie, transformujący. Przy niepewności co do intencji domyślnie używaj bezpiecznego, opisowego języka.

HARD RULES:
Nigdy nie cytuj ocen, punktacji, procentów, odległości, pozycji szkół, rentowności ani żadnych twierdzeń liczbowych, jeśli nie ma ich w verified_facts. Używaj ogólnych deskryptorów. To najbezpieczniejszy archetyp — gdy nie masz pewności co do konkretu, opuść go, nie wymyślaj.`,
    es: `VOICE PATTERN:
Escribe en clave equilibrada, centrada en fundamentos, no inductiva. La intención del lector es no clasificada — puede ser inversor, familia, alguien que reduce vivienda o simplemente alguien navegando. Lidera con un resumen práctico: qué es la vivienda, qué ofrece, a quién podría encajar. Encuadra los elementos en términos neutrales, dejando hablar a los fundamentos: construcción sólida, distribución sensata, ubicación razonable, precio justo. El cierre la posiciona como propiedad con fundamentos sólidos a precio de venta razonable; la idoneidad específica depende de las prioridades del comprador. Léxico preferido: práctico, sólido, equilibrado, convencional, justo, meditado, razonable, bien presentado, adecuado. Evitar: oportunidad, perfecto, sueño, must-see, exclusivo, urgente, irrepetible, transformador. Ante incertidumbre sobre la intención del lector, recurre por defecto a lenguaje seguro y descriptivo.

HARD RULES:
Nunca cites puntuaciones, calificaciones, porcentajes, distancias, posiciones de colegios, rentabilidades ni afirmaciones numéricas salvo en verified_facts. Usa descriptores genéricos. Es el arquetipo más seguro — ante duda sobre cualquier afirmación concreta, descártala antes que inventarla.`,
  },
};
