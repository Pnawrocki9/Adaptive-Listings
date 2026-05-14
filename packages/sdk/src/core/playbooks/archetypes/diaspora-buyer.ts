import type { PlaybookEntry } from '../types.js';

export const diasporaBuyerPlaybook: PlaybookEntry = {
  archetype: 'diaspora_buyer',
  description:
    'Buying in home country from abroad — remote purchase, legal navigation, family context',
  slots: [
    {
      slot: 'headline',
      en: 'Buy From Abroad — Remote Purchase Support Available',
      variants: {
        en: [
          'Buy From Abroad — Remote Purchase Support Available',
          'Remote Purchase Made Easy — English-Speaking Legal Team',
          'Buy From Overseas — End-to-End Support, No Need to Travel',
        ],
      },
    },
    { slot: 'cta', en: 'Speak with a Diaspora Specialist' },
    { slot: 'feature', en: 'Remote Purchase Guide' },
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
  copy_template: {
    en: 'Buying property in your home country while living abroad is more straightforward than most diaspora buyers expect — when the right support is in place. This property comes with a dedicated team experienced in remote transactions: English-speaking solicitors, power of attorney services, and a bilingual agent who has guided overseas buyers through every step of the process dozens of times. Virtual tours, video walkthroughs, and remote signing are all available. The area has strong family roots — established schools, a close-knit community, and good public transport links. Title is clean and the transaction timeline is predictable. For diaspora buyers who want to reconnect with home or provide for family still living there, this is the purchase made straightforward.',
  },
};
