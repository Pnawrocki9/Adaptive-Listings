/**
 * Direct unit tests for lib/after-response.ts (FOLLOW-432 / AC-2).
 *
 * Two cases:
 *   1. fallback-on-throw: when next/server `after` throws (not in a request scope,
 *      e.g. unit tests calling a route handler directly), afterResponse() runs the
 *      task via the fire-and-forget fallback path.
 *   2. after-on-success: when `after` succeeds (request scope present), afterResponse()
 *      passes the task to `after` exactly once and does NOT double-run it via the
 *      fallback path.
 *
 * Both cases are exercised outside a Next.js request scope (which is the standard
 * condition when running vitest against route handlers / lib functions directly).
 *
 * @module apps/control-plane/src/lib/__tests__/after-response.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted above all imports by vitest's babel/swc transform,
// so the mocked module is in place when after-response.ts is evaluated.
vi.mock('next/server', () => ({
  after: vi.fn(),
}));

import { afterResponse } from '../after-response.js';
import { after } from 'next/server';

const mockAfter = vi.mocked(after);

describe('afterResponse()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fallback-on-throw: runs task via fire-and-forget when after() throws', async () => {
    // Simulate the "not in a request scope" error that next/server after() raises
    // when called from unit tests or non-request callers.
    mockAfter.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope');
    });

    const task = vi.fn().mockResolvedValue(undefined);
    afterResponse(task);

    // Drain the microtask queue so Promise.resolve().then(task) has completed.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('after-on-success: passes task to after() and does not double-run it', async () => {
    // Simulate a successful after() registration: invoke the callback immediately
    // (as after() would do post-response).
    mockAfter.mockImplementation((callback) => {
      void (callback as () => Promise<unknown>)();
    });

    const task = vi.fn().mockResolvedValue(undefined);
    afterResponse(task);

    // Drain any async microtasks from the callback invocation.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // after() received the task
    expect(mockAfter).toHaveBeenCalledWith(task);
    // task ran exactly once (via after's invocation) — no double-run from the catch fallback
    expect(task).toHaveBeenCalledTimes(1);
  });
});
