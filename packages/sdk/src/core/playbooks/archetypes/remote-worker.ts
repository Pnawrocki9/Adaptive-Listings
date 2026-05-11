import type { PlaybookEntry } from '../types.js';

export const remoteWorkerPlaybook: PlaybookEntry = {
  archetype: 'remote_worker',
  description: 'Location-independent professional prioritizing home office and connectivity',
  slots: [
    {
      slot: 'headline',
      en: 'Work From Home — Dedicated Office Space | {internet_speed}Mbps Fibre',
    },
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
};
