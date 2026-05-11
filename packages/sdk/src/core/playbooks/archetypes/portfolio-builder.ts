import type { PlaybookEntry } from '../types.js';

export const portfolioBuilderPlaybook: PlaybookEntry = {
  archetype: 'portfolio_builder',
  description: 'Experienced investor scaling a multi-property portfolio',
  slots: [
    { slot: 'headline', en: 'Portfolio Addition — {bedrooms}BR | {yield}% Yield' },
    { slot: 'cta', en: 'Request Bulk Enquiry' },
  ],
  listing_rules: {
    boost_if: [
      'multiple_units_available',
      'bulk_discount_possible',
      'management_company_available',
    ],
    suppress_if: [],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'price_per_unit',
    'yield',
    'management_available',
    'bulk_availability',
    'legal_status',
  ],
  signals: [
    'views_multiple_listings_same_building',
    'long_session',
    'quiz:investment+long',
    'returns_multiple_times',
  ],
};
