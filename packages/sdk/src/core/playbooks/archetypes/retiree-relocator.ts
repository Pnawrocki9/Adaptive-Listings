import type { PlaybookEntry } from '../types.js';

export const retireeRelocatorPlaybook: PlaybookEntry = {
  archetype: 'retiree_relocator',
  description: 'Retiree seeking warm climate, healthcare access, low cost of living',
  slots: [
    {
      slot: 'headline',
      en: 'Retire in the Sun — Healthcare {minutes}min | {climate} Climate',
      variants: {
        en: [
          'Retire in the Sun — Healthcare {minutes}min | {climate} Climate',
          'Retire Abroad — Warm Climate, Healthcare Close, Low Cost of Living',
          'Golden Years Living — {climate} Climate, Expat Retiree Community',
        ],
      },
    },
    { slot: 'cta', en: 'Download Retirement Living Guide' },
    { slot: 'feature', en: 'Retirement Living Highlights' },
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
  copy_template: {
    en: 'Everything a thoughtful retirement relocation demands: a {climate} climate with over 300 days of sunshine annually, a private hospital {minutes} minutes away, and a thriving expat retiree community that has been building here for decades. The cost of living runs at roughly 40% below northern Europe, making pension income stretch significantly further. The property itself is single-storey, fully accessible, and low maintenance — no steep staircases, no large garden, no surprises. English is widely spoken throughout the area and services are oriented toward international residents. Regular direct flights connect to major European hubs, making it easy to visit family or return briefly when needed. For retirees who want sunshine, security, and community, this location consistently tops the rankings.',
  },
};
