import type { PlaybookEntry } from '../types.js';

export const commercialInvestorPlaybook: PlaybookEntry = {
  archetype: 'commercial_investor',
  description: 'Commercial property investor (offices, retail, warehouses)',
  slots: [
    { slot: 'headline', en: 'Commercial Investment — {sqm}m² | {yield}% Gross Yield' },
    { slot: 'cta', en: 'Request Commercial Pack' },
  ],
  listing_rules: {
    boost_if: ['commercial_zoning', 'rental_tenant_in_place', 'triple_net_lease'],
    suppress_if: ['residential_only'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'commercial_zoning',
    'current_tenant',
    'lease_terms',
    'gross_yield',
    'cap_rate',
  ],
  signals: [
    'searches_commercial',
    'views_large_sqm',
    'clicks_zoning_info',
    'filters_commercial_type',
  ],
};
