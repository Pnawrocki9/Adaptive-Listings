/**
 * FOLLOW-293 — K.3.6 D-1 live-network smoke test.
 *
 * Purpose: prove the full D-1 intent-weights chain end-to-end against a real
 * backend — the SDK's `fetchIntentWeights()` call reaches the real
 * `GET /api/intent/config` endpoint, which queries the real Supabase instance,
 * and the seeded global-default `intent_weight_configs` row (migration 0030,
 * applied 2026-06-14 per FOLLOW-307 AC1) causes the endpoint to return
 * `data_source: 'live'`.
 *
 * Why a live-network smoke and not just unit tests:
 *   - FOLLOW-305 TG-1 tests pin the SDK URL form against a mock.
 *   - Route unit tests (route.test.ts) mock `@estalara/db` entirely.
 *   - The migration-0030 seed row is verified at the Supabase level only by
 *     FOLLOW-307 AC1 (manual operator check). No CI path has ever asserted
 *     that `GET /api/intent/config` returns `data_source: 'live'` against a
 *     live Supabase with the real seed row. This test closes that gap.
 *
 * What makes this a REAL test (not a dead-wire test):
 *   - The value under test (`data_source: 'live'`) is NOT injected by this
 *     file. It is produced by the real route handler reading the real
 *     `intent_weight_configs` table and finding the global seed row.
 *   - `fetchIntentWeights()` is imported directly from the SDK source; no
 *     mock intercepts the network call.
 *   - The URL is constructed from `ESTALARA_SMOKE_DECISION_API_URL` (the
 *     real install-snippet value emitted by `buildSnippet()` in
 *     `DetectionPreview.tsx:153`) — NOT hand-authored here.
 *   - The API key is `ESTALARA_SMOKE_API_KEY` — a real tenant key that
 *     authenticates to the real `api_keys` table.
 *
 * Skip / hard-fail contract (mirrors `tracer-query-smoke` / RETRO-007 pattern):
 *   - `REQUIRE_LIVE_INTENT_SMOKE=1` + secrets absent → hard-fail immediately
 *     (no silent green badge over a misconfigured job).
 *   - Secrets absent + no require flag → soft-skip with GitHub Actions notice
 *     (safe for offline dev, forked PRs, PRs that don't set the flag).
 *   - Secrets present + endpoint broken → hard-fail (the test catches a dead wire).
 *
 * Required env vars:
 *   ESTALARA_SMOKE_DECISION_API_URL — base URL including /api, e.g.
 *     "https://admin.estalara.com/api" (same value buildSnippet() emits)
 *   ESTALARA_SMOKE_API_KEY          — tenant Bearer token for a real tenant in
 *     the target environment's `api_keys` table
 *   REQUIRE_LIVE_INTENT_SMOKE       — set to "1" in the CI job that provides
 *     the secrets; absent elsewhere
 *
 * Secrets needed (ESC-024):
 *   Neither `ESTALARA_SMOKE_DECISION_API_URL` nor `ESTALARA_SMOKE_API_KEY`
 *   exist as GitHub Actions secrets today. They must be provisioned before
 *   the `intent-weights-live-smoke` CI job can run in non-skip mode.
 *   See `backlog/ESCALATIONS.md` ESC-024.
 *
 * @module tests/integration/intent-weights-live.smoke
 */

import { describe, it, expect, beforeAll } from 'vitest';

// ─── Production path import ───────────────────────────────────────────────────
//
// `fetchIntentWeights` is the REAL SDK function. It is NOT mocked here.
// The function constructs the URL via `buildEndpoint(decisionApiUrl, '/intent/config')`
// (FOLLOW-305 fix) and issues a real fetch to the live endpoint.
// Importing from source avoids bundle-layer divergence.
import { fetchIntentWeights } from '../../packages/sdk/src/core/intent-weights.js';

// ─── Env var gate — skip / hard-fail logic ───────────────────────────────────

const DECISION_API_URL = process.env.ESTALARA_SMOKE_DECISION_API_URL ?? '';
const API_KEY = process.env.ESTALARA_SMOKE_API_KEY ?? '';
const HAS_SECRETS = Boolean(DECISION_API_URL) && Boolean(API_KEY);
const REQUIRE = process.env.REQUIRE_LIVE_INTENT_SMOKE === '1';

/**
 * When REQUIRE_LIVE_INTENT_SMOKE=1 (the live-smoke CI job) the secrets MUST be
 * present. A missing secret means the CI job is misconfigured; a silent skip
 * would produce a green badge over a test that never ran — the exact failure
 * mode documented in RETRO-007 and FOLLOW-097/114/127/141.
 */
if (REQUIRE && !HAS_SECRETS) {
  const missing = [
    !DECISION_API_URL && 'ESTALARA_SMOKE_DECISION_API_URL',
    !API_KEY && 'ESTALARA_SMOKE_API_KEY',
  ]
    .filter(Boolean)
    .join(', ');

  throw new Error(
    `REQUIRE_LIVE_INTENT_SMOKE=1 is set but the following secrets are absent: ${missing}. ` +
      'The intent-weights-live-smoke CI job MUST supply these secrets. ' +
      'A silent skip is forbidden — fix the job secrets or unset REQUIRE_LIVE_INTENT_SMOKE. ' +
      'See backlog/ESCALATIONS.md ESC-024 for provisioning instructions.',
  );
}

// ─── Soft-skip announcement for offline/CI runs without secrets ───────────────
//
// Emit a GitHub Actions notice (visible in the Actions UI step summary) so the
// skip is loud and attributable. Plain environments (local without secrets) see
// the message on stdout via console.log.

beforeAll(() => {
  if (!HAS_SECRETS) {
    const notice =
      'ESTALARA_SMOKE_DECISION_API_URL or ESTALARA_SMOKE_API_KEY is not set — ' +
      'skipping K.3.6 D-1 live-network smoke (FOLLOW-293). ' +
      'To run: set both env vars to a real tenant key and the production/staging ' +
      'decisionApiUrl. See backlog/ESCALATIONS.md ESC-024.';
    // GitHub Actions notice annotation — visible in the step log UI.
    console.log(`::notice::${notice}`);
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FOLLOW-293 — K.3.6 D-1 live-network smoke: fetchIntentWeights → GET /api/intent/config', () => {
  /**
   * AC-LN1: The real `fetchIntentWeights()` (production SDK function, no mock)
   * reaches the live endpoint and returns a non-null result, confirming:
   *   (a) The URL construction is correct (FOLLOW-305 single-/api form).
   *   (b) The Bearer auth header authenticates successfully (api_keys lookup).
   *   (c) The endpoint returns `data_source: 'live'` because migration 0030
   *       seeded the global `intent_weight_configs` row (FOLLOW-307 AC1).
   *
   * The value `data_source: 'live'` is NOT injected by this test. It is supplied
   * by the real route handler reading the real Supabase table. If the seed row
   * is absent, the route returns `data_source: 'mock'` and the test FAILS — which
   * is the correct behaviour (it proves a dead wire).
   */
  it.skipIf(!HAS_SECRETS)(
    'AC-LN1: fetchIntentWeights() returns non-null weights from the live endpoint (data_source=live)',
    async () => {
      // PRODUCTION PATH: `fetchIntentWeights` calls `buildEndpoint(decisionApiUrl, '/intent/config')`
      // → constructs "https://admin.estalara.com/api/intent/config" (single /api)
      // → issues GET with Authorization: Bearer <API_KEY>
      // → real Supabase resolves tenant from api_keys → finds global seed row → 'live'
      //
      // DECISION_API_URL is read from ESTALARA_SMOKE_DECISION_API_URL (the same value
      // buildSnippet() in DetectionPreview.tsx:153 emits for real onboarded tenants).
      // It is NOT hand-authored to a constant in this file.
      const weights = await fetchIntentWeights(
        DECISION_API_URL,
        API_KEY,
        10_000, // 10s timeout for a cold-start prod request
        true, // debug=true so any data_source='error' emits a console.warn
      );

      // The seed row in intent_weight_configs has weights = {} (Option A: empty/identity).
      // fetchIntentWeights returns {} weights parsed through IntentWeightsSchema.
      // An empty weights object IS a valid live result — the SDK applies its internal
      // defaults on top of it. null would mean data_source='mock' or a fetch failure.
      //
      // Per intent-weights.ts:155-165: data_source='live' with weights present →
      // return parsed weights (even if {}). data_source='mock' → return null.
      // The global seed row has weights='{}', so weights={} → parsed as {} → returned.
      //
      // CRITICAL: if this assertion fails with `weights === null`, it means either:
      //   (a) The seed row is absent (FOLLOW-307 AC1 not applied) → data_source='mock'
      //   (b) Auth failed (API key not found in api_keys) → fetchIntentWeights returns null
      //   (c) Network failure
      // All three cases represent a broken wire, and the test correctly fails.
      expect(
        weights,
        'fetchIntentWeights returned null — expected non-null (data_source=live). ' +
          'This means either: (a) the migration-0030 seed row is absent from the live ' +
          'Supabase, (b) the API key is invalid or the tenant has no api_keys row, ' +
          'or (c) a network failure. Check FOLLOW-307 AC1 and ESC-024.',
      ).not.toBeNull();
    },
  );

  /**
   * AC-LN2: The live endpoint returns `data_source: 'live'` and not `data_source: 'mock'`.
   *
   * This assertion targets the specific D-1 go-live criterion: after FOLLOW-307 AC1
   * (migration 0030 applied), an unauthenticated-tenant (no tenant-specific row) must
   * receive `data_source: 'live'` from the global seed row, NOT `data_source: 'mock'`.
   *
   * We verify this by using the raw fetch path directly against the production endpoint
   * and parsing the response body. This is separate from AC-LN1 so a schema mismatch
   * (e.g. new unknown field) doesn't mask the data_source assertion.
   */
  it.skipIf(!HAS_SECRETS)(
    "AC-LN2: live endpoint returns data_source='live' (migration-0030 seed row present)",
    async () => {
      // Construct the URL using the same logic as fetchIntentWeights + buildEndpoint.
      // We reproduce the URL construction here (not import buildEndpoint) so this test
      // remains valid even if buildEndpoint's internals change — this is a black-box
      // contract test on the HTTP endpoint, not a unit test of buildEndpoint.
      const url = DECISION_API_URL.replace(/\/+$/, '') + '/intent/config';

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });

      // A non-2xx here (except 500 with data_source='error') is a hard failure:
      // 401 → API key rejected; 404 → endpoint missing; 503 → DB auth error.
      // The 500 case is handled below via body parse (data_source='error').
      expect(
        response.status,
        `GET ${url} returned HTTP ${String(response.status)} — expected 200. ` +
          'Check that ESTALARA_SMOKE_API_KEY is valid and the endpoint is reachable.',
      ).toBe(200);

      // Parse the body — the real route emits IntentConfigResponse JSON.
      const body = (await response.json()) as {
        data_source: string;
        weights?: unknown;
        is_tenant_specific?: boolean;
        effective_at?: string;
      };

      // THE CORE D-1 ASSERTION:
      // data_source MUST be 'live', not 'mock' or 'error'.
      // 'mock'  → seed row absent (FOLLOW-307 AC1 not applied or row deleted)
      // 'error' → DB configured but threw (Supabase connectivity issue)
      // 'live'  → global seed row found → D-1 is active in production
      //
      // This value is NOT supplied by this test. It is the output of the real
      // route handler reading the real Postgres table. Fail here = dead wire.
      expect(
        body.data_source,
        `GET ${url} returned data_source='${body.data_source}'. ` +
          "Expected 'live' because migration 0030 seeded a global intent_weight_configs row. " +
          "If 'mock': the seed row is absent (apply migration 0030 via FOLLOW-307). " +
          "If 'error': Supabase is throwing during the weight-fetch query.",
      ).toBe('live');

      // Additional shape assertions: confirm the response is well-formed.
      // These guard against a future route change that emits data_source='live'
      // but drops required fields (would break the SDK's IntentConfigResponseSchema).
      expect(typeof body.effective_at).toBe('string');
      expect(typeof body.is_tenant_specific).toBe('boolean');
      // weights is {} (empty/identity seed) — must be an object, not undefined.
      expect(body.weights).toBeDefined();
      expect(typeof body.weights).toBe('object');
    },
  );

  /**
   * AC-LN3: URL-form regression guard — the actual network call uses the correct
   * single-/api URL form, not the pre-FOLLOW-305 double-/api broken form.
   *
   * We intercept at the Response level using a thin wrapper around global fetch
   * to capture the URL that `fetchIntentWeights` actually called. This avoids
   * needing to mock fetch (which would defeat the live-network purpose) — instead
   * we wrap fetch to record the URL while still forwarding the real call.
   *
   * The test is only meaningful when secrets are present (the real call is made).
   */
  it.skipIf(!HAS_SECRETS)(
    'AC-LN3: fetchIntentWeights calls exactly the single-/api URL (FOLLOW-305 regression guard)',
    async () => {
      const calledUrls: string[] = [];

      // Thin wrapper: record the URL, then delegate to the real fetch.
      // This is NOT a mock — the real request still goes to the live endpoint.
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input: URL | string, init?: RequestInit): Promise<Response> => {
        calledUrls.push(typeof input === 'string' ? input : String(input));
        return originalFetch(input, init);
      };

      try {
        await fetchIntentWeights(DECISION_API_URL, API_KEY, 10_000, false);
      } finally {
        globalThis.fetch = originalFetch;
      }

      // At least one call must have been made.
      expect(calledUrls.length).toBeGreaterThanOrEqual(1);

      const intentConfigCall = calledUrls.find((u) => u.includes('/intent/config'));
      expect(
        intentConfigCall,
        'fetchIntentWeights did not call any URL containing /intent/config',
      ).toBeDefined();

      // The URL must end with exactly one /api before /intent/config.
      // The canonical production form is: https://admin.estalara.com/api/intent/config
      // The broken pre-FOLLOW-305 form was: https://admin.estalara.com/api/api/intent/config
      const doubleApiPattern = /\/api\/api\/intent\/config/;
      expect(
        intentConfigCall,
        `fetchIntentWeights called the DOUBLE-/api broken URL form: ${intentConfigCall ?? ''}. ` +
          'This is a FOLLOW-305 regression. The URL must be single-/api.',
      ).not.toMatch(doubleApiPattern);

      // Positive assertion: the URL must contain exactly one /api/intent/config segment.
      expect(intentConfigCall).toMatch(/\/api\/intent\/config$/);
    },
  );
});
