/**
 * Registering post-ACK work with the runtime, correctly.
 *
 * ## Why this is its own module
 *
 * Two of this repo's rules pull in opposite directions here, and a separate module is what
 * satisfies both rather than trading one off:
 *
 *   - a test must not RE-IMPLEMENT its subject — a copy cannot fail when the subject changes
 *     (FOLLOW-980's shape), so `post-ack-waituntil.test.ts` has to import the shipped function;
 *   - **Rule I (wired-or-dead)** treats an export whose only consumer is a test as dead wiring,
 *     which is exactly what exporting it from `handlers/events.ts` produced.
 *
 * Living here, it has a genuine non-test consumer (`handlers/events.ts` imports it) AND is
 * importable by the test. Producer and consumer are both real. [FOLLOW-986]
 */

interface HonoWithExecCtx {
  // `waitUntil?(p): void` — a METHOD signature, not `waitUntil?: (p) => void`. The difference is
  // load-bearing and is what let a real bug ship: a property-typed function is DETACHABLE as far
  // as TypeScript and `@typescript-eslint/unbound-method` are concerned, so the rule that exists
  // for exactly this defect (and IS enabled at `error` for this app) stayed silent on
  // `return ctx.waitUntil`. workerd defines it on the prototype, so detaching it breaks at
  // runtime. Declaring the true shape re-arms the linter as a permanent, authoring-time guard.
  executionCtx?: { waitUntil?(p: Promise<unknown>): void };
}

/**
 * Returns a function that registers a promise with the runtime's `executionCtx.waitUntil`, or
 * `undefined` when no execution context is available.
 *
 * The returned closure calls `waitUntil` ON its receiver and never extracts it into a variable —
 * extraction is the same defect in a different spelling, and the linter now rejects it.
 */
export function getWaitUntil(c: unknown): ((p: Promise<unknown>) => void) | undefined {
  try {
    const ctx = (c as HonoWithExecCtx).executionCtx;
    if (typeof ctx?.waitUntil !== 'function') return undefined;
    return (promise) => {
      ctx.waitUntil?.(promise);
    };
  } catch {
    // Hono's `executionCtx` getter throws when the context is unavailable (some test
    // environments). Returning `undefined` lets the caller announce that explicitly.
    return undefined;
  }
}
