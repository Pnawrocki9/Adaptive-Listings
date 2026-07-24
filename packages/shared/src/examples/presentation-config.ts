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

import type { PresentationConfigResponse } from '../schemas/presentation-config.js';

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
