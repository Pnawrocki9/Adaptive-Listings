/**
 * Client-safe half of `lib/bandit-flag.ts` (FOLLOW-1286): no `next/server`, no workspace
 * packages, so the `'use client'` analytics dashboards can import it.
 *
 * @module apps/control-plane/src/lib/bandit-disabled-body
 */

/** `error.details.reason` carried by every response a frozen bandit route returns. */
export const BANDIT_DISABLED_REASON = 'bandit_disabled' as const;

/**
 * True when a parsed response body is the frozen-bandit 404 from `banditDisabledResponse()` —
 * the dashboards then hide the arms panel instead of rendering it empty or as an error.
 */
export function isBanditDisabledBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return false;
  const details = (error as { details?: unknown }).details;
  return (
    !!details &&
    typeof details === 'object' &&
    (details as { reason?: unknown }).reason === BANDIT_DISABLED_REASON
  );
}
