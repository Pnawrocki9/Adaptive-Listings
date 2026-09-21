/**
 * Event collection and dispatch to the Estalara Ingest Worker.
 *
 * dispatchEvents() NEVER throws — the SDK must not break the host page.
 *
 * @module @estalara/sdk/core/events
 */

import type { SdkConfig } from './config.js';
import type { SessionState } from './session.js';
import { getConsentState } from './session.js';

export interface CollectedEvent {
  type: string;
  payload: Record<string, unknown>;
  ts: number;
}

/** Placeholder tenant UUID sent by the SDK (ingest worker overwrites with real tenant). */
const PLACEHOLDER_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Map the session-level consent state (from getConsentState()) to the ingest
 * ConsentStateSchema enum used in the event envelope.
 *
 * Session → Ingest mapping (F-01 / FOLLOW-194):
 *   'granted' -> 'consented'            -- explicit opt-in from the consent banner
 *   'pending' -> 'legitimate-interest'  -- no decision yet; SDK operates under LI basis
 *   'denied'  -> 'none'                 -- user denied; dispatchEvents is only called
 *                                        for the consent.denied audit event in this case
 *
 * @internal exported for unit testing only
 */
export function mapConsentState(
  sessionState: 'granted' | 'denied' | 'pending',
): 'consented' | 'legitimate-interest' | 'none' {
  if (sessionState === 'granted') return 'consented';
  if (sessionState === 'denied') return 'none';
  return 'legitimate-interest';
}

/** Generate a UUIDv4 using the Web Crypto API. */
function generateEventId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    // Fallback for environments without randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

/**
 * A batch frozen at formation so a retry re-sends byte-identical events (FOLLOW-1242).
 *
 * Dedup contract: `key` goes out as the `Idempotency-Key` header. Ingest's idempotency
 * middleware (apps/ingest/src/middleware/idempotency.ts, mounted on `/v1/events/*`) caches a 2xx
 * response per (API key, Idempotency-Key) for 24h and replays it on a repeat, so re-sending a
 * batch whose first attempt DID land (but whose response we never saw) writes no duplicate rows.
 * The `event_id`s inside `body` are frozen too (ClickHouse per-event dedup downstream).
 */
export interface EventBatch {
  /** `Idempotency-Key` — a UUIDv4 (36 chars, inside ingest's 32–128 printable-ASCII rule). */
  key: string;
  /** Serialized request body; never rebuilt, so event_ids stay stable across retries. */
  body: string;
  /** Flushes this batch has been part of (1 = the flush that formed it). */
  n: number;
}

/**
 * A batch whose send fails on its MAX_FLUSHES-th flush is dropped. This is also the memory bound:
 * a flush adds at most one batch and every held batch is gone by its MAX_FLUSHES-th flush, so a
 * dead endpoint never holds more than MAX_FLUSHES batches.
 */
const MAX_FLUSHES = 16;

/**
 * Send the Ingest Worker a batch made of `queue` (spliced empty), plus the held batches in
 * `pending` that are due. Called with no `pending` (the consent.denied audit event, after which
 * the SDK halts) this is a single attempt with no retry.
 *
 * FOLLOW-1242 retry policy. Retryable: a rejected fetch (network error, or a CORS-less error
 * response, which the browser reports as a rejected fetch), 5xx and 429 -- the batch goes back
 * into `pending`. Any other 4xx (validation/auth) would fail identically again: dropped.
 * Backoff is counted in flushes, not ms: a held batch is re-sent on its 2nd, 4th, 8th and 16th
 * flush (~5s, 15s, 35s, 75s later at the 5s interval), then dropped if still failing -- at most
 * 5 timed sends. `force` (hide/unload, maybe the last chance) sends every held batch at once.
 * In-flight batches are out of `pending`, so overlapping flushes never double-send one.
 * `pending` is owned by the caller: one per SDK instance.
 *
 * Never throws -- the SDK must not break the host page.
 */
export async function dispatchEvents(
  queue: CollectedEvent[],
  config: SdkConfig,
  session: SessionState,
  pending: EventBatch[] = [],
  force?: boolean,
): Promise<void> {
  // Newest first: on unload it takes the 64 KiB keepalive quota before older retries do.
  if (queue.length > 0) {
    pending.unshift({
      key: generateEventId(),
      body: JSON.stringify({
        events: queue.splice(0).map((e) => ({
          event_id: generateEventId(),
          tenant_id: PLACEHOLDER_TENANT_ID,
          session_id: session.sessionId,
          ts: e.ts,
          region: 'eu' as const,
          // F-01 (FOLLOW-194): map live session consent state to the ingest enum.
          // Previously hardcoded to 'legitimate-interest', so users who granted consent
          // were never marked 'consented' in the GDPR audit trail.
          consent_state: mapConsentState(getConsentState()),
          schema_version: 1 as const,
          type: e.type,
          payload: e.payload,
        })),
      }),
      n: 0,
    });
  }
  await Promise.all(
    pending.splice(0).map(async (b) => {
      // `n & (n - 1)` is 0 exactly when n is a power of two. Forced flushes count too, so a
      // batch lives at most MAX_FLUSHES flushes of any kind.
      if (!(++b.n & (b.n - 1)) || force) {
        try {
          const res = await fetch(config.ingestUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Canonical auth header -- ingest Worker reads X-Estalara-API-Key only
              // (apps/ingest/src/auth.ts:61). Authorization: Bearer was the old SDK
              // pattern and caused 401 on every request (RUNTIME_READINESS_AUDIT B3).
              'X-Estalara-API-Key': config.apiKey,
              'x-session-id': session.sessionId,
              'Idempotency-Key': b.key,
            },
            body: b.body,
            // keepalive ensures delivery during page unload
            keepalive: true,
          });
          // Delivered, or a non-retryable 4xx: done with this batch either way.
          if (res.status < 500 && res.status !== 429) return;
        } catch {
          // Network error / CORS-less error response: fall through to retry.
        }
        if (b.n >= MAX_FLUSHES) return;
      }
      pending.push(b);
    }),
  );
}

/** Collect a page.view event from the current browser context. */
export function collectPageView(): CollectedEvent {
  // Collect viewport dimensions (required by PageViewPayloadSchema).
  // window.innerWidth/innerHeight are available in all modern browsers.
  const viewport =
    typeof window !== 'undefined'
      ? { width: window.innerWidth, height: window.innerHeight }
      : undefined;

  // Only include url/referrer when they are non-empty valid strings.
  // Empty strings fail z.string().url() validation (RUNTIME_READINESS_AUDIT B3).
  const rawUrl = typeof location !== 'undefined' ? location.href : '';
  const rawReferrer = typeof document !== 'undefined' ? document.referrer : '';

  const payload: Record<string, unknown> = {
    device_class:
      typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 ? 'mobile' : 'desktop',
  };
  if (rawUrl) payload.url = rawUrl;
  if (rawReferrer) payload.referrer = rawReferrer;
  if (viewport) payload.viewport = viewport;

  return {
    type: 'page.view',
    payload,
    ts: Date.now(),
  };
}

/**
 * `boot_timing` is queued directly at its one call site in `index.ts` (the `mark('settled')`
 * block in `init()`) rather than through a `collect*()` helper here, because its payload is
 * `bootTimings()`'s own return value verbatim — there is nothing to derive from browser globals.
 * Field names (`preInit`, `initToConfig`, `configFetch`, `configToAdapt`, `adapt`, `total`) mirror
 * `BootTimingPayloadSchema` in `packages/shared/src/schemas/events/boot-timing.ts` 1:1; keep them
 * in sync if either side changes a field name.
 */

/** Collect a scroll.depth event at a given depth milestone. */
export function collectScrollDepth(depthPercent: number): CollectedEvent {
  // Field name is `pct` per ScrollDepthPayloadSchema in packages/shared/src/schemas/events/mouse-scroll.ts.
  // The old name `depth_percent` caused every scroll event to be rejected (RUNTIME_READINESS_AUDIT B3).
  return {
    type: 'scroll.depth',
    payload: { pct: depthPercent },
    ts: Date.now(),
  };
}
