import type { PlaybookEntry } from '../types.js';

export const remoteWorkerPlaybook: PlaybookEntry = {
  archetype: 'remote_worker',
  description: 'Location-independent professional prioritizing home office and connectivity',
  slots: [
    {
      slot: 'headline',
      en: 'Work From Home — Dedicated Office Space | {internet_speed}Mbps Fibre',
      variants: {
        en: [
          'Work From Home — Dedicated Office Space | {internet_speed}Mbps Fibre',
          'Remote-Ready Home — Private Office, {internet_speed}Mbps Broadband',
          'Work Anywhere — Dedicated Study, Fibre Broadband & Natural Light',
        ],
      },
    },
    { slot: 'cta', en: 'Check Connectivity' },
    { slot: 'feature', en: 'Remote Work Ready' },
  ],
  listing_rules: {
    boost_if: ['dedicated_office_room', 'fibre_available', 'quiet_area', 'good_natural_light'],
    suppress_if: ['no_office_space', 'poor_connectivity'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'dedicated_office',
    'internet_speed',
    'natural_light',
    'noise_level',
    'co_working_nearby',
  ],
  signals: [
    'searches_office_space',
    'clicks_connectivity_info',
    'views_desk_room_photos',
    'quiz:own_use+any',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write practically, work-aware, and recognisably modern — the reader's life includes meetings before lunch and a closed door at 9am. Lead with workspace suitability where bedroom or room data exists: a study, a flex room, a quiet corner with natural light. Frame features around how work actually happens now: a calm acoustic, separation between work and living, daylight that doesn't kill camera footage. The closer positions the home as designed for the way work happens, not as a "lifestyle retreat". Preferred lexicon: dedicated office, quiet, reliable, dual-purpose, predictable, natural light, separation, closed door. Avoid: lifestyle, retreat, escape, getaway, sanctuary, recharge.

HARD RULES:
Never quote a specific broadband speed (Mbps, Gbps), latency figure, or transport time unless it is in verified_facts. "Fast broadband available" is acceptable if the agent description mentions fibre; "1Gbps full-fibre installed" is forbidden unless explicitly verified. No "X minutes to the station" without verified data.`,
    pl: `VOICE PATTERN:
Pisz praktycznie, ze świadomością pracy, w nowoczesnym rejestrze — czytelnik ma poranne spotkania i zamknięte drzwi o 9:00. Prowadź narracją przestrzeni pracy, jeśli są dane o pokojach: gabinet, pokój wielofunkcyjny, ciche miejsce z dziennym światłem. Cechy umieszczaj w sposobie, w jaki dziś naprawdę pracujemy: spokojna akustyka, oddzielenie pracy od życia, światło niezabijające obrazu w kamerze. Zamknięcie pozycjonuje mieszkanie jako zaprojektowane pod sposób pracy, nie "lifestyle'owe schronienie". Słownictwo preferowane: dedykowane biuro, cisza, niezawodny, dwufunkcyjny, przewidywalny, naturalne światło, oddzielenie, zamknięte drzwi. Unikać: ucieczka, sanktuarium, retreat, regeneracja. W PL możesz odnosić się do trendu hybrydy i dostępności światłowodu w miastach — ogólnie.

HARD RULES:
Nigdy nie cytuj konkretnej prędkości łącza (Mb/s, Gb/s), opóźnienia ani czasu dojazdu, jeśli nie ma tego w verified_facts. "Szybki internet" — tak, jeśli agent wspomina o światłowodzie; "1 Gb/s światłowód zainstalowany" — zabronione bez weryfikacji. Bez "X minut do dworca" bez danych.`,
    es: `VOICE PATTERN:
Escribe de forma práctica, con conciencia laboral, en registro moderno — el lector tiene reuniones antes de comer y una puerta cerrada a las 9:00. Lidera con la idoneidad para trabajar si los datos de habitaciones lo permiten: estudio, sala polivalente, rincón tranquilo con luz natural. Enmarca los elementos en cómo se trabaja hoy: acústica tranquila, separación entre trabajo y vida, luz que no destroza la imagen en cámara. El cierre presenta la vivienda como diseñada para la forma actual de trabajar, no como "refugio lifestyle". Léxico preferido: despacho dedicado, silencio, fiable, multiusos, predecible, luz natural, separación, puerta cerrada. Evitar: refugio, retiro, escapada, santuario, recarga. En contexto ES hay tendencia clara hacia trabajo híbrido y fibra ampliamente desplegada en ciudades — referencias genéricas.

HARD RULES:
Nunca cites velocidad concreta (Mbps, Gbps), latencia ni tiempos de transporte salvo en verified_facts. "Buena conexión a internet" sí, si el agente menciona fibra; "fibra de 1 Gbps instalada" prohibido sin verificación. Nada de "X minutos al metro" sin datos.`,
  },
};
