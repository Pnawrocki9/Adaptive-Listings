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
    en: 'The holiday home you have been planning: {location_highlight}, sold furnished and ready to use from the first weekend. The property has been well maintained with no immediate capital outlay required. When not in use, short-term holiday rental is permitted and the location supports competitive nightly rates through the season. A local management company handles cleaning, key handover, and minor maintenance, so ownership is uncomplicated from a distance. Transport links to the nearest city and airport are reliable enough to make spontaneous weekend trips practical. The running costs are modest compared to the enjoyment value. For buyers who want a genuine escape that also makes financial sense, this second home earns its place both in use and on paper.',
  },
};
