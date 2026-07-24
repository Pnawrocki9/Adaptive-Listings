/**
 * Wire examples for `PresentationConfigResponseSchema` (ADR-0019 "On acceptance" deliverable).
 *
 * Two canonical shapes of the `GET /api/quiz/public-config` 200 response:
 *   - fully-populated: an activated tenant with a configured `brand` slice.
 *   - minimal/unconfigured: a tenant that configured nothing — the brand slice is absent, so
 *     the SDK falls back to its hardcoded widget defaults (byte-identical to pre-ADR-0019).
 *
 * Both validate against `PresentationConfigResponseSchema`. Used in `docs/INTERFACES.md` and
 * as test fixtures; kept in sync with the schema by
 * `packages/shared/src/schemas/presentation-config.test.ts`.
 *
 * @module @estalara/shared/examples/presentation-config
 */

import type { PresentationConfigResponse, QuizDefinition } from '../schemas/presentation-config.js';

/**
 * Example quiz definition (FOLLOW-639) — a minimal but valid 2-question editable tree.
 * Root gate → invest branch (two leaves) or a neutral skip. Every weights key is a
 * canonical archetype id; every `next` resolves; no cycles → passes the hard integrity
 * refinement. `student_parent` is intentionally NOT reachable here, so
 * `computeUnreachableArchetypes` on this tree returns a non-empty warning list.
 */
export const EXAMPLE_QUIZ_DEFINITION: QuizDefinition = {
  schema_version: 1,
  root: 'q_gate',
  languages: ['en'],
  questions: [
    {
      id: 'q_gate',
      prompt_i18n: { en: 'What are you looking for?' },
      answers: [
        { id: 'a_invest', label_i18n: { en: 'Investment' }, weights: {}, next: 'q_invest' },
        { id: 'a_skip', label_i18n: { en: 'Just browsing' }, weights: {}, next: null },
      ],
    },
    {
      id: 'q_invest',
      prompt_i18n: { en: 'What is your focus?' },
      answers: [
        {
          id: 'a_yield',
          label_i18n: { en: 'Rental yield' },
          weights: { yield_hunter: 1 },
          next: null,
        },
        {
          id: 'a_flip',
          label_i18n: { en: 'Flip / renovate' },
          weights: { flip_investor: 1 },
          next: null,
        },
      ],
    },
  ],
};

/**
 * Example 1 — fully-populated response for a branded, activated tenant.
 * `brand` is present; `data_source` is a live DB read.
 */
export const EXAMPLE_PRESENTATION_CONFIG_FULL: PresentationConfigResponse = {
  quiz_enabled: true,
  micro_polls_enabled: true,
  language: 'pl',
  accent_color: '#2563EB',
  data_source: 'db',
  brand: {
    primary_color: '#1a73e8',
    logo_url: 'https://cdn.example.com/brands/acme/logo.svg',
    white_label: true,
  },
};

/**
 * Example 2 — minimal/unconfigured response.
 * The `brand` slice is absent → the SDK uses hardcoded widget defaults (ADR-0019 D4). The
 * inherited ADR-0011 core fields are always present.
 */
export const EXAMPLE_PRESENTATION_CONFIG_MINIMAL: PresentationConfigResponse = {
  quiz_enabled: true,
  micro_polls_enabled: false,
  language: 'en',
  accent_color: '#2563EB',
  data_source: 'db',
};

/**
 * Example 3 — branded tenant with NO logo (`logo_url` is `null`, never `undefined`).
 * Demonstrates the ADR-0019 D-nullability invariant on the wire.
 */
export const EXAMPLE_PRESENTATION_BRAND_NO_LOGO: PresentationConfigResponse = {
  quiz_enabled: true,
  micro_polls_enabled: false,
  language: 'es',
  accent_color: '#2563EB',
  data_source: 'db',
  brand: {
    primary_color: '#c026d3',
    logo_url: null,
    white_label: false,
  },
};

/**
 * Example 4 — response carrying a per-brand `quiz_definition` slice (FOLLOW-639).
 * A tenant with a configured active quiz tree; the SDK walks THIS instead of its built-in
 * default. The brand slice is also present here to show the two slices coexisting.
 */
export const EXAMPLE_PRESENTATION_CONFIG_WITH_QUIZ_DEF: PresentationConfigResponse = {
  quiz_enabled: true,
  micro_polls_enabled: false,
  language: 'en',
  accent_color: '#2563EB',
  data_source: 'db',
  quiz_definition: EXAMPLE_QUIZ_DEFINITION,
};
