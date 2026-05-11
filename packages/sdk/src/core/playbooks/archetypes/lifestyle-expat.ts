import type { PlaybookEntry } from '../types.js';

export const lifestyleExpatPlaybook: PlaybookEntry = {
  archetype: 'lifestyle_expat',
  description:
    'Relocating from another country, prioritizing integration, lifestyle, and community',
  slots: [
    {
      slot: 'headline',
      en: 'Expat Community — {neighborhood} | International Schools Nearby',
    },
    { slot: 'cta', en: 'Download Expat Relocation Guide' },
  ],
  listing_rules: {
    boost_if: ['expat_community_area', 'international_schools', 'english_speaking_area'],
    suppress_if: [],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'expat_community',
    'international_schools',
    'english_services',
    'neighborhood_guide',
    'healthcare',
  ],
  signals: [
    'international_ip',
    'views_neighborhood_content',
    'clicks_schools',
    'quiz:own_use+long',
    'googles_expat_terms',
  ],
};
