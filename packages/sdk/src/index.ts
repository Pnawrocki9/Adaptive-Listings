/**
 * Estalara Adaptive Listings SDK — Tier 1 Observer
 *
 * Initialized by a <script> tag with data-api-key attribute.
 * Collects behavioral signals and sends them to the Ingest Worker.
 *
 * NEVER throws — designed to be resilient on third-party websites.
 * All errors are caught and silenced (debug mode logs to console).
 *
 * @module @estalara/sdk
 */

import { readConfig } from './core/config.js';
import { dispatchEvents, collectPageView } from './core/events.js';
import { getOrCreateSession, incrementPageCount } from './core/session.js';
import { setupObservers } from './core/observer.js';
import type { CollectedEvent } from './core/events.js';

/** Current SDK version string. */
export const SDK_VERSION = '0.0.0' as const;

/** Event queue flushed every BATCH_INTERVAL_MS or on page unload. */
const eventQueue: CollectedEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

const BATCH_INTERVAL_MS = 5_000;

/**
 * Main SDK initialization — called automatically when DOM is ready.
 * Wraps everything in try/catch to ensure the host page is never broken.
 */
async function init(): Promise<void> {
  try {
    // 1. Find the Estalara script tag (the one with data-api-key)
    const script = document.querySelector<HTMLScriptElement>('script[data-api-key]');
    if (!script) return;

    // 2. Read configuration from data-* attributes
    const config = readConfig({ dataset: script.dataset });

    // 3. Initialize anonymous session
    const session = await getOrCreateSession();
    const currentSession = incrementPageCount(session);

    // 4. Collect initial page.view event
    eventQueue.push(collectPageView());

    // 5. Set up behavioral observers
    const cleanupObservers = setupObservers(config, (event) => {
      eventQueue.push(event);
    });

    // 6. Flush events on interval and page unload
    async function flush(): Promise<void> {
      if (eventQueue.length === 0) return;
      const batch = eventQueue.splice(0);
      await dispatchEvents(batch, config, currentSession);
    }

    flushTimer = setInterval(() => void flush(), BATCH_INTERVAL_MS);

    // Flush remaining events before page unload (keepalive fetch)
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush();
    });

    window.addEventListener('beforeunload', () => void flush());

    if (config.debug) {
      console.log(`[Estalara] SDK ${SDK_VERSION} initialized`, {
        tier: config.tier,
        sessionId: currentSession.sessionId.slice(0, 8) + '...',
      });
    }

    // Store cleanup on window for testing / SPA teardown
    (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown = () => {
      if (flushTimer) clearInterval(flushTimer);
      cleanupObservers();
    };
  } catch (err) {
    // SDK initialization failed — log in debug mode, never propagate
    try {
      if (
        typeof window !== 'undefined' &&
        (window as unknown as Record<string, unknown>).__estalara_debug
      ) {
        console.error('[Estalara] Initialization error:', err);
      }
    } catch {
      // double-catch — truly silent
    }
  }
}

/**
 * Estalara.identify() — stub for Profile Mode (Sprint 12+).
 * Call this when a visitor opts in to profile creation.
 * No-op in MVP — the profile_id is stored for when Profile Mode is enabled.
 */
export function identify(_profileId: string): void {
  // No-op stub — forward-compat for Profile Mode (U.11, Sprint 12+)
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init());
  } else {
    void init();
  }
}
