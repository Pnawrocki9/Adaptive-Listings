/**
 * Boot-timing structural regression ceiling — FOLLOW-1037 / MP-011.
 *
 * FOLLOW-1033 made the boot decomposition permanent on the `estalara:adapt:settled` DOM event
 * (see `packages/sdk/src/core/boot-timing.ts`). MP-011 classified it `watchable-but-unwatched`:
 * nothing in CI read the numbers. This spec is the watcher — it drives the REAL `init()` path
 * through the SAME real IIFE bundle + real page + mocked ingest/decision-API pair `sdk.spec.ts`
 * uses (fixtures/index.html), not an injected value, and asserts the decomposition is present
 * and structurally sane.
 *
 * Ceiling justification (deliberately loose — this catches STRUCTURE, not milliseconds):
 * `fixtures/index.html` mocks `mock-ingest` and `mock-decision` but NOT the quiz-config /
 * intent-weights endpoints, so `init()` pays up to their real `AbortController` timeouts
 * (1000ms each — `packages/sdk/src/core/quiz-config.ts` / `core/intent-weights.ts`) in a
 * sandboxed CI runner with no route to those hosts. Worst realistic case is therefore ~2-3s of
 * genuine network-timeout waiting, not a bug. CEILING_MS = 8000 gives >2.5x headroom over that
 * worst case — loose enough that ordinary CI jitter (a cold, loaded runner) never flakes it, but
 * still an order of magnitude below the class of regression this exists to catch: a
 * "loader moved back behind async host hydration" (MP-011 measured a ~20x jump, 58ms -> 1174ms,
 * from exactly that class of change) or a reintroduced retry loop / hung promise on the boot
 * path. It is NOT tuned to this repo's current fast numbers, and MUST NOT be tightened to chase
 * them — see MP-011 in docs/ops/MEASURED_PREMISES.md for why absolute milliseconds here are not
 * durable across substrates.
 *
 * Red-first verification (Rule Q): this assertion was run once against a ceiling of 0ms to
 * confirm it actually observes and fails on the real measured `total`, and once with the
 * listener stubbed out entirely (asserting on `undefined`) to confirm a missing/absent detail
 * fails rather than silently passing — see the FOLLOW-1037 PR description for the transcripts.
 * Both reverted before this file was accepted green.
 *
 * @module packages/sdk/e2e/boot-timing-ceiling
 */

import { test, expect } from '@playwright/test';

/** See the module docblock for the full justification. */
const CEILING_MS = 8_000;

interface CapturedRequest {
  url: string;
  body: { events: { type: string }[] };
}

test.describe('Boot timing ceiling (FOLLOW-1037 / MP-011)', () => {
  test('settled detail is present, adapt/total are numbers, and total is under the structural ceiling', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__settledDetail = null;
      w.__settledFireCount = 0;
      document.addEventListener('estalara:adapt:settled', (e) => {
        w.__settledFireCount = ((w.__settledFireCount as number | undefined) ?? 0) + 1;
        w.__settledDetail = (e as CustomEvent<Record<string, number>>).detail;
      });
      localStorage.setItem('estalara_consent', 'granted');
    });

    await page.goto('http://localhost:4444/');
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__settledDetail !== null,
      { timeout: 15_000 },
    );

    const detail = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__settledDetail as Record<
        string,
        number
      > | null;
    });
    const fireCount = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__settledFireCount as number;
    });

    // `detail` is present — the reveal signal FOLLOW-1027 depends on always carries a
    // decomposition, degraded to `{}` at worst, never absent.
    expect(detail).toBeTruthy();
    expect(typeof detail?.adapt).toBe('number');
    expect(typeof detail?.total).toBe('number');
    expect(detail?.total ?? Number.POSITIVE_INFINITY).toBeLessThan(CEILING_MS);

    // AC(c): at most one `settled` dispatch per page load (and therefore at most one
    // `boot_timing` ingest event — see the eventQueue.push() call site in index.ts).
    expect(fireCount).toBe(1);
  });

  test('the boot_timing event reaches the SAME ingest endpoint as every other SDK event', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('estalara_consent', 'granted');
    });

    await page.goto('http://localhost:4444/');
    // Give SDK enough time to initialize (DOMContentLoaded + async init), same margin
    // sdk.spec.ts uses.
    await page.waitForTimeout(500);

    // Force the real flush path (production's beforeunload -> handleSessionEnd -> flush()),
    // rather than waiting out the 5s batch timer.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    await page.waitForTimeout(200);

    const requests = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__capturedRequests as
        | CapturedRequest[]
        | undefined;
    });
    const allEvents = (requests ?? []).flatMap((r) => r.body.events);
    const bootTimingEvents = allEvents.filter((e) => e.type === 'boot_timing');

    expect(bootTimingEvents.length).toBeGreaterThanOrEqual(1);
    // No new transport — every captured request in this fixture already targets mock-ingest.
    expect((requests ?? []).every((r) => r.url.includes('mock-ingest'))).toBe(true);
  });
});
