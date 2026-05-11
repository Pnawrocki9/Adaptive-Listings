import type { PlaybookEntry } from '../types.js';

export const retireeRelocatorPlaybook: PlaybookEntry = {
  archetype: 'retiree_relocator',
  description: 'Retiree seeking warm climate, healthcare access, low cost of living',
  slots: [
    {
      slot: 'headline',
      en: 'Retire in the Sun — Healthcare {minutes}min | {climate} Climate',
    },
    { slot: 'cta', en: 'Download Retirement Living Guide' },
  ],
  listing_rules: {
    boost_if: ['warm_climate', 'healthcare_nearby', 'low_maintenance', 'expat_retiree_community'],
    suppress_if: ['cold_region', 'remote_location'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'healthcare_proximity',
    'climate',
    'low_maintenance',
    'expat_community',
    'cost_of_living',
    'accessibility',
  ],
  signals: [
    'international_ip',
    'views_retirement_content',
    'filters_accessible',
    'quiz:own_use+long',
    'older_device_patterns',
  ],
};
