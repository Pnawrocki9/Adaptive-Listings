import type { PlaybookEntry } from '../types.js';

export const firstTimeBuyerPlaybook: PlaybookEntry = {
  archetype: 'first_time_buyer',
  description: 'First-time buyer navigating mortgage, budget, and unfamiliar process',
  slots: [
    {
      slot: 'headline',
      en: 'First Home — Monthly from {monthly_payment}',
      variants: {
        en: [
          'First Home — Monthly from {monthly_payment}',
          'Your First Home — Mortgage-Ready, Move-In Condition',
          'Step on the Ladder — First-Time Buyer Schemes Available',
        ],
      },
    },
    { slot: 'cta', en: 'Get First-Time Buyer Guide' },
    { slot: 'feature', en: 'Your First Step' },
  ],
  listing_rules: {
    boost_if: ['starter_home', 'price_below_area_median', 'move_in_ready', 'ftb_scheme_eligible'],
    suppress_if: ['renovation_needed', 'price_above_median'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'monthly_mortgage_estimate',
    'ftb_scheme_eligible',
    'condition',
    'total_costs',
    'school_proximity',
  ],
  signals: [
    'views_mortgage_calculator',
    'clicks_ftb_content',
    'price_filters_low',
    'quiz:own_use+long',
    'long_dwell_on_financing',
  ],
  copy_template: {
    en: 'An ideal first step onto the property ladder, this well-presented home is priced below the area median and qualifies for first-time buyer schemes, making the journey from renting to owning more straightforward. Monthly mortgage payments from {monthly_payment} are comparable to local rents, and the property is fully move-in ready — no renovation budget required. The open-plan living area feels generous for the size, and the kitchen was updated recently. Transport links are strong, with the high street five minutes on foot. The vendor is motivated and open to a smooth, quick exchange. For buyers navigating the process for the first time, this property removes complexity and delivers a clean, achievable purchase without hidden costs.',
  },
};
