import type { PlaybookEntry } from '../types.js';

export const retireeRelocatorPlaybook: PlaybookEntry = {
  archetype: 'retiree_relocator',
  description: 'Retiree seeking warm climate, healthcare access, low cost of living',
  slots: [
    {
      slot: 'headline',
      en: 'Retire in the Sun — Mild Climate, Relaxed Pace',
      variants: {
        en: [
          'Retire in the Sun — Mild Climate, Relaxed Pace',
          'Retire Abroad — Warm Climate, Healthcare Close, Low Cost of Living',
          'Relaxed Living — A Calmer Pace',
        ],
      },
    },
    { slot: 'cta', en: 'Download Retirement Living Guide' },
    { slot: 'feature', en: 'Retirement Living Highlights' },
  ],
  listing_rules: {
    boost_if: ['warm_climate', 'healthcare_nearby', 'low_maintenance', 'expat_retiree_community'],
    suppress_if: ['cold_region', 'remote_location'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'healthcare_proximity',
    'climate',
    'low_maintenance',
    'expat_community',
    'cost_of_living',
    'accessibility',
  ],
  signals: [
    'international_ip',
    'views_retirement_content',
    'filters_accessible',
    'quiz:own_use+long',
    'older_device_patterns',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write calmly, sunlit, and practically. The reader is planning a relocation they have thought about for years and wants reassurance, not pitch. Lead with lifestyle quality and accessibility where the listing states them — gentle climate, walkable amenities, level access. Frame the property as the retirement the reader described to themselves ten years ago, now made operational rather than aspirational. The closer positions the move as "the retirement you imagined, made operational". Preferred lexicon: predictable, calm, manageable; sunlit, accessible, established community, gentle climate, level, well-served only where the listing says so. Avoid: investment, ambition, fast-paced, scale, opportunity, hustle. Treat the reader as someone who has earned the right to ease.

HARD RULES:
Never quote average temperatures, days of sunshine, specific airport names or distances, or specific hospital names unless they are in verified_facts. "Mild climate" only if the listing says so; "average 22°C, 300 days of sun, private hospital 8 minutes away" is forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz spokojnie, w słonecznym rejestrze i bardzo praktycznie. Czytelnik planuje przeprowadzkę, o której myślał latami, i potrzebuje uspokojenia, nie sprzedaży. Prowadź narracją jakości życia i dostępności, jeśli podaje je oferta — łagodny klimat, usługi w zasięgu spaceru, parter lub dostęp poziomy. Pokazuj nieruchomość jako emeryturę, którą czytelnik opisał sobie dziesięć lat temu, teraz wykonalną. Zamknięcie pozycjonuje przeprowadzkę jako "emeryturę, jaką sobie wymarzyłeś, w wersji operacyjnej". Słownictwo preferowane: przewidywalny, spokojny; nasłoneczniony, dostępny, ustabilizowana społeczność, łagodny klimat, jeden poziom, dobrze obsłużony tylko wtedy, gdy mówi tak oferta. Unikać: inwestycja, ambicja, szybkie tempo, skala, okazja. O klimacie i charakterze miejscowości pisz tylko wtedy, gdy mówi o nich oferta.

HARD RULES:
Nigdy nie cytuj średnich temperatur, liczby dni słonecznych, nazw lotnisk ani konkretnych nazw szpitali, jeśli nie ma ich w verified_facts. "Łagodny klimat" — tylko jeśli mówi tak oferta; "średnio 22°C, 300 dni słońca, szpital 8 minut" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe con calma, en clave luminosa y muy práctica. El lector lleva años pensando en este traslado y busca tranquilidad, no venta. Lidera con calidad de vida y accesibilidad si los indica el anuncio — clima suave, servicios a pie, planta baja o acceso a nivel. Presenta la vivienda como la jubilación que el lector se describió hace diez años, ahora viable. El cierre la posiciona como "la jubilación que imaginabas, hecha operativa". Léxico preferido: predecible, sereno; soleado, accesible, comunidad consolidada, clima suave, una planta, bien servido solo si lo dice el anuncio. Evitar: inversión, ambición, ritmo rápido, escala, oportunidad. Del clima y del destino habla solo si los menciona el anuncio.

HARD RULES:
Nunca cites temperaturas medias, días de sol, nombres concretos de aeropuertos ni de hospitales salvo en verified_facts. "Clima suave" solo si lo dice el anuncio; "media 22°C, 300 días de sol, hospital privado a 8 minutos" prohibido sin verificación.`,
  },
};
