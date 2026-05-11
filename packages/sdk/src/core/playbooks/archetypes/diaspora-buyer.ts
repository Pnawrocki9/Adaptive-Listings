import type { PlaybookEntry } from '../types.js';

export const diasporaBuyerPlaybook: PlaybookEntry = {
  archetype: 'diaspora_buyer',
  description:
    'Buying in home country from abroad — remote purchase, legal navigation, family context',
  slots: [
    { slot: 'headline', en: 'Buy From Abroad — Remote Purchase Support Available' },
    { slot: 'cta', en: 'Speak with a Diaspora Specialist' },
  ],
  listing_rules: {
    boost_if: ['remote_purchase_supported', 'legal_support_available', 'family_area'],
    suppress_if: [],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'remote_purchase_process',
    'legal_support',
    'family_area',
    'price',
    'developer_reliability',
  ],
  signals: [
    'international_ip_country_mismatch',
    'views_legal_content',
    'off_hours_browsing',
    'quiz:own_use+any',
  ],
};
