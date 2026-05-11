import type { PlaybookEntry } from '../types.js';

export const vacationRentalInvestorPlaybook: PlaybookEntry = {
  archetype: 'vacation_rental_investor',
  description: 'Short-term rental investor targeting Airbnb/holiday markets (ES, CY focus)',
  slots: [
    { slot: 'headline', en: 'Airbnb Potential: {nightly_rate}/night est.' },
    { slot: 'cta', en: 'See Short-Term Rental Projections' },
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
};
