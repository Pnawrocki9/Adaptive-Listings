/**
 * The SDK's pre-FOLLOW-1357 built-in quiz tree (ADR-0019 D5/D6: 17 non-neutral leaves + the
 * neutral skip), kept verbatim as a TEST FIXTURE when the v3.0 tree replaced it as the built-in.
 *
 * Why it is still pinned: tenants may hold a served `quiz_definitions` row authored to this
 * shape (the old override scheme, weight 2 on Q3), and the shared walker must keep resolving it
 * exactly as the old inline walker did (`quiz-legacy-path-table.test.ts`,
 * `quiz-widget.test.ts`). Copied from `packages/sdk/src/ui/quiz-widget.ts` at `5de4ff9b`.
 */

import type { QuizDefinition } from '@estalara/shared';

export const LEGACY_QUIZ_DEFINITION: QuizDefinition = {
  schema_version: 1,
  root: 'q1_gate',
  languages: ['en'],
  questions: [
    {
      id: 'q1_gate',
      prompt_i18n: { en: 'What are you looking for?' },
      answers: [
        {
          id: 'invest',
          label_i18n: { en: 'Investment property' },
          weights: {},
          next: 'inwestor_q2',
        },
        {
          id: 'home',
          label_i18n: { en: 'A home for myself or my family' },
          weights: {},
          next: 'own_use_q2',
        },
        {
          id: 'abroad',
          label_i18n: { en: 'Buying abroad / cross-border' },
          weights: {},
          next: 'cross_border_q2',
        },
        { id: 'browse', label_i18n: { en: 'Just browsing' }, weights: {}, next: null },
      ],
    },
    {
      id: 'inwestor_q2',
      prompt_i18n: { en: 'What is your investment focus?' },
      answers: [
        {
          id: 'yield',
          label_i18n: { en: 'Rental income (yield)' },
          weights: {},
          next: 'inwestor_q3',
        },
        {
          id: 'vacation',
          label_i18n: { en: 'Vacation rental' },
          weights: { vacation_rental_investor: 1 },
          next: null,
        },
        {
          id: 'flip',
          label_i18n: { en: 'Flip / renovation' },
          weights: { flip_investor: 1 },
          next: null,
        },
        {
          id: 'commercial',
          label_i18n: { en: 'Commercial / portfolio' },
          weights: { commercial_investor: 1 },
          next: null,
        },
      ],
    },
    {
      id: 'inwestor_q3',
      prompt_i18n: { en: 'What is your target return?' },
      answers: [
        {
          id: 'steady',
          label_i18n: { en: 'Steady yield above market average' },
          weights: { yield_hunter: 1 },
          next: null,
        },
        {
          id: 'portfolio',
          label_i18n: { en: 'Long-term portfolio growth' },
          weights: { portfolio_builder: 1 },
          next: null,
        },
        {
          id: 'golden',
          label_i18n: { en: 'Golden visa / residency pathway' },
          weights: { golden_visa_buyer: 1 },
          next: null,
        },
      ],
    },
    {
      id: 'own_use_q2',
      prompt_i18n: { en: 'What describes your situation best?' },
      answers: [
        {
          id: 'first_time',
          label_i18n: { en: 'First-time buyer' },
          weights: { first_time_buyer: 1 },
          next: 'own_use_q3',
        },
        {
          id: 'family',
          label_i18n: { en: 'Growing family' },
          weights: { family_buyer: 1 },
          next: 'own_use_q3',
        },
        {
          id: 'upsize',
          label_i18n: { en: 'Upsizing' },
          weights: { upsizer: 1 },
          next: 'own_use_q3',
        },
        {
          id: 'downsize',
          label_i18n: { en: 'Downsizing' },
          weights: { downsizer: 1 },
          next: 'own_use_q3',
        },
      ],
    },
    {
      id: 'own_use_q3',
      prompt_i18n: { en: 'What matters most to you?' },
      answers: [
        { id: 'location', label_i18n: { en: 'Location and community' }, weights: {}, next: null },
        {
          id: 'luxury',
          label_i18n: { en: 'Luxury finishes and prestige' },
          weights: { luxury_buyer: 2 },
          next: null,
        },
        {
          id: 'remote',
          label_i18n: { en: 'Remote-work setup' },
          weights: { remote_worker: 2 },
          next: null,
        },
        { id: 'value', label_i18n: { en: 'Value for money' }, weights: {}, next: null },
      ],
    },
    {
      id: 'cross_border_q2',
      prompt_i18n: { en: 'Why are you buying abroad?' },
      answers: [
        {
          id: 'retiring',
          label_i18n: { en: 'Retiring or relocating' },
          weights: {},
          next: 'cross_border_q3',
        },
        {
          id: 'second_home',
          label_i18n: { en: 'Second / holiday home' },
          weights: { second_home_buyer: 1 },
          next: null,
        },
        {
          id: 'student',
          label_i18n: { en: 'Supporting a student' },
          weights: { student_parent: 1 },
          next: null,
        },
      ],
    },
    {
      id: 'cross_border_q3',
      prompt_i18n: { en: 'What is your primary goal?' },
      answers: [
        {
          id: 'settle',
          label_i18n: { en: 'Retire and settle permanently' },
          weights: { retiree_relocator: 1 },
          next: null,
        },
        {
          id: 'connected',
          label_i18n: { en: 'Stay connected to home country' },
          weights: { diaspora_buyer: 1 },
          next: null,
        },
        {
          id: 'lifestyle',
          label_i18n: { en: 'Lifestyle and travel base' },
          weights: { lifestyle_expat: 1 },
          next: null,
        },
      ],
    },
  ],
};
