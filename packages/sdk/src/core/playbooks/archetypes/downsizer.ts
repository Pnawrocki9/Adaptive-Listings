import type { PlaybookEntry } from '../types.js';

export const downsizerPlaybook: PlaybookEntry = {
  archetype: 'downsizer',
  description: 'Senior or empty-nester moving to smaller, more manageable property',
  slots: [
    {
      slot: 'headline',
      en: 'Easy Living — {bedrooms}BR with Lift & No Garden Maintenance',
    },
    { slot: 'feature', en: 'Downsizer Friendly' },
  ],
  listing_rules: {
    boost_if: ['lift_available', 'low_maintenance', 'ground_floor_or_lift', 'accessible'],
    suppress_if: ['large_garden', 'steep_access', 'multi_story_no_lift'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'accessibility',
    'lift',
    'maintenance_costs',
    'heating_efficiency',
    'proximity_to_amenities',
  ],
  signals: [
    'filters_sqm_low',
    'views_accessible_listings',
    'quiz:own_use+long',
    'clicks_accessibility_info',
  ],
};
