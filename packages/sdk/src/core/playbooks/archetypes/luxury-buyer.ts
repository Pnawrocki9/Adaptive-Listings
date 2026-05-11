import type { PlaybookEntry } from '../types.js';

export const luxuryBuyerPlaybook: PlaybookEntry = {
  archetype: 'luxury_buyer',
  description: 'High-end buyer seeking prestige, premium finishes, and lifestyle',
  slots: [
    { slot: 'headline', en: 'Exceptional Residence — {key_luxury_feature}' },
    { slot: 'cta', en: 'Request Private Viewing' },
  ],
  listing_rules: {
    boost_if: ['luxury_tier', 'price_top_10pct', 'premium_developer', 'concierge_services'],
    suppress_if: ['standard_finish', 'price_below_luxury_threshold'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: ['premium_features', 'finishes', 'views', 'privacy', 'concierge', 'smart_home'],
  signals: [
    'filters_price_high',
    'views_luxury_developments',
    'long_dwell_on_premium_photos',
    'quiz:own_use+any',
  ],
};
