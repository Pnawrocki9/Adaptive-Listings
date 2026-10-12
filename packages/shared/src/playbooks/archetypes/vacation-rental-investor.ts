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
    { slot: 'cta', en: 'See Short-Term Rental Projections' },
    { slot: 'feature', en: 'Short-Term Rental Projections' },
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
Write operationally, data-aware, and platform-fluent. The reader is evaluating a unit through the lens of a short-let operator: photo-readiness, licence cleanliness, turnover practicality. Lead with short-let suitability where licence or photo-readiness data exists. Frame the property as a unit that starts producing in week one — turnkey furnishing, established documentation, neighbourhood already in the algorithm. The closer positions the asset as producing in week one, not month six. Preferred lexicon: turnkey, platform-ready, operational, documented, photogenic, seasoned market, licence-clean, established demand. Avoid: family home, retirement, long-term, lifestyle, dream getaway, weekend retreat.

HARD RULES:
Never quote occupancy percentages, ADR, nightly rates, platform commission rates, or beach/airport distances unless they are in verified_facts. "Strong short-let demand in the area" is acceptable if the location is an established tourist market; "85% occupancy on Airbnb at €180 ADR" is forbidden unless explicitly verified. Do not claim a licence is in place unless verified.`,
    pl: `VOICE PATTERN:
Pisz operacyjnie, w języku danych i platform. Czytelnik ocenia jednostkę okiem operatora najmu krótkoterminowego: gotowość do zdjęć, czystość licencyjna, praktyczność rotacji. Prowadź narracją przydatności pod krótki najem, jeśli są dane o licencji lub gotowości. Pokazuj nieruchomość jako jednostkę produkującą od pierwszego tygodnia — meble w cenie, dokumentacja gotowa, dzielnica już w algorytmie. Zamknięcie pozycjonuje aktywo jako "produkujące w tygodniu pierwszym, nie szóstym miesiącu". Słownictwo preferowane: pod klucz, gotowy na platformę, operacyjny, udokumentowany, fotogeniczny, dojrzały rynek, czysta licencja, ustabilizowany popyt. Unikać: dom rodzinny, emerytura, długi termin, lifestyle, wymarzona ucieczka. W PL możesz odnosić się do rynków górskich/nadmorskich (Zakopane, Trójmiasto, Mazury) ogólnie — bez konkretów platform.

HARD RULES:
Nigdy nie cytuj obłożenia w %, ADR, stawek za noc, prowizji platform ani odległości do plaży/lotniska, jeśli nie ma ich w verified_facts. "Silny popyt na najem krótkoterminowy w okolicy" — tak, jeśli to ustabilizowany rynek turystyczny; "85% obłożenia na Airbnb przy 180 €" — zabronione bez weryfikacji. Nie twierdź, że licencja jest na miejscu, bez potwierdzenia.`,
    es: `VOICE PATTERN:
Escribe en clave operativa, con conciencia de datos y fluidez de plataforma. El lector evalúa la unidad como operador de alquiler turístico: idoneidad fotográfica, limpieza de licencia, practicidad de rotación. Lidera con idoneidad para corta estancia si hay datos de licencia o estado de la unidad. Presenta la propiedad como unidad que produce desde la semana uno — amueblada, documentación en orden, barrio ya consolidado en el algoritmo. El cierre la posiciona como "produciendo en semana uno, no en mes seis". Léxico preferido: llave en mano, lista para plataforma, operativa, documentada, fotogénica, mercado consolidado, licencia limpia, demanda asentada. Evitar: hogar familiar, jubilación, largo plazo, lifestyle, escapada soñada. En contexto ES, recuerda que la licencia VFT/VUT es competencia autonómica/municipal y a menudo limitada — referencia genérica a "licencia turística vigente" solo si verified_facts lo respalda.

HARD RULES:
Nunca cites % de ocupación, ADR, tarifas por noche, comisiones de plataforma ni distancias a playa/aeropuerto salvo en verified_facts. "Demanda fuerte de corta estancia en la zona" sí, si es mercado turístico consolidado; "85% de ocupación en Airbnb a 180 €" prohibido sin verificación. No afirmes que la licencia VFT/VUT está vigente sin verificación.`,
  },
};
