import type { PlaybookEntry } from '../types.js';

export const familyBuyerPlaybook: PlaybookEntry = {
  archetype: 'family_buyer',
  description: 'Family seeking space, schools, safety, and outdoor areas',
  slots: [
    {
      slot: 'headline',
      en: '{bedrooms}BR Family Home — {school_rating} School District',
      variants: {
        en: [
          '{bedrooms}BR Family Home — {school_rating} School District',
          'Spacious {bedrooms}-Bedroom Home Near Top-Rated Schools',
          'Family Living — {bedrooms}BR with Garden, Schools & Parks Nearby',
        ],
      },
    },
    { slot: 'cta', en: 'Get Family Buyer Guide' },
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
  copy_template: {
    en: "Perfectly positioned for growing families, this {bedrooms}-bedroom home sits within the {school_rating} catchment area — one of the neighbourhood's most sought-after advantages. A generous private garden provides safe outdoor space for children, while the quiet residential street keeps traffic and noise to a minimum. The layout flows naturally from open-plan kitchen-diner through to a spacious living room, with all bedrooms on the upper floor for privacy. Within walking distance: a primary school rated outstanding, a local park, and a small parade of shops. Storage is well considered throughout. Move-in ready with recent kitchen and bathroom upgrades. For families making a long-term commitment to an area, this home delivers the space, schools, and stability that matter most.",
  },
};
