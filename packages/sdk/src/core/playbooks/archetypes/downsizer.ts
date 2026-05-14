import type { PlaybookEntry } from '../types.js';

export const downsizerPlaybook: PlaybookEntry = {
  archetype: 'downsizer',
  description: 'Senior or empty-nester moving to smaller, more manageable property',
  slots: [
    {
      slot: 'headline',
      en: 'Easy Living — {bedrooms}BR with Lift & No Garden Maintenance',
      variants: {
        en: [
          'Easy Living — {bedrooms}BR with Lift & No Garden Maintenance',
          'Right-Size Your Life — {bedrooms}BR, Low Maintenance, Lift Access',
          'Managed Living — {bedrooms}BR, No Garden Hassle, All Inclusive',
        ],
      },
    },
    { slot: 'cta', en: 'Book a Viewing' },
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
  copy_template: {
    en: 'For those ready to trade space for simplicity, this {bedrooms}-bedroom apartment delivers exactly what the next chapter of life demands. Lift access to all floors removes the daily negotiation with stairs. There is no garden to maintain — just a private balcony for morning coffee. The service charge covers building maintenance, cleaning of communal areas, and buildings insurance, creating predictable monthly costs. Heating is efficient and the property is double-glazed throughout. Shops, a pharmacy, and a GP surgery are all within a short, flat walk. The layout is practical rather than sprawling, designed for the way people actually live rather than for square footage metrics. For empty-nesters and retirees who want comfort without complexity, this property makes the transition genuinely appealing.',
  },
};
