/**
 * Description-Axis Floor E2E test (FOLLOW-913 / ESC-054).
 *
 * Drives the REAL init path — not a unit test injecting `signal_count` into intent state
 * (that precision belongs to `follow-877.test.ts`; see that file's D-1/D-1b/D-7). This spec
 * proves the raised description-axis bar (`DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT = 5`) is
 * wired end-to-end in a real browser: real init(), real `cta.clicked` DOM events driving real
 * `applyBehavioralSignal()` calls, real `signal_count` accumulation, real periodic
 * `refreshDirectives()` re-fetch, and a real `/adapt/description` fetch + DOM write.
 *
 * Fixture: e2e/fixtures/description-floor.html — confidence is FIXED at 0.2 (well below
 * DOM_ADAPT_CONFIDENCE_FLOOR = 0.5) on every mock response, so every assertion below is driven
 * by the signal-count arm of the gate alone. The fixture deliberately omits the
 * `data-estalara-listing` impression-tracking marker so `signal_count` is fully deterministic:
 *   init                  → signal_count = 1  (device_type prior, index.ts applyBehavioralSignal)
 *   each real CTA `.click()` → signal_count += 1 (cta.clicked)
 *
 * `refreshDirectives()` only re-fires post-init when `signal_count % REFETCH_SIGNAL_INTERVAL`
 * (5) `=== 0` (index.ts) — which lands on exactly the same value as the new description floor,
 * so four real clicks (signal_count: 1 → 5) is the deterministic, non-flaky way to observe the
 * positive boundary without depending on IntersectionObserver viewport timing.
 */
import { test, expect } from '@playwright/test';

test.describe('SDK Description-Axis Floor (FOLLOW-913 / ESC-054)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('estalara_consent', 'granted');
    });
  });

  test('cold start (signal_count = 1, confidence 0.2): below BOTH floors — no /adapt/description fetch, description text unchanged', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('http://localhost:4444/description-floor.html');
    await page.waitForTimeout(1000);

    const descriptionFetchCount = await page.evaluate(
      () => (window as unknown as { __descriptionFetches: string[] }).__descriptionFetches.length,
    );
    expect(descriptionFetchCount).toBe(0);

    const descriptionText = await page.locator('[data-estalara-slot="description"]').textContent();
    expect(descriptionText).toContain('Original agent-authored E2E description');

    expect(errors).toHaveLength(0);
  });

  test('at signal_count = 5 via real cta.clicked events: /adapt/description IS fetched and the description slot is adapted, while confidence stays 0.2', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('http://localhost:4444/description-floor.html');
    await page.waitForTimeout(1000);

    // Real DOM clicks — each fires a real `cta.clicked` behavioral signal (observer.ts),
    // going through the SAME `applyBehavioralSignal()` path as any other real signal.
    // init already consumed 1 (device_type); 4 real clicks reach signal_count = 5, which is
    // both the new description-axis bar AND the point at which the periodic refetch
    // (`signal_count % 5 === 0`, index.ts) automatically re-invokes `refreshDirectives()`.
    const cta = page.locator('[data-estalara-cta="book-viewing"]');
    for (let i = 0; i < 4; i++) {
      await cta.click();
      await page.waitForTimeout(150);
    }

    // Let the auto-triggered refreshDirectives() + fire-and-forget description fetch settle.
    await page.waitForTimeout(1000);

    const descriptionFetchCount = await page.evaluate(
      () => (window as unknown as { __descriptionFetches: string[] }).__descriptionFetches.length,
    );
    expect(descriptionFetchCount).toBeGreaterThanOrEqual(1);

    const descriptionText = await page.locator('[data-estalara-slot="description"]').textContent();
    expect(descriptionText).toContain('ADAPTED E2E DESCRIPTION');

    // Confirms the fetch that DID happen carried confidence 0.2 the whole way through the
    // fixture's mock (i.e. this is genuinely the signal-count arm, not a confidence fluke).
    const adaptFetchCount = await page.evaluate(
      () => (window as unknown as { __adaptFetches: string[] }).__adaptFetches.length,
    );
    expect(adaptFetchCount).toBeGreaterThanOrEqual(2); // init call + the signal_count=5 refetch

    expect(errors).toHaveLength(0);
  });

  test('at signal_count = 3 via a real listing.viewed navigation (the OLD shared bar, cleared; the NEW bar, not): no /adapt/description fetch', async ({
    page,
  }) => {
    // This is the test that DISCRIMINATES the old value (2) from the new value (5) in a real
    // browser. The two tests above prove the mechanism is wired but do NOT, by themselves, prove
    // the bar moved — under the OLD DOM_ADAPT_MIN_SIGNAL_COUNT (2), both would still pass
    // unchanged, because neither one observes a refreshDirectives() call at any signal_count in
    // [2, 4] (the periodic refetch only fires at multiples of 5). This test forces exactly that
    // observation using a REAL DOM mutation the SDK's own MutationObserver-based SPA-navigation
    // detector reacts to (core/observer.ts `navMutObs`, watching `data-estalara-listing-id`):
    // toggling `data-estalara-listing-id` to a new value on an element that also carries
    // `data-estalara-listing` fires a real `listing.viewed` signal AND triggers an
    // UNCONDITIONAL `refreshDirectives()` call — independent of the `% 5` periodic cadence.
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('http://localhost:4444/description-floor.html');
    await page.waitForTimeout(1000);

    // signal_count = 1 (init) + 1 (this cta.clicked) = 2.
    await page.locator('[data-estalara-cta="book-viewing"]').click();
    await page.waitForTimeout(200);

    // Mark the listing container as a tracked listing card AND change its listing-id in the
    // SAME synchronous script — the SDK's navMutObs only reacts to `data-estalara-listing-id`
    // attribute mutations (attributeFilter), so both attributes must already be present when
    // that mutation is observed for `hasAttribute('data-estalara-listing')` to read true.
    // This fires exactly ONE real listing.viewed signal: signal_count = 2 + 1 = 3, and
    // triggers refreshDirectives() unconditionally (a listing_id the SDK has never seen).
    await page.evaluate(() => {
      const container = document.querySelector('[data-estalara-listing-id]');
      if (!container) throw new Error('fixture container not found');
      container.setAttribute('data-estalara-listing', '');
      container.setAttribute('data-estalara-listing-id', 'listing-desc-floor-e2e-nav');
    });
    await page.waitForTimeout(1000);

    const descriptionFetchCount = await page.evaluate(
      () => (window as unknown as { __descriptionFetches: string[] }).__descriptionFetches.length,
    );
    // signal_count = 3: clears the OLD directive-shared bar (2) but NOT the new
    // DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT (5). Under the pre-FOLLOW-913 code this assertion
    // would fail (descriptionFetchCount >= 1).
    expect(descriptionFetchCount).toBe(0);

    const descriptionText = await page.locator('[data-estalara-slot="description"]').textContent();
    expect(descriptionText).toContain('Original agent-authored E2E description');

    // The DIRECTIVE axis, by contrast, DOES clear at signal_count = 3 (>= 2, unaffected by
    // FOLLOW-913) — confirms the refreshDirectives() call this test depends on actually ran.
    const headlineText = await page.locator('[data-estalara-slot="headline"]').textContent();
    expect(headlineText).toContain('Adapted E2E Headline');

    expect(errors).toHaveLength(0);
  });
});
