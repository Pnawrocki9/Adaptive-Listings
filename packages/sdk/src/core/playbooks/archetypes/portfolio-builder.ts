import type { PlaybookEntry } from '../types.js';

export const portfolioBuilderPlaybook: PlaybookEntry = {
  archetype: 'portfolio_builder',
  description: 'Experienced investor scaling a multi-property portfolio',
  slots: [
    {
      slot: 'headline',
      en: 'Portfolio Addition — {bedrooms}BR | {yield}% Yield',
      variants: {
        en: [
          'Portfolio Addition — {bedrooms}BR | {yield}% Yield',
          'Scalable Asset — {bedrooms}BR, {yield}% Yield, Management Available',
          'Multi-Property Play — Bulk Discount Available | {yield}% Return',
        ],
      },
    },
    { slot: 'cta', en: 'Request Bulk Enquiry' },
    { slot: 'feature', en: 'Portfolio Metrics' },
  ],
  listing_rules: {
    boost_if: [
      'multiple_units_available',
      'bulk_discount_possible',
      'management_company_available',
    ],
    suppress_if: [],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'price_per_unit',
    'yield',
    'management_available',
    'bulk_availability',
    'legal_status',
  ],
  signals: [
    'views_multiple_listings_same_building',
    'long_session',
    'quiz:investment+long',
    'returns_multiple_times',
  ],
  copy_template: {
    en: 'A {bedrooms}-bedroom investment property delivering {yield}% yield — sized and priced as a natural addition to a growing residential portfolio. Multiple units are available within the same development, making this suitable for block acquisition with a negotiated bulk discount. A professional management company already operates the building, enabling seamless integration with an existing portfolio without additional operational overhead. Clean legal status with no outstanding charges. Title deed is unencumbered and ready for immediate transfer. For portfolio builders targeting scale and operational simplicity, this development offers the combination of yield, management infrastructure, and bulk availability that makes meaningful portfolio growth achievable without proportional increases in management time.',
  },
};
