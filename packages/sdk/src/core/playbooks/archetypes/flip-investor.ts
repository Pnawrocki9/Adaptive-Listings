import type { PlaybookEntry } from '../types.js';

export const flipInvestorPlaybook: PlaybookEntry = {
  archetype: 'flip_investor',
  description: 'Fix & flip investor seeking below-market properties with upside potential',
  slots: [
    { slot: 'headline', en: 'Below Market Value — Renovation Opportunity' },
    { slot: 'feature', en: 'Estimated ARV: {arv}' },
  ],
  listing_rules: {
    boost_if: ['price_below_area_median', 'needs_renovation', 'motivated_seller'],
    suppress_if: ['premium_finished', 'price_above_median'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'price_vs_market',
    'condition',
    'renovation_estimate',
    'arv_estimate',
    'days_on_market',
  ],
  signals: [
    'filters_by_price_low',
    'views_older_listings',
    'quiz:investment+short',
    'clicks_price_history',
  ],
};
