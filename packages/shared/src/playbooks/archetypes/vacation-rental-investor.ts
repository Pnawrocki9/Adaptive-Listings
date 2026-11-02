import type { PlaybookEntry } from '../types.js';

export const vacationRentalInvestorPlaybook: PlaybookEntry = {
  archetype: 'vacation_rental_investor',
  description: 'Short-term rental investor targeting Airbnb/holiday markets (ES, CY focus)',
  slots: [
    {
      slot: 'headline',
      en: 'Short-Term Rental Opportunity — Strong Local Demand',
      variants: {
        en: [
          'Short-Term Rental Opportunity — Strong Local Demand',
          'Short-Term Rental Investment — Peak Season Potential',
          'Holiday Let Opportunity — Tourist License, Near Beach',
        ],
      },
    },
    { slot: 'cta', en: 'Ask the Agent About Short-Term Rental' },
    { slot: 'feature', en: 'Short-Term Rental' },
  ],
  listing_rules: {
    boost_if: ['tourist_zone', 'short_term_rental_license', 'near_beach', 'near_airport'],
    suppress_if: ['rental_restrictions', 'no_stl_license'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'tourist_license_status',
    'nightly_rate_estimate',
    'beach_distance',
    'airport_distance',
    'pool',
  ],
  signals: [
    'searches_tourist_areas',
    'clicks_location_map',
    'quiz:investment+short',
    'views_airbnb_related',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write operationally, data-aware, and platform-fluent. The reader is evaluating a unit through the lens of a short-let operator: photo-readiness, licence cleanliness, turnover practicality. Lead with short-let suitability where licence or photo-readiness data exists. Frame the property as a unit to run as a short let — furnishing, documentation and licence as the listing states them, the neighbourhood as the listing names it. The closer positions the asset on what an operator can check today, not on a forecast. Preferred lexicon: platform-ready, operational, documented, photogenic, licence-clean. Avoid: family home, retirement, long-term, lifestyle, dream getaway, weekend retreat.

HARD RULES:
Never quote occupancy percentages, ADR, nightly rates, platform commission rates, or beach/airport distances unless they are in verified_facts. Mention short-let demand in the area only if the listing states it; "85% occupancy on Airbnb at €180 ADR" is forbidden unless explicitly verified. Do not claim a licence is in place unless verified.`,
    pl: `VOICE PATTERN:
Pisz operacyjnie, w języku danych i platform. Czytelnik ocenia jednostkę okiem operatora najmu krótkoterminowego: gotowość do zdjęć, czystość licencyjna, praktyczność rotacji. Prowadź narracją przydatności pod krótki najem, jeśli są dane o licencji lub gotowości. Pokazuj nieruchomość jako jednostkę do prowadzenia w najmie krótkoterminowym — meble, dokumentacja i licencja tak, jak podaje je opis oferty, dzielnica tak, jak nazywa ją oferta. Zamknięcie pozycjonuje aktywo przez to, co operator może sprawdzić dziś, nie przez prognozę. Słownictwo preferowane: gotowy na platformę, operacyjny, udokumentowany, fotogeniczny, czysta licencja. Unikać: dom rodzinny, emerytura, długi termin, lifestyle, wymarzona ucieczka. O rynku turystycznym okolicy pisz tylko wtedy, gdy mówi o nim oferta.

HARD RULES:
Nigdy nie cytuj obłożenia w %, ADR, stawek za noc, prowizji platform ani odległości do plaży/lotniska, jeśli nie ma ich w verified_facts. O popycie na najem krótkoterminowy w okolicy pisz tylko wtedy, gdy podaje go oferta; "85% obłożenia na Airbnb przy 180 €" — zabronione bez weryfikacji. Nie twierdź, że licencja jest na miejscu, bez potwierdzenia.`,
    es: `VOICE PATTERN:
Escribe en clave operativa, con conciencia de datos y fluidez de plataforma. El lector evalúa la unidad como operador de alquiler turístico: idoneidad fotográfica, limpieza de licencia, practicidad de rotación. Lidera con idoneidad para corta estancia si hay datos de licencia o estado de la unidad. Presenta la propiedad como unidad para explotar en corta estancia — mobiliario, documentación y licencia tal como los indica el anuncio, el barrio tal como lo nombra el anuncio. El cierre la posiciona por lo que un operador puede comprobar hoy, no por una previsión. Léxico preferido: lista para plataforma, operativa, documentada, fotogénica, licencia limpia. Evitar: hogar familiar, jubilación, largo plazo, lifestyle, escapada soñada. De la licencia turística habla solo si verified_facts lo respalda.

HARD RULES:
Nunca cites % de ocupación, ADR, tarifas por noche, comisiones de plataforma ni distancias a playa/aeropuerto salvo en verified_facts. De la demanda de corta estancia en la zona habla solo si la indica el anuncio; "85% de ocupación en Airbnb a 180 €" prohibido sin verificación. No afirmes que la licencia VFT/VUT está vigente sin verificación.`,
  },
};
