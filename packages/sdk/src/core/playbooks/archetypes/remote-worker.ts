import type { PlaybookEntry } from '../types.js';

export const remoteWorkerPlaybook: PlaybookEntry = {
  archetype: 'remote_worker',
  description: 'Location-independent professional prioritizing home office and connectivity',
  slots: [
    {
      slot: 'headline',
      en: 'Work From Home — Dedicated Office Space | {internet_speed}Mbps Fibre',
      variants: {
        en: [
          'Work From Home — Dedicated Office Space | {internet_speed}Mbps Fibre',
          'Remote-Ready Home — Private Office, {internet_speed}Mbps Broadband',
          'Work Anywhere — Dedicated Study, Fibre Broadband & Natural Light',
        ],
      },
    },
    { slot: 'cta', en: 'Check Connectivity' },
    { slot: 'feature', en: 'Remote Work Ready' },
  ],
  listing_rules: {
    boost_if: ['dedicated_office_room', 'fibre_available', 'quiet_area', 'good_natural_light'],
    suppress_if: ['no_office_space', 'poor_connectivity'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'dedicated_office',
    'internet_speed',
    'natural_light',
    'noise_level',
    'co_working_nearby',
  ],
  signals: [
    'searches_office_space',
    'clicks_connectivity_info',
    'views_desk_room_photos',
    'quiz:own_use+any',
  ],
  copy_template: {
    en: "Built for the location-independent professional, this home prioritises the two things remote workers can't compromise on: dedicated workspace and fast connectivity. A separate study provides a proper door-closing separation between work and living, essential for focus and video calls. {internet_speed}Mbps full-fibre broadband is already installed. Natural light floods the main working area throughout the morning, reducing eye strain during long working days. The living spaces are equally well considered — generous enough to decompress after work, calm enough to stay focused during it. A co-working café is five minutes away for the days when variety helps. For remote workers tired of converting dining tables into desks, this home was designed with your working life in mind.",
  },
};
