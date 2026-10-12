import type { PlaybookEntry } from '../types.js';

export const secondHomeBuyerPlaybook: PlaybookEntry = {
  archetype: 'second_home_buyer',
  description: 'Buying a holiday or weekend home alongside primary residence',
  slots: [
    {
      slot: 'headline',
      en: 'Your Holiday Home — {location_highlight}',
      variants: {
        en: [
          'Your Holiday Home — {location_highlight}',
          'Weekend Escape — {location_highlight}, Ready to Move In',
          'Holiday Home Investment — {location_highlight} | Short-Term Rental Potential',
        ],
      },
    },
    { slot: 'cta', en: 'Enquire About Holiday Use' },
    { slot: 'feature', en: 'Weekend Escape' },
  ],
  listing_rules: {
    boost_if: ['holiday_area', 'near_beach_or_mountain', 'short_term_rental_possible', 'turnkey'],
    suppress_if: ['city_centre', 'no_amenities'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'location',
    'holiday_amenities',
    'rental_potential',
    'maintenance_costs',
    'transport_links',
  ],
  signals: [
    'weekend_browsing_pattern',
    'views_holiday_areas',
    'quiz:own_use+short',
    'international_or_secondary_city_ip',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write in a lifestyle-aware, lock-up-and-leave register — the reader already owns a primary home and is buying for weekends, holidays, and occasional family use. Lead with the weekend-arrival feeling where location data permits: the drive, the key in the door, the bag on the floor by Friday evening. Frame the property as engineered for more weekends and less admin — turnkey, easy to close up, simple to reopen. The closer positions the home as engineered for more weekends. Preferred lexicon: weekend, lock-up-and-leave, dual-purpose, low-admin, escape, turnkey, easy reopening, low-overhead. Avoid: primary residence, every-day, daily commute, family rhythm, school run, growing into.

HARD RULES:
Never quote specific drive times from major cities, specific short-let occupancy percentages, or specific maintenance figures unless they are in verified_facts. "Reasonable drive from major cities" is acceptable if the location supports it; "1h 40min from London, 65% summer occupancy" is forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz w rejestrze lifestyle'owym, w stylu "zamknij i wyjedź" — czytelnik ma już dom główny i kupuje na weekendy, wakacje i okazjonalne wykorzystanie przez rodzinę. Prowadź wrażeniem dojazdu na weekend, jeśli lokalizacja na to pozwala: trasa, klucz w drzwiach, torba na podłodze w piątek wieczorem. Pokazuj nieruchomość jako zaprojektowaną pod więcej weekendów i mniej formalności — pod klucz, łatwa do zamknięcia, prosta do otwarcia. Zamknięcie pozycjonuje dom jako "zaprojektowany pod więcej weekendów". Słownictwo preferowane: weekend, zamknij i wyjedź, dwufunkcyjny, niska administracja, ucieczka, pod klucz, łatwe otwarcie, niskie koszty stałe. Unikać: główne miejsce zamieszkania, codzienność, dojazdy do pracy, rytm rodzinny, droga do szkoły. W PL drugi dom to często Mazury, Kaszuby, polskie góry, polskie wybrzeże — odnoś się ogólnie.

HARD RULES:
Nigdy nie cytuj konkretnych czasów dojazdu z miast, konkretnego obłożenia w % ani konkretnych kosztów utrzymania, jeśli nie ma ich w verified_facts. "Rozsądny dojazd z głównych miast" — tak, jeśli lokalizacja na to pozwala; "1h 40min z Warszawy, 65% obłożenia w lecie" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe en clave lifestyle, en estilo "cierra y vete" — el lector ya tiene vivienda habitual y compra para fines de semana, vacaciones y uso ocasional familiar. Lidera con la sensación de llegada de fin de semana si la ubicación lo permite: el trayecto, la llave en la puerta, la bolsa en el suelo el viernes por la tarde. Presenta la propiedad como diseñada para más fines de semana y menos gestión — llave en mano, fácil de cerrar, simple de reabrir. El cierre la posiciona como "ingeniada para más fines de semana". Léxico preferido: fin de semana, cierra y vete, multipropósito, baja gestión, escapada, llave en mano, reapertura fácil, gastos contenidos. Evitar: vivienda habitual, día a día, desplazamiento diario, ritmo familiar, ruta del colegio. En contexto ES la segunda residencia típica está en costa o sierra — Cataluña, Levante, Andalucía, Pirineos — referencia genérica.

HARD RULES:
Nunca cites tiempos concretos de trayecto desde grandes ciudades, % de ocupación de corta estancia ni gastos de mantenimiento concretos salvo en verified_facts. "Trayecto razonable desde grandes ciudades" sí, si la ubicación lo permite; "1h 40min desde Madrid, 65% de ocupación en verano" prohibido sin verificación.`,
  },
};
