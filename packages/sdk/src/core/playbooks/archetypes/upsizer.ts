import type { PlaybookEntry } from '../types.js';

export const upsizerPlaybook: PlaybookEntry = {
  archetype: 'upsizer',
  description: 'Current homeowner trading up to more space or better location',
  slots: [
    { slot: 'headline', en: 'Upsize to {bedrooms}BR — {key_feature}' },
    { slot: 'feature', en: 'Why Upgrade?' },
  ],
  listing_rules: {
    boost_if: ['larger_than_area_avg', 'premium_finish', 'good_location_score'],
    suppress_if: ['small_sqm', 'studio'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: ['sqm', 'bedrooms', 'location_score', 'finish_quality', 'garden', 'garage'],
  signals: [
    'filters_sqm_high',
    'views_4plus_bedrooms',
    'quiz:own_use+medium',
    'compares_multiple_large_listings',
  ],
};
