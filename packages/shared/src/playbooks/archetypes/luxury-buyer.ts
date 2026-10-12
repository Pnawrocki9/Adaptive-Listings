import type { PlaybookEntry } from '../types.js';

export const luxuryBuyerPlaybook: PlaybookEntry = {
  archetype: 'luxury_buyer',
  description: 'High-end buyer seeking prestige, premium finishes, and lifestyle',
  slots: [
    {
      slot: 'headline',
      en: 'Exceptional Residence — Premium Fittings Throughout',
      variants: {
        en: [
          'Exceptional Residence — Premium Fittings Throughout',
          'Premium Residence — Exclusive Finishes, Concierge Services',
          'Prestige Collection — Private Viewings Only',
        ],
      },
    },
    { slot: 'cta', en: 'Request Private Viewing' },
    { slot: 'feature', en: 'Premium Highlights' },
  ],
  listing_rules: {
    boost_if: ['luxury_tier', 'price_top_10pct', 'premium_developer', 'concierge_services'],
    suppress_if: ['standard_finish', 'price_below_luxury_threshold'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: ['premium_features', 'finishes', 'views', 'privacy', 'concierge', 'smart_home'],
  signals: [
    'filters_price_high',
    'views_luxury_developments',
    'long_dwell_on_premium_photos',
    'quiz:own_use+any',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write discreetly, with quiet authority and understatement. Lead with the address or positioning quality where location data permits — the kind of detail a serious buyer notices without being told. Frame the property as a considered choice, not a deal: the reader is not hunting for value, they are evaluating fit with an existing way of life. The closer should position the residence as a destination, not an upgrade. Preferred lexicon: considered, discreet, principal suite, quiet authority, hand-laid, commissioned, by appointment, generational, private. Avoid: opportunity, deal, investment, yield, affordable, value, must-see, hot, exclusive deal. Let restraint do the work — over-describing reads as nouveau.

HARD RULES:
Never name specific appliance or fittings brands (Gaggenau, Sub-Zero, Bulthaup, Lutron, Boffi) unless they appear in the agent description. Never describe a view (sea view, skyline view, park view) unless it is in verified_facts. "Premium fittings throughout" is acceptable; "Gaggenau kitchen with Calacatta marble" is forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz dyskretnie, z cichą pewnością i niedopowiedzeniem. Prowadź jakością adresu i pozycjonowania, jeśli dane lokalizacyjne na to pozwalają — to detale, których poważny kupujący się domyśla. Pokazuj nieruchomość jako rozważny wybór, nie okazję: czytelnik nie szuka wartości, ocenia dopasowanie do istniejącego stylu życia. Zamknięcie pozycjonuje rezydencję jako cel, nie upgrade. Słownictwo preferowane: rozważny, dyskretny, apartament główny, cicha klasa, wykonywany na zamówienie, na zaproszenie, pokoleniowy, prywatny. Unikać: okazja, inwestycja, rentowność, przystępny, must-see, ekskluzywna oferta. Niedopowiedzenie pracuje lepiej niż nadmierny opis. W PL możesz odnosić się do prestiżowych adresów w Warszawie (Mokotów, Wilanów), Krakowie, Sopocie — ale wyłącznie ogólnie.

HARD RULES:
Nigdy nie wymieniaj konkretnych marek wyposażenia (Gaggenau, Sub-Zero, Bulthaup, Boffi), jeśli nie ma ich w opisie agenta. Nigdy nie opisuj widoku (na morze, na panoramę miasta, na park), jeśli nie ma go w verified_facts. "Wykończenia z najwyższej półki" — tak; "kuchnia Gaggenau z marmurem Calacatta" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe con discreción, autoridad sosegada y contención. Lidera con la calidad del emplazamiento o posicionamiento si los datos de ubicación lo permiten — detalles que un comprador serio reconoce sin que se le digan. Presenta la propiedad como una elección meditada, no una operación: el lector no busca valor, evalúa encaje con una forma de vida ya establecida. El cierre la posiciona como destino, no como mejora. Léxico preferido: meditado, discreto, suite principal, autoridad sosegada, hecho a medida, por cita previa, generacional, privado. Evitar: oportunidad, inversión, rentabilidad, asequible, must-see, oferta exclusiva, ganga. La contención trabaja mejor que la descripción excesiva. En contexto ES puedes referirte de forma genérica a zonas consolidadas (Salamanca, Pedralbes, Marbella), nunca con detalles inventados.

HARD RULES:
Nunca menciones marcas concretas de equipamiento (Gaggenau, Sub-Zero, Bulthaup, Boffi) si no figuran en la descripción del agente. Nunca describas una vista (al mar, al skyline, al parque) si no está en verified_facts. "Acabados de alta gama" sí; "cocina Gaggenau con mármol Calacatta" prohibido sin verificación.`,
  },
};
