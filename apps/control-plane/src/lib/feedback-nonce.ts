/**
 * Server-side replay protection for POST /api/adapt/feedback (FOLLOW-466 / audit F-21).
 *
 * The feedback HMAC signature (`X-Estalara-Signature = HMAC-SHA256(apiKey, body)`) is computed
 * client-side by the already-deployed SDK (`packages/sdk/src/core/adapt.ts`). It covers only
 * `(key, body)` — no timestamp, no nonce. Adding either to the SIGNED payload would be an
 * SDK<->control-plane wire-contract change requiring an SDK re-deploy, which is explicitly
 * DEFERRED (CEO-approved "Option A", see the FOLLOW-466 PR description). Because the signature
 * is fully deterministic over `(key, body)`, anyone who observes one valid
 * `(body, X-Estalara-Signature)` pair (a MITM on a non-TLS-terminated hop, a logging pipeline,
 * a compromised analytics proxy) can replay that exact POST indefinitely — each replay
 * re-invokes the Thompson-sampling bandit update and, when `prediction_id` is present, the
 * conversion-label upsert.
 *
 * This module closes that gap server-side, without touching the wire contract: the first time
 * a given signature is observed it is recorded in Redis with a bounded TTL; any subsequent POST
 * bearing the IDENTICAL signature (which, given HMAC, means an identical `(key, body)` pair)
 * within that window is a replay/duplicate. The route (`api/adapt/feedback/route.ts`) uses this
 * to skip the mutating side-effects for a detected replay while still acknowledging the ping —
 * a legitimate SDK network retry of the same fire-and-forget ping must not double-count, and an
 * attacker's replay simply no-ops.
 *
 * Reuses the same Upstash Redis REST pattern as `@/lib/description-cache` (`UPSTASH_REDIS_URL` +
 * `UPSTASH_REDIS_TOKEN`) — no new Redis client, no new dependency.
 *
 * Fail-open posture: when Redis is not configured (dev/CI — `UPSTASH_REDIS_URL` unset) OR a
 * configured Redis call throws/errors, this module reports "not a replay" so the feedback ping
 * is still processed. This mirrors description-cache.ts's degrade-gracefully posture. The
 * tradeoff: during a Redis outage the replay window is effectively open (a replay would not be
 * caught). That is accepted here because feedback is a fire-and-forget bandit-signal ping, not a
 * security-critical mutation — turning a transient Redis blip into "drop all pilot feedback"
 * would be a worse outcome than a temporarily-widened (and still bounded, since HMAC/tenant auth
 * still fully applies) replay window.
 *
 * @module apps/control-plane/src/lib/feedback-nonce
 */

/** Replay-acceptance window: how long a given signature is remembered as "seen". */
export const FEEDBACK_NONCE_TTL_SECONDS = 600; // 10 minutes.

function getRedisBase(): string | null {
  const url = process.env.UPSTASH_REDIS_URL;
  return url ? url.replace(/\/$/, '') : null;
}

function getRedisHeaders(): Record<string, string> {
  const token = process.env.UPSTASH_REDIS_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface FeedbackNonceResult {
  /**
   * `true` when this exact signature was already recorded within the TTL window — the caller
   * MUST treat this POST as a replay/duplicate and skip the mutating side-effects.
   * `false` when this is the first sighting (or Redis is unconfigured/unavailable — fail-open).
   */
  isReplay: boolean;
}

/**
 * Atomically record `signatureHex` (the already-HMAC-verified `X-Estalara-Signature` hex
 * digest) as "seen", via Upstash `SET nonce:feedback:{signatureHex} 1 NX EX <ttl>`.
 *
 * Upstash's REST API returns the literal string `"OK"` when the SET succeeds (key was absent —
 * first sighting) and `null` when the `NX` guard fails (key already present — a replay).
 *
 * Never throws — any Redis error (network failure, non-2xx response, unconfigured env) is
 * caught and reported as `{ isReplay: false }` (fail-open; see module docstring).
 */
export async function checkAndRecordFeedbackNonce(
  signatureHex: string,
): Promise<FeedbackNonceResult> {
  const base = getRedisBase();
  if (!base) {
    // UPSTASH_REDIS_URL unset — dev/CI, not a configured-but-failed dependency (Rule K.2).
    return { isReplay: false };
  }

  const key = `nonce:feedback:${signatureHex}`;
  const path = ['set', key, '1', 'nx', 'ex', FEEDBACK_NONCE_TTL_SECONDS]
    .map((arg) => encodeURIComponent(String(arg)))
    .join('/');

  try {
    const res = await fetch(`${base}/${path}`, {
      method: 'GET',
      headers: getRedisHeaders(),
    });
    if (!res.ok) {
      console.warn(
        `[feedback-nonce] Redis SET NX returned HTTP ${String(res.status)} — failing open (allowing feedback through)`,
      );
      return { isReplay: false };
    }
    const body = (await res.json()) as { result: string | null };
    return { isReplay: body.result == null };
  } catch (err) {
    console.warn(
      '[feedback-nonce] Redis error — failing open (allowing feedback through):',
      err instanceof Error ? err.message : err,
    );
    return { isReplay: false };
  }
}
