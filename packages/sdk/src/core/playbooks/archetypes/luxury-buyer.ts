import type { PlaybookEntry } from '../types.js';

export const luxuryBuyerPlaybook: PlaybookEntry = {
  archetype: 'luxury_buyer',
  description: 'High-end buyer seeking prestige, premium finishes, and lifestyle',
  slots: [
    {
      slot: 'headline',
      en: 'Exceptional Residence — {key_luxury_feature}',
      variants: {
        en: [
          'Exceptional Residence — {key_luxury_feature}',
          'Premium Residence — Exclusive Finishes, Concierge Services',
          'Prestige Collection — {key_luxury_feature}, Private Viewings Only',
        ],
      },
    },
    { slot: 'cta', en: 'Request Private Viewing' },
    { slot: 'feature', en: 'Premium Highlights' },
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
  copy_template: {
    en: 'An exceptional residence where architectural distinction meets uncompromising quality. {key_luxury_feature} sets this property apart from the rest of the market. Every surface reflects considered design: imported stone, bespoke joinery, and integrated smart home systems throughout. Floor-to-ceiling glazing frames panoramic views that shift with the light. A dedicated concierge service manages everything from maintenance scheduling to private event coordination. Underground secure parking, wine cellar, and private gym complete the specification. Discretely located within a prestigious address, yet moments from the cultural and culinary landmarks that define the city. For buyers who accept nothing less than the finest, this residence is offered by private appointment only.',
  },
};
