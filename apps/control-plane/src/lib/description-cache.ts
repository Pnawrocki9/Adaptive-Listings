/**
 * Description cache helpers — Upstash Redis get/set/invalidate for the long-form
 * listing description pipeline (TICKET-DESC-001, Master Design E.7).
 *
 * Redis key format: `desc:{tenant_id}:{listing_id}:{archetype}:{locale}`
 *
 * TTLs:
 *   - Tier 2: 72 hours = 259 200 seconds
 *   - Tier 3: 48 hours = 172 800 seconds
 *
 * Values are stored as JSON strings matching DescriptionCacheValue:
 *   `{ "text": "...", "headline": "...", "generated_at": "2026-05-14T12:00:00Z" }`
 *
 * The `headline` field is optional (null when generation failed; absent in pre-ADR-0009 entries).
 * `getCachedDescription` returns the field as-is; callers must handle undefined/null.
 *
 * Wildcard delete (for cache invalidation on listing.updated events) uses SCAN + DEL
 * because Upstash Redis does not support KEYS * in production.
 *
 * All public functions are fail-open — they never throw. On Redis unavailability,
 * get() returns null, set() is a no-op, invalidate() is a no-op. The endpoint
 * falls back to template_fallback in all error cases.
 *
 * @module apps/control-plane/src/lib/description-cache
 */

import type { DescriptionCacheValue } from '@estalara/shared';

// ─── TTL constants ────────────────────────────────────────────────────────────

/** Redis TTL for Tier 2 descriptions (72 hours). */
export const TTL_TIER2_SECONDS = 72 * 3600; // 259 200

/** Redis TTL for Tier 3 descriptions (48 hours). */
export const TTL_TIER3_SECONDS = 48 * 3600; // 172 800

// ─── Key builder ─────────────────────────────────────────────────────────────

/**
 * Build the Upstash Redis key for a description cache entry.
 *
 * @param tenantId   - Tenant UUID.
 * @param listingId  - The tenant's listing identifier.
 * @param archetype  - Archetype ID (e.g. 'yield_hunter').
 * @param locale     - Locale code (e.g. 'en').
 * @returns Redis key string in the format `desc:{tenantId}:{listingId}:{archetype}:{locale}`.
 */
export function descriptionKey(
  tenantId: string,
  listingId: string,
  archetype: string,
  locale: string,
): string {
  return `desc:${tenantId}:${listingId}:${archetype}:${locale}`;
}

// ─── Internal Upstash HTTP helpers ────────────────────────────────────────────

function getRedisBase(): string | null {
  const url = process.env.UPSTASH_REDIS_URL;
  return url ? url.replace(/\/$/, '') : null;
}

function getRedisHeaders(): Record<string, string> {
  const token = process.env.UPSTASH_REDIS_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Execute a single Redis command via Upstash REST API.
 * Sends a POST to `{UPSTASH_REDIS_URL}/{command}/{...args}`.
 *
 * Returns the parsed JSON response body, or null on any error.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is used in return type and cast; the generic is required for call-site inference
async function redisCommand<T = unknown>(
  ...cmdArgs: (string | number)[]
): Promise<{ result: T } | null> {
  const base = getRedisBase();
  if (!base) return null;

  const path = cmdArgs.map((a) => encodeURIComponent(String(a))).join('/');

  try {
    const res = await fetch(`${base}/${path}`, {
      method: 'GET',
      headers: getRedisHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as { result: T };
  } catch {
    return null;
  }
}

/**
 * Execute a Redis command that requires a POST body (e.g. SET with value containing
 * special characters). Uses the Upstash pipeline/command endpoint.
 *
 * The Upstash REST API supports GET-based commands for simple keys, but SET with
 * JSON values that contain slashes or colons requires the POST pipeline format:
 *   POST /pipeline  body: [[cmd, arg1, arg2, ...], ...]
 */
async function redisPost(commands: (string | number)[][]): Promise<boolean> {
  const base = getRedisBase();
  if (!base) return false;

  try {
    const res = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getRedisHeaders(),
      },
      body: JSON.stringify(commands),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read a description cache entry from Redis.
 *
 * @param key - The full Redis key (use descriptionKey() to build it).
 * @returns DescriptionCacheValue if the key exists and is valid JSON; null otherwise.
 */

export async function getCachedDescription(key: string): Promise<DescriptionCacheValue | null> {
  const resp = await redisCommand<string | null>('get', key);
  if (resp?.result == null) return null;

  try {
    const parsed = JSON.parse(resp.result) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).text === 'string' &&
      typeof (parsed as Record<string, unknown>).generated_at === 'string'
    ) {
      // headline is optional: may be absent (pre-ADR-0009 entry) or null (generation failed).
      // Normalise missing to undefined so downstream callers see a clean DescriptionCacheValue.
      return parsed as DescriptionCacheValue;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write a description cache entry to Redis with the given TTL.
 *
 * This is a fire-and-forget helper — it does not throw on failure.
 * The Modal job also writes to Redis directly; this function is provided
 * for testing and potential prewarming use-cases.
 *
 * @param key        - The full Redis key (use descriptionKey() to build it).
 * @param value      - The DescriptionCacheValue to store.
 * @param ttlSeconds - TTL in seconds (TTL_TIER2_SECONDS or TTL_TIER3_SECONDS).
 */
export async function setCachedDescription(
  key: string,
  value: DescriptionCacheValue,
  ttlSeconds: number,
): Promise<void> {
  const jsonValue = JSON.stringify(value);
  // Use POST pipeline to handle JSON values with special characters safely.
  await redisPost([['SET', key, jsonValue, 'EX', ttlSeconds]]);
}

/**
 * Invalidate all description cache entries for a given (tenant, listing) pair.
 *
 * Uses SCAN with MATCH `desc:{tenantId}:{listingId}:*` to find all keys
 * (across all archetype + locale combinations) and DELetes them.
 *
 * Idempotent: DEL on a non-existent key is a no-op in Redis.
 * Safe to call multiple times for the same event.
 *
 * This is the implementation of the listing.updated cache invalidation
 * required by TICKET-DESC-001 AC-7.
 *
 * @param tenantId  - Tenant UUID.
 * @param listingId - The tenant's listing identifier.
 */
export async function invalidateDescriptionCache(
  tenantId: string,
  listingId: string,
): Promise<void> {
  const base = getRedisBase();
  if (!base) return;

  const matchPattern = `desc:${tenantId}:${listingId}:*`;
  let cursor = '0';

  do {
    // SCAN cursor MATCH pattern COUNT 100
    const resp = await redisCommand<[string, string[]]>(
      'scan',
      cursor,
      'match',
      matchPattern,
      'count',
      100,
    );
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- false positive: resp.result is typed as [string, string[]] but comes from unresolved @estalara/shared; runtime shape check is required
    if (!resp || !Array.isArray(resp.result) || resp.result.length !== 2) break;

    const [nextCursor, keys] = resp.result;
    cursor = nextCursor;

    if (keys.length > 0) {
      // DEL key1 key2 ... (pipeline)
      await redisPost([['DEL', ...keys]]);
    }
  } while (cursor !== '0');
}
