import type { PlaybookEntry } from '../types.js';

export const flipInvestorPlaybook: PlaybookEntry = {
  archetype: 'flip_investor',
  description: 'Fix & flip investor seeking below-market properties with upside potential',
  slots: [
    {
      slot: 'headline',
      en: 'Below Market Value — Renovation Opportunity',
      variants: {
        en: [
          'Below Market Value — Renovation Opportunity',
          'Motivated Seller — Below Market, Full Renovation Potential',
          'Fix & Flip Candidate — Est. ARV {arv} After Works',
        ],
      },
    },
    { slot: 'cta', en: 'Get Renovation Report' },
    { slot: 'feature', en: 'Estimated ARV: {arv}' },
  ],
  listing_rules: {
    boost_if: ['price_below_area_median', 'needs_renovation', 'motivated_seller'],
    suppress_if: ['premium_finished', 'price_above_median'],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'price_vs_market',
    'condition',
    'renovation_estimate',
    'arv_estimate',
    'days_on_market',
  ],
  signals: [
    'filters_by_price_low',
    'views_older_listings',
    'quiz:investment+short',
    'clicks_price_history',
  ],
  copy_template: {
    en: 'Priced below the area median with full renovation potential, this property represents a classic fix-and-flip opportunity for experienced investors. The bones are solid — original period features, good room proportions, and a structural survey showing no major issues. The dated interior is the discount. Estimated renovation costs of {renovation_estimate} would bring the property to a modern standard, with comparable finished properties in the street trading at {arv}. Days on market suggest a motivated vendor. Planning permission for a loft conversion is available, adding further value upside. For investors who know their numbers and move quickly, this is the kind of below-market entry point that rarely reaches open listings.',
  },
};
