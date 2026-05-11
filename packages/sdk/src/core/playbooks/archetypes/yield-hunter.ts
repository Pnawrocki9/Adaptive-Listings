import type { PlaybookEntry } from '../types.js';

export const yieldHunterPlaybook: PlaybookEntry = {
  archetype: 'yield_hunter',
  description: 'Long-term investor maximizing rental cashflow and ROI',
  slots: [
    { slot: 'headline', en: 'Rental Yield: {yield}% | Gross Income: {income}/yr' },
    { slot: 'feature-section', en: 'Investment Performance' },
  ],
  listing_rules: {
    boost_if: ['has_rental_income', 'yield_data_available'],
    suppress_if: ['no_rental_allowed', 'hoa_restricts_rental'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'rental_yield',
    'gross_annual_income',
    'occupancy_rate',
    'price_per_sqm',
    'management_fees',
  ],
  signals: [
    'views_yield_data',
    'clicks_rental_calculator',
    'long_dwell_on_financials',
    'quiz:investment+long',
  ],
};
