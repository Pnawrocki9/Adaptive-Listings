import type { PlaybookEntry } from '../types.js';

export const studentParentPlaybook: PlaybookEntry = {
  archetype: 'student_parent',
  description: 'Parent buying for a child at university — investment-meets-own-use hybrid',
  slots: [
    {
      slot: 'headline',
      en: 'Student Investment — Near {university} | Let While Studying',
    },
    { slot: 'cta', en: 'Calculate Student Rental Return' },
  ],
  listing_rules: {
    boost_if: ['near_university', 'student_area', 'rental_possible', 'small_manageable'],
    suppress_if: ['far_from_university', 'luxury_tier'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'distance_to_university',
    'rental_yield_student',
    'condition',
    'security',
    'transport',
  ],
  signals: [
    'searches_university_proximity',
    'views_small_listings',
    'clicks_rental_calc',
    'quiz:investment+medium',
  ],
};
