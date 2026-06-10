// @vitest-environment jsdom
/**
 * FOLLOW-262: scroll-depth RAF throttle in setupObservers().
 *
 * Verifies that:
 *   - Multiple scroll events in one animation frame coalesce into one RAF call
 *   - A second scroll event after the frame flushes queues a new RAF
 *   - cleanup() calls cancelAnimationFrame when a RAF is pending
 *   - cleanup() does NOT call cancelAnimationFrame when nothing is pending
 *   - scroll.depth milestones still fire correctly through the throttled path
 *   - Each milestone fires only once regardless of repeated scrolls
 *
 * @module packages/sdk/src/__tests__/observer-scroll
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupObservers } from '../core/observer.js';
import type { CollectedEvent } from '../core/events.js';
import type { SdkConfig } from '../core/config.js';

const BASE_CONFIG: SdkConfig = {
  apiKey: 'pk_live_test',
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
};

// ─── RAF stub ─────────────────────────────────────────────────────────────────

interface RafStub {
  /** Execute all pending RAF callbacks (simulates one frame tick). */
  flush: () => void;
  /** Count of currently pending (not-yet-run, not-yet-cancelled) RAF callbacks. */
  pendingCount: () => number;
  rafSpy: ReturnType<typeof vi.fn>;
  cafSpy: ReturnType<typeof vi.fn>;
}

function stubRaf(): RafStub {
  const callbacks: (((time: number) => void) | null)[] = [];

  const rafSpy = vi.fn((cb: (time: number) => void): number => {
    const id = callbacks.length;
    callbacks.push(cb);
    return id;
  });

  const cafSpy = vi.fn((id: number): void => {
    if (id >= 0 && id < callbacks.length) callbacks[id] = null;
  });

  vi.stubGlobal('requestAnimationFrame', rafSpy);
  vi.stubGlobal('cancelAnimationFrame', cafSpy);

  return {
    flush() {
      const snapshot = callbacks.slice();
      callbacks.length = 0;
      for (const cb of snapshot) {
        if (cb !== null) cb(0);
      }
    },
    pendingCount: () => callbacks.filter((cb) => cb !== null).length,
    rafSpy,
    cafSpy,
  };
}

/** Override scroll-position globals so milestone logic can calculate depth. */
function setScrollPosition(scrollY: number, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
  });
}

describe('setupObservers — scroll RAF throttle (FOLLOW-262)', () => {
  let cleanup: (() => void) | undefined;
  let emitted: CollectedEvent[];
  let raf: RafStub;

  beforeEach(() => {
    emitted = [];
    document.body.innerHTML = '';
    raf = stubRaf();
  });

  afterEach(() => {
    cleanup?.();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('multiple scroll events within one frame queue only a single RAF call', () => {
    cleanup = setupObservers(BASE_CONFIG, (e) => emitted.push(e));
    setScrollPosition(0, 1000, 200);

    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));

    expect(raf.rafSpy).toHaveBeenCalledTimes(1);
    expect(raf.pendingCount()).toBe(1);
  });

  it('after the frame flushes, the next scroll event can queue a new RAF', () => {
    cleanup = setupObservers(BASE_CONFIG, (e) => emitted.push(e));
    setScrollPosition(0, 1000, 200);

    window.dispatchEvent(new Event('scroll'));
    raf.flush();
    expect(raf.pendingCount()).toBe(0);

    window.dispatchEvent(new Event('scroll'));
    expect(raf.rafSpy).toHaveBeenCalledTimes(2);
    expect(raf.pendingCount()).toBe(1);
  });

  it('cleanup() calls cancelAnimationFrame with the pending RAF id', () => {
    const cleanupFn = setupObservers(BASE_CONFIG, (e) => emitted.push(e));
    setScrollPosition(0, 1000, 200);

    window.dispatchEvent(new Event('scroll'));
    const rafId = 0; // first RAF call gets id 0 from our stub

    cleanupFn();

    expect(raf.cafSpy).toHaveBeenCalledWith(rafId);
  });

  it('cleanup() does NOT call cancelAnimationFrame when no RAF is pending', () => {
    const cleanupFn = setupObservers(BASE_CONFIG, (e) => emitted.push(e));
    // No scroll dispatched — no RAF queued
    cleanupFn();

    expect(raf.cafSpy).not.toHaveBeenCalled();
  });

  it('scroll.depth 25% milestone fires after the RAF callback runs', () => {
    cleanup = setupObservers(BASE_CONFIG, (e) => emitted.push(e));
    // scrollTop=200, scrollHeight=1000, clientHeight=200 → docHeight=800 → 25%
    setScrollPosition(200, 1000, 200);

    window.dispatchEvent(new Event('scroll'));

    // Milestone must NOT fire before the frame runs
    expect(emitted.filter((e) => e.type === 'scroll.depth')).toHaveLength(0);

    raf.flush();

    const depths = emitted.filter((e) => e.type === 'scroll.depth');
    expect(depths).toHaveLength(1);
    expect(depths[0]?.payload.pct).toBe(25);
  });

  it('a milestone fires only once even when multiple RAF flushes pass at the same depth', () => {
    cleanup = setupObservers(BASE_CONFIG, (e) => emitted.push(e));
    setScrollPosition(200, 1000, 200); // 25%

    window.dispatchEvent(new Event('scroll'));
    raf.flush();

    // Same position again
    window.dispatchEvent(new Event('scroll'));
    raf.flush();

    const depths = emitted.filter((e) => e.type === 'scroll.depth' && e.payload.pct === 25);
    expect(depths).toHaveLength(1);
  });

  it('50% milestone fires when scroll reaches that position', () => {
    cleanup = setupObservers(BASE_CONFIG, (e) => emitted.push(e));
    // scrollTop=400, docHeight=800 → 50%
    setScrollPosition(400, 1000, 200);

    window.dispatchEvent(new Event('scroll'));
    raf.flush();

    const depths = emitted.filter((e) => e.type === 'scroll.depth');
    const pcts = depths.map((e) => e.payload.pct as number);
    expect(pcts).toContain(25);
    expect(pcts).toContain(50);
  });
});
