import type { PlaybookEntry } from '../types.js';

export const lifestyleExpatPlaybook: PlaybookEntry = {
  archetype: 'lifestyle_expat',
  description:
    'Relocating from another country, prioritizing integration, lifestyle, and community',
  slots: [
    {
      slot: 'headline',
      en: 'Expat Community — {neighborhood} | International Schools Nearby',
      variants: {
        en: [
          'Expat Community — {neighborhood} | International Schools Nearby',
          'International Living — English Services, Expat Network Active',
          'Relocation Ready — {neighborhood} | Schools, Healthcare & Expat Community',
        ],
      },
    },
    { slot: 'cta', en: 'Download Expat Relocation Guide' },
    { slot: 'feature', en: 'Expat Essentials' },
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
  copy_template: {
    en: "Positioned at the heart of {neighborhood}, one of the area's most established expat communities, this home makes international relocation feel manageable rather than daunting. International schools serving multiple curricula are within a short drive. English-speaking estate agents, lawyers, and medical practitioners operate throughout the area. The neighbourhood has a well-developed network of relocation support services and an active expat social scene. Public transport connections are reliable, and the international airport is accessible in under an hour. The property itself is move-in ready with all utilities in place. For professionals and families relocating from abroad, this address offers community, convenience, and a genuine sense of welcome from day one.",
  },
};
