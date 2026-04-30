/**
 * Per-tenant sliding-window rate limiter as a Cloudflare Durable Object.
 *
 * One DO instance per `tenant_id` (sharded via `idFromName(tenant_id)`). Each instance keeps a
 * 60-second sliding window of `{ ts, count }` entries in DO storage and rejects when a new
 * request would push the windowed total over the configured limit.
 *
 * Default limit: 50 000 events / minute / tenant (~833 events/sec). This is generous vs. typical
 * traffic (Master Design C.2 — busy tenant ≈ 1 000 events/sec; we're way over headroom) and tight
 * enough to detect runaway client bugs / abuse. Override per-tenant in Sprint 2 once tenant
 * config lives in Postgres; for MVP all tenants share the default.
 *
 * DO choice rationale (rejected alternatives):
 * - **KV** — eventually consistent; useless for rate limiting
 * - **Workers Analytics** — read-only
 * - **External Redis** — adds a network hop, extra cost, extra failure mode
 * - **DO** — strongly consistent, regional, embedded in the Worker, single-threaded per ID
 *   (serializes requests automatically — no explicit locking needed for read-modify-write)
 *
 * @module apps/ingest/src/rate-limiter
 */

import type {
  DurableObject,
  DurableObjectState,
  ExecutionContext,
} from '@cloudflare/workers-types';

/** DO bindings consumed at construction. Only `RATE_LIMIT_PER_MIN` is read; the rest is unused. */
export interface RateLimiterEnv {
  RATE_LIMIT_PER_MIN?: string;
}

/** Result returned from `incrementAndCheck` and the DO's `/check` endpoint. */
export interface RateCheckResult {
  /** True if the request fits within the window; false → caller should 429. */
  allowed: boolean;
  /** Tokens remaining in the current window AFTER this request (0 when rejected). */
  remaining: number;
  /** Epoch ms when the window resets / capacity frees. Used for `Retry-After`. */
  reset_at: number;
  /** The configured limit (echoed for the 429 body). */
  limit: number;
}

interface WindowEntry {
  ts: number;
  count: number;
}

const STORAGE_KEY = 'window';
const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 50_000;

/**
 * Cloudflare Durable Object class. Cloudflare instantiates one per unique
 * `idFromName(tenant_id)` and routes inbound `fetch()` calls to that instance.
 *
 * The DO is single-threaded per ID — concurrent requests to the same tenant queue up — so the
 * read / mutate / write sequence below is race-free without explicit locking.
 *
 * The DO exposes `POST /check` accepting `{ count: number }` and returning `RateCheckResult`.
 * Other paths return 404. Internal use only — not exposed to the outside world.
 */
export class RateLimiter implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly limit: number;

  constructor(state: DurableObjectState, env: RateLimiterEnv) {
    this.state = state;
    this.limit = parsePositiveInt(env.RATE_LIMIT_PER_MIN, DEFAULT_LIMIT);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/check') {
      return new Response('not found', { status: 404 });
    }

    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400 });
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return new Response(JSON.stringify({ error: 'invalid_count' }), { status: 400 });
    }
    const count = (parsed as { count?: unknown }).count;
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
      return new Response(JSON.stringify({ error: 'invalid_count' }), { status: 400 });
    }

    const result = await this.incrementAndCheck(count);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Sliding-window check. Reads the persisted entries, drops anything older than `WINDOW_MS`,
   * and either appends the new request or rejects.
   *
   * Reject behavior is **whole-batch**: a 1500-event batch with 1000 tokens remaining is
   * rejected (not partially accepted). Splitting batches would force the client to track
   * acceptance per-event, which we don't want at the SDK layer.
   */
  async incrementAndCheck(count: number): Promise<RateCheckResult> {
    const now = Date.now();
    const stored = (await this.state.storage.get<WindowEntry[]>(STORAGE_KEY)) ?? [];
    const fresh = stored.filter((e) => now - e.ts < WINDOW_MS);
    const used = fresh.reduce((sum, e) => sum + e.count, 0);

    if (used + count > this.limit) {
      // Find the oldest entry — that's when capacity first frees.
      const oldest = fresh[0];
      const reset_at = (oldest ? oldest.ts : now) + WINDOW_MS;
      // Persist the trimmed list so we don't keep stale entries around forever.
      if (fresh.length !== stored.length) {
        await this.state.storage.put(STORAGE_KEY, fresh);
      }
      return {
        allowed: false,
        remaining: Math.max(0, this.limit - used),
        reset_at,
        limit: this.limit,
      };
    }

    fresh.push({ ts: now, count });
    await this.state.storage.put(STORAGE_KEY, fresh);
    return {
      allowed: true,
      remaining: this.limit - used - count,
      reset_at: now + WINDOW_MS,
      limit: this.limit,
    };
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Helper used by the events handler. Sends a `/check` request to the per-tenant DO instance
 * and returns the parsed result. Caller decides what to do with `allowed: false`.
 */
export async function checkRateLimit(
  ns: DurableObjectNamespace,
  tenantId: string,
  count: number,
  ctx?: Pick<ExecutionContext, 'waitUntil'>,
): Promise<RateCheckResult> {
  // Mark `ctx` as touched — reserved for future fire-and-forget telemetry without changing
  // the function signature later.
  void ctx;
  const id = ns.idFromName(tenantId);
  const stub = ns.get(id);
  const res = await stub.fetch('https://internal/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- DO contract enforced server-side
  return (await res.json()) as RateCheckResult;
}
