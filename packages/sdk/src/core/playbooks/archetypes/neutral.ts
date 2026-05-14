import type { PlaybookEntry } from '../types.js';

/** Neutral fallback — no adaptation applied. Used when archetype is unclassified. */
export const neutralPlaybook: PlaybookEntry = {
  archetype: 'neutral',
  description: 'Unclassified — no adaptation applied',
  slots: [],
  listing_rules: {
    boost_if: [],
    suppress_if: [],
    boost_class: '',
    suppress_class: '',
  },
  feature_priority: [],
  signals: [],
  copy_template: { en: '' },
};
