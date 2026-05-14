import type { PlaybookEntry } from '../types.js';

export const goldenVisaBuyerPlaybook: PlaybookEntry = {
  archetype: 'golden_visa_buyer',
  description:
    'High-net-worth buyer seeking residency/citizenship via real estate investment (CY, ES)',
  slots: [
    {
      slot: 'headline',
      en: 'Golden Visa Eligible — Investment from €{threshold}',
      variants: {
        en: [
          'Golden Visa Eligible — Investment from €{threshold}',
          'Residency by Investment — Qualify from €{threshold}',
          'Golden Visa Property — Premium Development, Fast Track Residency',
        ],
      },
    },
    { slot: 'cta', en: 'Download Golden Visa Guide' },
    { slot: 'feature', en: 'Residency Requirements' },
  ],
  listing_rules: {
    boost_if: ['golden_visa_eligible', 'price_above_250k_eur', 'new_development'],
    suppress_if: ['price_below_threshold'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'golden_visa_eligibility',
    'price',
    'new_development',
    'developer_reputation',
    'completion_date',
  ],
  signals: [
    'filters_price_high',
    'views_new_developments',
    'searches_visa_terms',
    'international_ip',
  ],
  copy_template: {
    en: 'This premium development meets the investment threshold for the Golden Visa programme, offering a clear pathway to residency for qualifying buyers. Priced from €{threshold}, the property qualifies without additional structuring. Developed by a government-approved developer with a strong track record of on-time delivery, the project provides the legal certainty and documentation required by immigration authorities. Full title deed available on completion. The development combines strong lifestyle credentials with the investment security that visa-seeking buyers require. Legal support and immigration specialists are available to guide buyers through the application process from purchase to residency approval within the programme timeline.',
  },
};
