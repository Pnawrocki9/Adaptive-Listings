import type { PlaybookEntry } from '../types.js';

export const firstTimeBuyerPlaybook: PlaybookEntry = {
  archetype: 'first_time_buyer',
  description: 'First-time buyer navigating mortgage, budget, and unfamiliar process',
  slots: [
    { slot: 'headline', en: 'First Home — Monthly from {monthly_payment}' },
    { slot: 'cta', en: 'Get First-Time Buyer Guide' },
    { slot: 'feature', en: 'Your First Step' },
  ],
  listing_rules: {
    boost_if: ['starter_home', 'price_below_area_median', 'move_in_ready', 'ftb_scheme_eligible'],
    suppress_if: ['renovation_needed', 'price_above_median'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'monthly_mortgage_estimate',
    'ftb_scheme_eligible',
    'condition',
    'total_costs',
    'school_proximity',
  ],
  signals: [
    'views_mortgage_calculator',
    'clicks_ftb_content',
    'price_filters_low',
    'quiz:own_use+long',
    'long_dwell_on_financing',
  ],
};
