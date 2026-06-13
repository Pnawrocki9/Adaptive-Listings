/**
 * Intent weight config fetch — ADR-0012 Ticket C (FOLLOW-268-sdk).
 *
 * The SDK fetches `GET <decisionApiUrl>/intent/config` at init time (parallel to
 * `fetchQuizConfig`) to read server-managed intent weight overrides. The response is
 * validated with `IntentConfigResponseSchema` and the `data_source` field determines
 * whether the weights are applied.
 *
 * URL convention (FOLLOW-305 fix):
 *   `decisionApiUrl` = `https://admin.estalara.com/api` (host + `/api`),
 *   as emitted by `buildSnippet()` in DetectionPreview.tsx:153.
 *   The fetch target is `buildEndpoint(decisionApiUrl, '/intent/config')` =
 *   `https://admin.estalara.com/api/intent/config`.
 *   DO NOT prepend `/api` here — it is already in `decisionApiUrl`.
 *   (Prior to FOLLOW-305, this file incorrectly built `…/api/intent/config`, producing
 *   a double-`/api` 404 against every production-onboarded tenant.)
 *
 * `data_source` handling (ADR-0012 §3, FOLLOW-299):
 *   - `'live'`  → parse `weights` via IntentWeightsSchema and return them.
 *   - `'mock'`  → return null (SDK uses internal defaults; do NOT apply mock weights).
 *   - `'error'` → return null BUT emit a distinct `console.warn` when debug=true.
 *                 Distinguishes a DB outage from a clean no-config state (RETRO-070 CB-1).
 *   - fetch failure / non-2xx / timeout / parse error → return null (SDK defaults).
 *
 * Error contract (Rule K.2 / ADR-0012):
 *   Failures are NEVER silently swallowed. The function returns `null`, which is the
 *   observable degraded signal — callers MUST use null to fall back to SDK defaults.
 *   The `data_source: 'error'` path additionally emits a `console.warn` in debug mode
 *   so a control-plane DB outage is not silently conflated with a clean mock state.
 *
 * No sessionStorage caching (contrast with quiz-config.ts):
 *   Intent weights are NOT cached — the Rule R rehydrate gate for quiz-config exists
 *   because the quiz scheduler must be stable across cross-listing navigations. Intent
 *   weights are applied once at session start (to initIntentState) and do not need
 *   to survive SPA navigations because the IntentState itself is rehydrated from
 *   sessionStorage carrying the already-applied priors.
 *
 * Non-test consumers (Rule H):
 *   - packages/sdk/src/index.ts (init() step 3b parallel fetch)
 *
 * @module @estalara/sdk/core/intent-weights
 */

import { IntentConfigResponseSchema } from '@estalara/shared';
import type { IntentWeights } from '@estalara/shared';
import { buildEndpoint } from './endpoint.js';

/**
 * Fetch intent weight overrides from `GET /api/intent/config`.
 *
 * Returns parsed IntentWeights on success with `data_source='live'`.
 * Returns null on any failure (network, non-2xx, timeout, parse error,
 * `data_source='mock'`, or `data_source='error'`).
 *
 * `data_source: 'error'` is distinguishable from `'mock'` via the `console.warn`
 * emitted in debug mode — the SDK uses internal defaults in both cases for adaptation,
 * but the distinction is preserved for telemetry (RETRO-070 CB-1, FOLLOW-299).
 *
 * The fetch is bounded to `timeoutMs` (default 1000 ms) via `AbortController`.
 *
 * Transport: `Authorization: Bearer <apiKey>` — identical to `fetchQuizConfig`.
 * The tenant_id is resolved server-side from the bearer key; it is NOT passed as a
 * query parameter (ADR-0012 §1 auth model).
 *
 * @param decisionApiUrl - Base URL from SdkConfig. Production value (emitted by
 *   `buildSnippet()` in DetectionPreview.tsx): `"https://admin.estalara.com/api"`
 *   (host + `/api`, NO trailing slash). Route path `/intent/config` is appended by
 *   `buildEndpoint` — DO NOT pass the bare host here (RETRO-074 CB-1 / FOLLOW-305).
 * @param apiKey         - Tenant API key sent as Bearer token.
 * @param timeoutMs      - Fetch timeout in ms. Default: 1000.
 * @param debug          - When true, emits `console.warn` on `data_source='error'` and
 *   `console.debug` on `data_source='mock'` so degraded states are observable.
 * @returns Parsed IntentWeights when data_source='live', otherwise null.
 */
export async function fetchIntentWeights(
  decisionApiUrl: string,
  apiKey: string,
  timeoutMs = 1_000,
  debug = false,
): Promise<IntentWeights | null> {
  // FOLLOW-305 fix: use buildEndpoint so the route path is appended without
  // duplicating the `/api` segment already present in decisionApiUrl.
  // Production: "https://admin.estalara.com/api" + "/intent/config"
  //           = "https://admin.estalara.com/api/intent/config"  ✓
  // (Prior bug: prepended "/api/intent/config" → "/api/api/intent/config" → 404)
  const url = buildEndpoint(decisionApiUrl, '/intent/config');

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    // Non-2xx responses: attempt to parse the body to check data_source before giving up.
    // HTTP 500 (data_source='error') has a parseable body per IntentConfigResponseSchema
    // (FOLLOW-299: weights field is optional so the error-path body still validates).
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // JSON parse failure on a non-2xx or malformed response — use SDK defaults.
      return null;
    }

    const result = IntentConfigResponseSchema.safeParse(body);
    if (!result.success) {
      // Schema validation failure — use SDK defaults.
      if (debug) {
        console.warn('[estalara] intent weight config response failed schema validation');
      }
      return null;
    }

    const parsed = result.data;

    // ── data_source handling (ADR-0012 §3, FOLLOW-299) ───────────────────────
    if (parsed.data_source === 'error') {
      // DB was configured but threw.  Distinct from 'mock' (RETRO-070 CB-1).
      // Use SDK internal defaults; emit a distinct warn so a DB outage is observable.
      if (debug) {
        console.warn(
          '[estalara] intent weight config: server returned data_source=error — ' +
            'DB may be unavailable; using SDK internal defaults',
        );
      }
      return null;
    }

    if (parsed.data_source === 'mock') {
      // DB unconfigured (dev/CI) or no active row for this tenant.
      // Use SDK internal defaults — do NOT apply mock weights in production.
      if (debug) {
        console.debug(
          '[estalara] intent weight config: data_source=mock — no active config row; ' +
            'using SDK internal defaults',
        );
      }
      return null;
    }

    // data_source === 'live' — apply the fetched weights.
    // `weights` is always present on a live response (ADR-0012 §Wire Contract);
    // the schema reflects this with weights as optional (to allow safeParse on error
    // bodies), but a live response MUST include weights.
    if (!parsed.weights) {
      // Defensive: live response without weights — treat as mock (SDK defaults).
      if (debug) {
        console.warn(
          '[estalara] intent weight config: data_source=live but weights field absent; ' +
            'using SDK internal defaults',
        );
      }
      return null;
    }

    return parsed.weights;
  } catch {
    // Network error or AbortError (timeout) — use SDK defaults.
    clearTimeout(timer);
    return null;
  }
}
