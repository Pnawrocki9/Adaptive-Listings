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
 * Send a batch of events to the Ingest Worker.
 * Silently swallows all errors -- never propagates to the host page.
 */
export async function dispatchEvents(
  events: CollectedEvent[],
  config: SdkConfig,
  session: SessionState,
): Promise<void> {
  if (events.length === 0) return;

  try {
    const body = {
      events: events.map((e) => ({
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
    };

    await fetch(config.ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Canonical auth header -- ingest Worker reads X-Estalara-API-Key only
        // (apps/ingest/src/auth.ts:61). Authorization: Bearer was the old SDK
        // pattern and caused 401 on every request (RUNTIME_READINESS_AUDIT B3).
        'X-Estalara-API-Key': config.apiKey,
        'x-session-id': session.sessionId,
      },
      body: JSON.stringify(body),
      // keepalive ensures delivery during page unload
      keepalive: true,
    });
  } catch {
    if (config.debug) {
      console.error('[Estalara] Failed to dispatch events -- continuing silently');
    }
  }
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
