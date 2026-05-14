import type { PlaybookEntry } from '../types.js';

export const commercialInvestorPlaybook: PlaybookEntry = {
  archetype: 'commercial_investor',
  description: 'Commercial property investor (offices, retail, warehouses)',
  slots: [
    {
      slot: 'headline',
      en: 'Commercial Investment — {sqm}m² | {yield}% Gross Yield',
      variants: {
        en: [
          'Commercial Investment — {sqm}m² | {yield}% Gross Yield',
          'Income-Producing Commercial Asset — {yield}% Net Yield',
          'Office/Retail Investment — Triple Net Lease, Stable Returns',
        ],
      },
    },
    { slot: 'cta', en: 'Request Commercial Pack' },
    { slot: 'feature', en: 'Commercial Due Diligence Pack' },
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
  copy_template: {
    en: 'A {sqm}m² commercial asset delivering {yield}% gross yield with an established tenant and long-term lease in place. Zoned for commercial use with planning consent for the current operation, providing legal certainty for investors. Triple net lease structure means the tenant covers outgoings, giving the owner predictable net income without management burden. The building has been maintained to a high standard with no deferred capital expenditure identified. Located in a well-trafficked commercial district with strong footfall and excellent road access. For investors targeting stable, income-producing commercial real estate in a proven trading location, this property offers institutional-quality returns at an accessible entry price.',
  },
};
