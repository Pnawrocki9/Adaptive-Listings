/**
 * Event collection and dispatch to the Estalara Ingest Worker.
 *
 * dispatchEvents() NEVER throws — the SDK must not break the host page.
 *
 * @module @estalara/sdk/core/events
 */

import type { SdkConfig } from './config.js';
import type { SessionState } from './session.js';

export interface CollectedEvent {
  type: string;
  payload: Record<string, unknown>;
  ts: number;
}

/** Placeholder tenant UUID sent by the SDK (ingest worker overwrites with real tenant). */
const PLACEHOLDER_TENANT_ID = '00000000-0000-0000-0000-000000000000';

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
 * Silently swallows all errors — never propagates to the host page.
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
        consent_state: config.consentState === 'opted_out' ? 'none' : 'legitimate-interest',
        schema_version: 1 as const,
        type: e.type,
        payload: e.payload,
      })),
    };

    await fetch(config.ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        'x-session-id': session.sessionId,
      },
      body: JSON.stringify(body),
      // keepalive ensures delivery during page unload
      keepalive: true,
    });
  } catch {
    if (config.debug) {
      console.error('[Estalara] Failed to dispatch events — continuing silently');
    }
  }
}

/** Collect a page.view event from the current browser context. */
export function collectPageView(): CollectedEvent {
  return {
    type: 'page.view',
    payload: {
      url: typeof location !== 'undefined' ? location.href : '',
      referrer: typeof document !== 'undefined' ? document.referrer : '',
      device_class:
        typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 ? 'mobile' : 'desktop',
    },
    ts: Date.now(),
  };
}

/** Collect a scroll.depth event at a given depth milestone. */
export function collectScrollDepth(depthPercent: number): CollectedEvent {
  return {
    type: 'scroll.depth',
    payload: { depth_percent: depthPercent },
    ts: Date.now(),
  };
}
