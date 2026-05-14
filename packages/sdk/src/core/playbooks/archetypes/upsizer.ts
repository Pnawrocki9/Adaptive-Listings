import type { PlaybookEntry } from '../types.js';

export const upsizerPlaybook: PlaybookEntry = {
  archetype: 'upsizer',
  description: 'Current homeowner trading up to more space or better location',
  slots: [
    {
      slot: 'headline',
      en: 'Upsize to {bedrooms}BR — {key_feature}',
      variants: {
        en: [
          'Upsize to {bedrooms}BR — {key_feature}',
          'More Space, Better Location — {bedrooms}BR with {key_feature}',
          'Your Next Move — Spacious {bedrooms}BR Home, Ready to Upgrade',
        ],
      },
    },
    { slot: 'cta', en: 'Compare Properties' },
    { slot: 'feature', en: 'Why Upgrade?' },
  ],
  listing_rules: {
    boost_if: ['larger_than_area_avg', 'premium_finish', 'good_location_score'],
    suppress_if: ['small_sqm', 'studio'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: ['sqm', 'bedrooms', 'location_score', 'finish_quality', 'garden', 'garage'],
  signals: [
    'filters_sqm_high',
    'views_4plus_bedrooms',
    'quiz:own_use+medium',
    'compares_multiple_large_listings',
  ],
  copy_template: {
    en: 'Everything your current home is not — and everything your next chapter demands. This {bedrooms}-bedroom property delivers the additional space that growing families and ambitious professionals consistently run out of. The {key_feature} was the deciding factor for the current owners when they bought; it will likely be yours too. Above-average square footage for the area means you stop feeling cramped within six months. The finish quality is high throughout, reducing the need for immediate renovation spend after purchase. The location scores well on every metric that matters for long-term ownership: transport, schools, amenities, and resale. For buyers who have outgrown their current home and want to make one move that lasts a decade, this property delivers.',
  },
};
