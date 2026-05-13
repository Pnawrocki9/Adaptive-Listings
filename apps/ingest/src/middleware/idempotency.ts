/**
 * Idempotency middleware for the ingest Worker.
 *
 * Clients (SDK, server-side adapters) include an `Idempotency-Key` HTTP header
 * on every batch POST.  When the Worker receives a key it has seen before
 * (within the 24-hour TTL window) it returns the previously-cached response
 * body verbatim instead of re-processing the batch.  This lets the SDK retry
 * safely on network timeouts without causing duplicate events.
 *
 * Key design decisions:
 * - Dedup granularity is per-batch (one KV write per request), NOT per
 *   individual `event_id`.  This keeps KV write costs predictable.  ClickHouse
 *   `ReplacingMergeTree` and the Redpanda consumer layer handle per-event
 *   dedup downstream.
 * - KV is eventually consistent.  Two concurrent requests with the same key
 *   may both be processed (last-writer-wins on the cache entry).  This is
 *   documented in the runbook and is acceptable for at-least-once delivery.
 * - Only 2xx responses are cached.  Error responses are NOT cached so clients
 *   can retry after fixing their request without waiting for TTL expiry.
 * - The KV key is scoped per tenant using a short hash of the raw
 *   `X-Estalara-API-Key` header (SHA-256, first 8 bytes → 16 hex chars).
 *   This prevents cross-tenant collisions when two tenants send the same
 *   `Idempotency-Key` value.  When no API key header is present the prefix
 *   falls back to `'anon'`.  The hash is computed before authentication runs,
 *   so it is purely discriminating — not a security mechanism.
 *
 * Key format (RFC 8959 recommendation): 32–128 ASCII printable characters
 * (`0x20–0x7e`).  Keys outside this range are rejected with 400.
 *
 * @module apps/ingest/src/middleware/idempotency
 */

import type { MiddlewareHandler } from 'hono';

import type { KVNamespace } from '@cloudflare/workers-types';

/** Minimum length of a valid Idempotency-Key (inclusive). */
export const IDEMPOTENCY_KEY_MIN_LEN = 32;
/** Maximum length of a valid Idempotency-Key (inclusive). */
export const IDEMPOTENCY_KEY_MAX_LEN = 128;
/** Regex for ASCII printable characters (0x20–0x7e). */
const ASCII_PRINTABLE_RE = /^[\x20-\x7e]+$/;

/** TTL for cached responses in seconds (24 hours). */
const CACHE_TTL_SECONDS = 86_400;

/** KV key prefix to avoid collisions with other namespaces. */
const KV_PREFIX = 'idem:';

/**
 * Returns a 16-character lowercase hex string derived from the first 8 bytes
 * of the SHA-256 digest of `input`.  Used to build a tenant-discriminating
 * prefix from the raw API key without requiring a KV lookup.
 */
async function shortHash(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Shape stored in KV per idempotency key. */
interface CachedEntry {
  status: number;
  body: unknown;
}

/** Minimum `Bindings` shape the middleware needs from the Worker `env`. */
export interface IdempotencyBindings {
  KV_IDEMPOTENCY: KVNamespace;
}

/**
 * Validates an `Idempotency-Key` header value.
 *
 * @returns `true` if the key is well-formed; `false` otherwise.
 */
export function isValidIdempotencyKey(key: string): boolean {
  if (key.length < IDEMPOTENCY_KEY_MIN_LEN || key.length > IDEMPOTENCY_KEY_MAX_LEN) return false;
  return ASCII_PRINTABLE_RE.test(key);
}

/**
 * Hono middleware — intercepts requests with an `Idempotency-Key` header and
 * short-circuits with the cached response on cache hit; on cache miss it lets
 * the request through and caches a successful response for 24 h.
 *
 * If no `Idempotency-Key` header is present the middleware is a no-op (passes
 * through unconditionally).
 */
export const idempotency: MiddlewareHandler<{ Bindings: IdempotencyBindings }> = async (
  c,
  next,
) => {
  const key = c.req.header('Idempotency-Key');

  // No header → not an idempotent request; pass through.
  if (!key) {
    await next();
    return;
  }

  // Validate key format.
  if (!isValidIdempotencyKey(key)) {
    return c.json(
      {
        error: {
          code: 'validation_failed',
          message:
            `Idempotency-Key must be ${String(IDEMPOTENCY_KEY_MIN_LEN)}–` +
            `${String(IDEMPOTENCY_KEY_MAX_LEN)} ASCII printable characters`,
          request_id: (c.get('requestId' as never) as string | undefined) ?? crypto.randomUUID(),
        },
      },
      400,
    );
  }

  // Scope the KV key to the tenant so two tenants with the same
  // Idempotency-Key value cannot collide.  Full auth has not run yet at this
  // point, so we derive a discriminating prefix from the raw API key header
  // using a short SHA-256 hash (first 8 bytes → 16 hex chars).  This is NOT
  // a security mechanism — it is purely a namespace separator.
  const rawApiKey = c.req.header('X-Estalara-API-Key') ?? c.req.header('x-estalara-api-key') ?? '';
  const tenantPrefix = rawApiKey ? await shortHash(rawApiKey) : 'anon';
  const kvKey = `${KV_PREFIX}${tenantPrefix}:${key}`;

  // Cache hit → return cached response.
  const cached = await c.env.KV_IDEMPOTENCY.get<CachedEntry>(kvKey, 'json');
  if (cached !== null) {
    c.header('Idempotency-Replay', 'true');
    return c.json(cached.body, cached.status as Parameters<typeof c.json>[1]);
  }

  // Cache miss → process the request.
  await next();

  // Cache only 2xx responses (errors are not cached so retries work).
  if (c.res.status >= 200 && c.res.status < 300) {
    let body: unknown;
    try {
      body = await c.res.clone().json();
    } catch {
      // Non-JSON response or unreadable body — skip caching.
      return;
    }
    const entry: CachedEntry = { status: c.res.status, body };
    await c.env.KV_IDEMPOTENCY.put(kvKey, JSON.stringify(entry), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  }
  return;
};
