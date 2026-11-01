/**
 * Repeat guard for REFUSED descriptions — FOLLOW-1427.
 *
 * A description the claim checks refuse writes no cache entry (ESC-076: the buyer keeps the
 * seller's copy), so every later cache miss regenerated it and paid for the model call again.
 * This module remembers "refused" in Upstash Redis for a short time (one attempt per hour per
 * listing, archetype, language, model, listing revision and claims-validation version); while it
 * is set the generator makes no model call. The expiry stays short because regeneration is the
 * only way such a listing recovers.
 *
 * Fail-open in both directions: when Redis is not configured, unreachable or answers non-2xx,
 * `isRefusalGuarded` is `false` (the caller regenerates exactly as before) and `setRefusalGuard`
 * is a no-op. The guard never turns into a refusal for the buyer.
 *
 * @module apps/control-plane/src/lib/description-refusal-guard
 */

/** How long a refusal suppresses regeneration (seconds). */
export const REFUSAL_GUARD_TTL_SECONDS = 3600;

/** The fields that make the generated text differ; all of them are part of the key. */
export interface RefusalGuardScope {
  tenantId: string;
  listingId: string;
  archetype: string;
  locale: string;
  model: string;
  listingRevision: number;
  /** `CLAIMS_VALIDATION_VERSION` — a new claim check is not blocked by an old refusal. */
  claimsVersion: string;
}

/** Redis key of one guard (`descref:` never matches the `desc:{tenant}:{listing}:*` invalidation scan). */
export function refusalGuardKey(s: RefusalGuardScope): string {
  return [
    'descref',
    s.tenantId,
    s.listingId,
    s.archetype,
    s.locale,
    s.model,
    `r${String(s.listingRevision)}`,
    s.claimsVersion,
  ].join(':');
}

async function command(...args: (string | number)[]): Promise<{ result: unknown } | null> {
  const url = process.env.UPSTASH_REDIS_URL;
  if (!url) return null;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  try {
    const res = await fetch(
      `${url.replace(/\/$/, '')}/${args.map((a) => encodeURIComponent(String(a))).join('/')}`,
      { method: 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) return null;
    return (await res.json()) as { result: unknown };
  } catch {
    return null;
  }
}

/** `true` only when Redis answered and the guard is set; any failure reads as "not guarded". */
export async function isRefusalGuarded(scope: RefusalGuardScope): Promise<boolean> {
  const resp = await command('get', refusalGuardKey(scope));
  return resp?.result != null;
}

/** Set the guard with a TTL. Never throws; a failed write only means the next miss regenerates. */
export async function setRefusalGuard(scope: RefusalGuardScope): Promise<boolean> {
  const resp = await command('set', refusalGuardKey(scope), '1', 'ex', REFUSAL_GUARD_TTL_SECONDS);
  return resp !== null;
}
