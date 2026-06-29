/**
 * Vercel-safe fire-and-forget registration for post-response async work (FOLLOW-431 / ESC-033).
 *
 * On Vercel an un-awaited `fetch` issued after `return NextResponse.json(...)` is not guaranteed
 * to flush before the function instance is suspended, so analytics/audit writes (and their
 * fail-loud Sentry captures) are silently dropped. Next.js `after()` defers the work until after
 * the response is sent while keeping the instance alive — but `after()` THROWS when called outside
 * a request scope (`"`after` was called outside a request scope`"`), which is exactly what unit
 * tests do when they invoke a route handler or `callLlmGateway` directly.
 *
 * `afterResponse` registers the task via `after()` when a request scope exists (production) and
 * falls back to plain un-awaited execution otherwise (unit tests / non-request callers). The task
 * itself must own its error handling — every sink in this app already captures internally and never
 * rejects — so the fallback's `.catch` is only a guard against an unexpected throw.
 *
 * @module apps/control-plane/src/lib/after-response
 */

import { after } from 'next/server';

/**
 * Run fire-and-forget async work after the HTTP response is sent (Vercel-safe).
 *
 * @param task - The async work to run. Must handle its own errors (never reject in normal flow).
 */
export function afterResponse(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    // Not inside a request scope (e.g. unit tests calling the handler directly): `after()` throws.
    // Fall back to fire-and-forget so the sink still runs and the handler is unaffected.
    void Promise.resolve()
      .then(task)
      .catch(() => {
        /* task owns its error handling; swallow any unexpected throw */
      });
  }
}
