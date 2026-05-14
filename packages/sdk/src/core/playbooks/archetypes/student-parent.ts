import type { PlaybookEntry } from '../types.js';

export const studentParentPlaybook: PlaybookEntry = {
  archetype: 'student_parent',
  description: 'Parent buying for a child at university — investment-meets-own-use hybrid',
  slots: [
    {
      slot: 'headline',
      en: 'Student Investment — Near {university} | Let While Studying',
      variants: {
        en: [
          'Student Investment — Near {university} | Let While Studying',
          'University Property — {university} Area, Rental Income While Child Studies',
          'Smart Student Buy — Near {university}, Covers Fees Through Rental',
        ],
      },
    },
    { slot: 'cta', en: 'Calculate Student Rental Return' },
    { slot: 'feature', en: 'Student Area Insights' },
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
  copy_template: {
    en: 'A well-located property {distance_to_university} from the main {university} campus — close enough to be genuinely convenient, far enough to avoid the noisiest student streets. The purchase model works as follows: your child occupies the master bedroom while housemates cover the majority of the mortgage through shared rental. On graduation, the property either continues as a rental income asset or is sold, with capital growth typical of the student property market in this city. The property is in good condition and complies with current HMO standards. A letting agent experienced in student tenancies is available to manage the property if preferred. For parents seeking to support their child at university while building a tangible asset, this is the dual-purpose purchase that consistently delivers.',
  },
};
