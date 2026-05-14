import type { PlaybookEntry } from '../types.js';

export const vacationRentalInvestorPlaybook: PlaybookEntry = {
  archetype: 'vacation_rental_investor',
  description: 'Short-term rental investor targeting Airbnb/holiday markets (ES, CY focus)',
  slots: [
    {
      slot: 'headline',
      en: 'Airbnb Potential: {nightly_rate}/night est.',
      variants: {
        en: [
          'Airbnb Potential: {nightly_rate}/night est.',
          'Short-Term Rental Investment — {nightly_rate}/night Peak Season',
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
    en: 'This property holds an active tourist licence and is positioned in a high-demand short-term rental zone, with estimated nightly rates of {nightly_rate} during peak season. The beach is within {beach_distance} and the international airport is under 40 minutes away — the two factors that consistently drive occupancy rates above 80% in this location. The property is sold fully furnished and ready to list immediately on short-term rental platforms, removing the setup delay that typically costs investors the first profitable season. A local holiday management company is available for end-to-end guest operations. For investors targeting short-term rental income in a proven tourist market, this is a licence-secured, operationally ready asset.',
  },
};
