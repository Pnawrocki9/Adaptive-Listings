import type { PlaybookEntry } from '../types.js';

export const secondHomeBuyerPlaybook: PlaybookEntry = {
  archetype: 'second_home_buyer',
  description: 'Buying a holiday or weekend home alongside primary residence',
  slots: [
    { slot: 'headline', en: 'Your Holiday Home — {location_highlight}' },
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
};
