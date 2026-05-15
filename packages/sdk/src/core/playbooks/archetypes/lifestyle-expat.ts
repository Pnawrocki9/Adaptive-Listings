import type { PlaybookEntry } from '../types.js';

export const lifestyleExpatPlaybook: PlaybookEntry = {
  archetype: 'lifestyle_expat',
  description:
    'Relocating from another country, prioritizing integration, lifestyle, and community',
  slots: [
    {
      slot: 'headline',
      en: 'Expat Community — {neighborhood} | International Schools Nearby',
      variants: {
        en: [
          'Expat Community — {neighborhood} | International Schools Nearby',
          'International Living — English Services, Expat Network Active',
          'Relocation Ready — {neighborhood} | Schools, Healthcare & Expat Community',
        ],
      },
    },
    { slot: 'cta', en: 'Download Expat Relocation Guide' },
    { slot: 'feature', en: 'Expat Essentials' },
  ],
  listing_rules: {
    boost_if: ['expat_community_area', 'international_schools', 'english_speaking_area'],
    suppress_if: [],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'expat_community',
    'international_schools',
    'english_services',
    'neighborhood_guide',
    'healthcare',
  ],
  signals: [
    'international_ip',
    'views_neighborhood_content',
    'clicks_schools',
    'quiz:own_use+long',
    'googles_expat_terms',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write reassuringly, with cosmopolitan ease and low-friction framing. Lead with the international community context — the assumption that the reader is moving from another country and needs the basics handled. Frame the property as the soft landing for someone arriving from abroad: services that work in English, neighbourhoods where international families have already settled, transport that gets them home without a complicated commute. The closer should promise a soft landing, not a renovation project or a cultural deep-dive. Preferred lexicon: international community, bilingual, soft landing, walkable, established, settled, predictable, well-connected. Avoid: authentic local experience, off the beaten path, charming chaos, hidden gem, immersive.

HARD RULES:
Never name specific neighbourhoods, quote distance figures, or claim English-speaking services exist unless they appear in verified_facts or agent description. "An established international community in the area" is acceptable; "12 minutes to the British School of X" or "fluent-English notary in the block" is forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz uspokajająco, kosmopolitycznie, z naciskiem na "mało tarcia". Prowadź narracją międzynarodowej społeczności — czytelnik prawdopodobnie wprowadza się z innego kraju i potrzebuje, by podstawy działały. Pokazuj nieruchomość jako miękkie lądowanie: usługi po angielsku, dzielnice ze społecznościami obcokrajowców, komunikacja, która nie wymaga tłumaczenia rozkładów jazdy. Zamknięcie obiecuje miękkie lądowanie, nie projekt remontowy ani głęboką lokalność. Słownictwo preferowane: społeczność międzynarodowa, dwujęzyczny, miękkie lądowanie, w zasięgu spaceru, ugruntowany, ustabilizowany, dobrze skomunikowany. Unikać: autentyczne lokalne doświadczenie, ukryta perełka, klimatyczny chaos. W kontekście PL pamiętaj, że Polska ma rosnące skupiska expat-ów w Warszawie, Krakowie, Wrocławiu — odnoś się ogólnie, nie konkretnie.

HARD RULES:
Nigdy nie podawaj konkretnych dzielnic, odległości w minutach, ani nie twierdź, że dostępne są usługi w języku angielskim, jeśli nie ma tego w verified_facts ani w opisie agenta. "Ugruntowana społeczność międzynarodowa w okolicy" — tak; "12 minut do British International School" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe con tono tranquilizador, cosmopolita, con mínima fricción. Lidera con el contexto de comunidad internacional — el lector probablemente se traslada desde otro país y necesita que lo básico funcione. Presenta la propiedad como aterrizaje suave: servicios en inglés, barrios con familias internacionales ya asentadas, transporte que llega a casa sin complicaciones. El cierre promete aterrizaje suave, no proyecto de reforma ni inmersión cultural profunda. Léxico preferido: comunidad internacional, bilingüe, aterrizaje suave, a pie, asentado, estable, bien conectado. Evitar: experiencia local auténtica, fuera de las rutas turísticas, caos con encanto, tesoro oculto. En contexto ES, hay comunidades internacionales consolidadas en Madrid, Barcelona, Valencia, Málaga, Marbella — referencias genéricas, nunca específicas.

HARD RULES:
Nunca menciones barrios concretos, distancias en minutos, ni afirmes que existen servicios en inglés salvo que figuren en verified_facts o en la descripción. "Comunidad internacional consolidada en la zona" sí; "12 minutos al British School of X" prohibido sin verificación.`,
  },
};
