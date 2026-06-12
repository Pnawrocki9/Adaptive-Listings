/**
 * Runtime quiz/widget config fetch — ADR-0011 (FOLLOW-275).
 *
 * The SDK fetches `GET <decisionApiUrl>/quiz/public-config` at init time to read
 * `{ quiz_enabled, micro_polls_enabled, language, accent_color }`.  This replaces
 * the retired `data-quiz-enabled` / `data-micro-polls-enabled` snippet attributes
 * as the transport for post-activation-mutable quiz config fields.
 *
 * Rule R compliance:
 *   The fetch result is cached in sessionStorage under `QUIZ_CONFIG_CACHE_KEY`.
 *   On cross-listing navigation within the same tab the SDK rehydrates the cached
 *   value instead of re-fetching, so the config is stable for the 24h shadow-key
 *   session window and the network round-trip is paid only once per tab.
 *
 * Error contract (ADR-0011 §SDK behaviour on error / timeout):
 *   On any failure (network error, non-2xx, timeout, parse error) the function
 *   returns `null`.  Callers fall back to snippet-attribute values and then to
 *   hardcoded SdkConfig defaults.  Failures are NEVER silently swallowed without
 *   a return-null path observable to the caller (Rule K.2 compliant — null IS the
 *   observable degraded signal on this non-decision-grade surface; the quiz/micro-poll
 *   schedulers gate themselves on the returned value).
 *
 * @module @estalara/sdk/core/quiz-config
 */

import type { QuizPublicConfigResponse } from '@estalara/shared';
import { QuizPublicConfigResponseSchema } from '@estalara/shared';

/**
 * sessionStorage key for the cached quiz public config.
 * Cached per tab (sessionStorage) — never localStorage (Mode A compliance).
 * The key is not session-scoped because the quiz config is tenant-scoped and
 * does not change within a tab session.
 *
 * Cache-key scope note (FOLLOW-278 AC4 / LG-2):
 *   `estalara_quiz_config_cache` is a GLOBAL-PER-TAB key — not scoped by apiKey.
 *   This is correct for the current single-embed-per-tab model (one SDK instance
 *   per page).  If multi-embed-per-tab is ever supported (two SDK instances with
 *   different apiKeys on the same page), this key MUST be scoped by apiKey to
 *   prevent tenant A's config leaking to tenant B's SDK instance.
 *   Implementation: append `_${apiKey}` to the key and update every call site.
 *
 * @internal exported for tests only
 */
export const QUIZ_CONFIG_CACHE_KEY = 'estalara_quiz_config_cache';

/**
 * Read the cached quiz public config from sessionStorage.
 * Returns `null` if absent, unparseable, or sessionStorage is unavailable.
 *
 * @internal
 */
function readCachedQuizConfig(): QuizPublicConfigResponse | null {
  try {
    const raw = sessionStorage.getItem(QUIZ_CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const result = QuizPublicConfigResponseSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Write the fetched quiz config to sessionStorage.
 * Fails silently — sessionStorage unavailable must never block the quiz path.
 *
 * @internal
 */
function writeCachedQuizConfig(config: QuizPublicConfigResponse): void {
  try {
    sessionStorage.setItem(QUIZ_CONFIG_CACHE_KEY, JSON.stringify(config));
  } catch {
    // sessionStorage unavailable or quota exceeded — continue without cache
  }
}

/**
 * Erase the cached quiz config from sessionStorage.
 * Called on consent denial / withdrawal so no cached data survives without consent.
 * Mode A compliance: no sessionStorage data may persist after consent denial.
 *
 * @internal exported for tests and session erasure
 */
export function eraseCachedQuizConfig(): void {
  try {
    sessionStorage.removeItem(QUIZ_CONFIG_CACHE_KEY);
  } catch {
    // sessionStorage unavailable — nothing to erase
  }
}

/**
 * Fetch `{ quiz_enabled, micro_polls_enabled, language, accent_color }` from the
 * control-plane `GET /api/quiz/public-config` endpoint.
 *
 * Rule R: on a rehydrated session (`intentStateRehydrated === true`) the function
 * returns the sessionStorage-cached value immediately without issuing a network
 * request, so the config is stable across cross-listing navigations within the
 * same tab.
 *
 * @param decisionApiUrl - The SDK's `config.decisionApiUrl` value (from `data-decision-url`).
 * @param apiKey - The SDK's `config.apiKey` (from `data-api-key`), sent as Bearer token.
 * @param intentStateRehydrated - True when the SDK is resuming a session from sessionStorage.
 *   When true the function reads from cache instead of fetching (Rule R gate).
 * @param timeoutMs - Maximum ms to wait for the fetch (default 1000).
 * @param debug - When true, emits `console.warn` if the server returned a fallback response
 *   (`data_source: 'fallback'`). Rule K.2: the provenance field must be READ, not merely emitted.
 * @returns The parsed response, or `null` on any failure / timeout.
 */
export async function fetchQuizConfig(
  decisionApiUrl: string,
  apiKey: string,
  intentStateRehydrated: boolean,
  timeoutMs = 1_000,
  debug = false,
): Promise<QuizPublicConfigResponse | null> {
  // Rule R gate — rehydrate path reuses the cached config instead of re-fetching.
  if (intentStateRehydrated) {
    const cached = readCachedQuizConfig();
    if (cached !== null) return cached;
    // Cache miss on a rehydrated session (e.g. sessionStorage was cleared externally).
    // Fall through to fetch so we still get a config if possible.
  }

  // Derive the public-config URL from the decision API base URL.
  // decisionApiUrl is expected to be e.g. "https://admin.estalara.com" (no trailing slash).
  const url = `${decisionApiUrl.replace(/\/$/, '')}/api/quiz/public-config`;

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

    if (!response.ok) {
      // Non-2xx response — return null; caller falls back to defaults.
      return null;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // JSON parse failure — return null.
      return null;
    }

    const result = QuizPublicConfigResponseSchema.safeParse(body);
    if (!result.success) {
      // Schema validation failure — return null; caller falls back to defaults.
      return null;
    }

    // Rule K.2 (FOLLOW-277): read the provenance field the server emits.
    // When `data_source === 'fallback'`, the server served defaults (DB was down or
    // not configured). Emit a debug-mode warning so the degraded state is observable.
    if (debug && result.data.data_source === 'fallback') {
      console.warn(
        '[estalara] quiz config fetched but server used fallback defaults — DB may be unavailable',
      );
    }

    // Cache the validated config for rehydrated sessions on this tab.
    writeCachedQuizConfig(result.data);

    return result.data;
  } catch {
    // Network error or AbortError (timeout) — return null.
    clearTimeout(timer);
    return null;
  }
}
