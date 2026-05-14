import type { PlaybookEntry } from '../types.js';

export const yieldHunterPlaybook: PlaybookEntry = {
  archetype: 'yield_hunter',
  description: 'Long-term investor maximizing rental cashflow and ROI',
  slots: [
    {
      slot: 'headline',
      en: 'Rental Yield: {yield}% | Gross Income: {income}/yr',
      variants: {
        en: [
          'Rental Yield: {yield}% | Gross Income: {income}/yr',
          'Investment Property — {yield}% Gross Yield, Tenant in Place',
          'Passive Income: {income}/yr — Cash-Flow Positive from Day One',
        ],
      },
    },
    { slot: 'cta', en: 'Request Investment Pack' },
    { slot: 'feature', en: 'Investment Performance' },
  ],
  listing_rules: {
    boost_if: ['has_rental_income', 'yield_data_available'],
    suppress_if: ['no_rental_allowed', 'hoa_restricts_rental'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'rental_yield',
    'gross_annual_income',
    'occupancy_rate',
    'price_per_sqm',
    'management_fees',
  ],
  signals: [
    'views_yield_data',
    'clicks_rental_calculator',
    'long_dwell_on_financials',
    'quiz:investment+long',
  ],
  copy_template: {
    en: 'This income-producing property is built for investors who measure success in yield, not lifestyle features. With {yield}% gross return and estimated annual rental income of {income}, the numbers stack from day one. A sitting tenant on a rolling contract minimises void risk and provides immediate cash flow. Price per square metre is competitive relative to the local average, with scope to renegotiate lease terms at renewal. A professional management company is available for fully hands-off ownership. Capital growth is supported by strong local rental demand and improving area infrastructure. For yield-focused investors, this is a straightforward, low-friction income asset that performs consistently regardless of wider market sentiment.',
  },
};
