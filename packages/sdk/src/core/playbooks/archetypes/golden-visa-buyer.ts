import type { PlaybookEntry } from '../types.js';

export const goldenVisaBuyerPlaybook: PlaybookEntry = {
  archetype: 'golden_visa_buyer',
  description:
    'High-net-worth buyer seeking residency/citizenship via real estate investment (CY, ES)',
  slots: [
    { slot: 'headline', en: 'Golden Visa Eligible — Investment from €{threshold}' },
    { slot: 'cta', en: 'Download Golden Visa Guide' },
  ],
  listing_rules: {
    boost_if: ['golden_visa_eligible', 'price_above_250k_eur', 'new_development'],
    suppress_if: ['price_below_threshold'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'golden_visa_eligibility',
    'price',
    'new_development',
    'developer_reputation',
    'completion_date',
  ],
  signals: [
    'filters_price_high',
    'views_new_developments',
    'searches_visa_terms',
    'international_ip',
  ],
};
