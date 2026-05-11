import type { PlaybookEntry } from '../types.js';

export const familyBuyerPlaybook: PlaybookEntry = {
  archetype: 'family_buyer',
  description: 'Family seeking space, schools, safety, and outdoor areas',
  slots: [
    { slot: 'headline', en: '{bedrooms}BR Family Home — {school_rating} School District' },
    { slot: 'feature', en: 'Family Essentials' },
  ],
  listing_rules: {
    boost_if: ['good_school_district', 'garden_or_yard', '3plus_bedrooms', 'quiet_street'],
    suppress_if: ['studio', '1_bedroom', 'commercial_area'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'bedrooms',
    'school_rating',
    'garden_size',
    'nearby_parks',
    'safety_score',
    'storage',
  ],
  signals: [
    'filters_3plus_bedrooms',
    'clicks_school_info',
    'views_garden_photos',
    'quiz:own_use+long',
  ],
};
