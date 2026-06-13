/**
 * URL construction for all SDK→control-plane fetch calls.
 *
 * The production install snippet (`buildSnippet` in DetectionPreview.tsx:153) emits:
 *
 *   data-decision-url="${CONTROL_PLANE_URL}/api"
 *   // e.g. "https://admin.estalara.com/api"
 *
 * This is the canonical convention: `decisionApiUrl` = host + `/api`.
 * Callers append ONLY the route-specific path (`/adapt`, `/intent/config`, etc.) —
 * the `/api` segment is already in the base URL.
 *
 * `buildEndpoint(decisionApiUrl, path)` is the single safe join point so that no
 * new fetch site can accidentally re-derive the convention wrong (RETRO-074 CB-1 /
 * FOLLOW-305: `fetchIntentWeights` and `fetchQuizConfig` were prepending `/api` to
 * a base URL that already ended in `/api` → double-`/api` 404 in prod).
 *
 * Convention (MUST remain in sync with DetectionPreview.tsx and docs):
 *   decisionApiUrl = "https://admin.estalara.com/api"  ← host + /api, NO trailing /
 *   path           = "/intent/config"                  ← MUST start with /
 *   result         = "https://admin.estalara.com/api/intent/config"
 *
 * The helper normalizes a spurious trailing slash on `decisionApiUrl` (defensive,
 * e.g. a manually-crafted snippet "…/api/") and enforces a leading slash on `path`
 * at compile time via the typed signature.
 *
 * Non-test consumers (Rule H):
 *   - packages/sdk/src/core/intent-weights.ts (fetchIntentWeights)
 *   - packages/sdk/src/core/quiz-config.ts    (fetchQuizConfig)
 *   - packages/sdk/src/core/adapt.ts          (deriveFeedbackUrl, deriveQuizCompletionUrl,
 *                                              fetchDirectives)
 *
 * @module @estalara/sdk/core/endpoint
 */

/**
 * Build a full URL for a control-plane endpoint by joining `decisionApiUrl` and a
 * route-specific `path`.
 *
 * `decisionApiUrl` is expected to be `https://admin.estalara.com/api` (host + `/api`,
 * no trailing slash) — the value emitted verbatim by `buildSnippet()` in
 * `apps/control-plane/src/components/onboarding/DetectionPreview.tsx`.
 *
 * The helper strips a trailing slash from `decisionApiUrl` (defensive normalisation)
 * and concatenates `path` directly. `path` MUST start with `/`.
 *
 * Examples (production form):
 *   buildEndpoint("https://admin.estalara.com/api", "/adapt")
 *     → "https://admin.estalara.com/api/adapt"
 *   buildEndpoint("https://admin.estalara.com/api", "/intent/config")
 *     → "https://admin.estalara.com/api/intent/config"
 *   buildEndpoint("https://admin.estalara.com/api", "/quiz/public-config")
 *     → "https://admin.estalara.com/api/quiz/public-config"
 *
 * @param decisionApiUrl - Base URL from SdkConfig (`config.decisionApiUrl`).
 *   Production value: `"https://admin.estalara.com/api"` (host + `/api`).
 * @param path - Route-specific path. MUST start with `/`.
 * @returns The joined URL string.
 */
export function buildEndpoint(decisionApiUrl: string, path: `/${string}`): string {
  return `${decisionApiUrl.replace(/\/$/, '')}${path}`;
}
