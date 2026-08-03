/**
 * Adapt DOM Mutations E2E test.
 * Tests: Decision API fetch → applyDirectives → DOM textContent changes
 *
 * The fixture at e2e/fixtures/index.html mocks the decision API to return
 * yield_hunter directives. The SDK should apply them to [data-estalara-slot]
 * elements on the page.
 */
import { test, expect } from '@playwright/test';

test.describe('SDK Adapt DOM Mutations', () => {
  test.beforeEach(async ({ page }) => {
    // Wait a bit longer for SDK to init and fetch directives
    await page.addInitScript(() => {
      localStorage.setItem('estalara_consent', 'granted');
    });
    await page.goto('http://localhost:4444/');
    // SDK fetches directives asynchronously — wait for up to 3s
    await page.waitForTimeout(1000);
  });

  test('headline elements have data-estalara-slot="headline" attributes', async ({ page }) => {
    const count = await page.locator('[data-estalara-slot="headline"]').count();
    expect(count).toBeGreaterThan(0);
  });

  test('headline textContent changes to yield_hunter directive value after SDK init', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    // Re-navigate to ensure fresh SDK init
    await page.addInitScript(() => {
      localStorage.setItem('estalara_consent', 'granted');
    });
    await page.goto('http://localhost:4444/');
    await page.waitForTimeout(1200);

    // The mock decision API returns headline directive with value "Rental Yield: {yield}% | Great Investment"
    // For listing-001 with data-estalara-yield="5.2", it should interpolate to "Rental Yield: 5.2% | Great Investment"
    // For listing-003 with data-estalara-yield="" (empty), {yield} stays literal
    const headlines = await page.locator('[data-estalara-slot="headline"]').all();
    expect(headlines.length).toBeGreaterThan(0);

    // At least one headline should have been changed from the original value
    let adaptedCount = 0;
    for (const headline of headlines) {
      const text = await headline.textContent();
      if (text?.includes('Rental Yield:')) {
        adaptedCount++;
      }
    }
    // The directives should have been applied to at least some headlines
    expect(adaptedCount).toBeGreaterThan(0);

    // No JS errors
    expect(errors).toHaveLength(0);
  });

  test('feature slot textContent changes to "Investment Performance"', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    await page.addInitScript(() => {
      localStorage.setItem('estalara_consent', 'granted');
    });
    await page.goto('http://localhost:4444/');
    await page.waitForTimeout(1200);

    const featureSections = await page.locator('[data-estalara-slot="feature"]').all();
    expect(featureSections.length).toBeGreaterThan(0);

    let adaptedCount = 0;
    for (const section of featureSections) {
      const text = await section.textContent();
      if (text?.trim() === 'Investment Performance') {
        adaptedCount++;
      }
    }
    expect(adaptedCount).toBeGreaterThan(0);

    expect(errors).toHaveLength(0);
  });

  test('no JavaScript errors thrown during directive application', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    await page.addInitScript(() => {
      localStorage.setItem('estalara_consent', 'granted');
    });
    await page.goto('http://localhost:4444/');
    await page.waitForTimeout(1200);

    expect(errors).toHaveLength(0);
  });

  test('SDK global Estalara is available after init', async ({ page }) => {
    const hasGlobal = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).Estalara !== 'undefined';
    });
    expect(hasGlobal).toBe(true);
  });

  // FOLLOW-795 (RETRO-244 §4a LG-5(a)): this fixture's mock `/mock-decision` intercept
  // returns the SAME response shape for BOTH the `/adapt` POST and the
  // `/adapt/description` GET (it matches on `url.includes('mock-decision')`, not path).
  // That response has `source: 'playbook'`, not `'ai_cached'`, so `fetchDescription`
  // (adapt-description.ts) rejects it and adapt-description.ts NEVER claims ownership of
  // the headline slot — this is, unmodified, the real-world cold-start case this ticket
  // closes (no per-listing headline ever becomes available). Drives the REAL init path
  // (real SDK bundle, real MutationObserver, real fetch interception) — not a unit test
  // injecting a value into one module directly.
  test('FOLLOW-795: a framework revert of the adapted headline is repaired in a real browser (cold-start leg)', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    await page.addInitScript(() => {
      localStorage.setItem('estalara_consent', 'granted');
    });
    await page.goto('http://localhost:4444/');
    await page.waitForTimeout(1200);

    const headline = page.locator('[data-estalara-slot="headline"]').first();
    const adaptedText = await headline.textContent();
    expect(adaptedText).toContain('Rental Yield:');

    // Simulate a third-party framework re-render reverting the SDK's write — an ordinary
    // DOM mutation from the page's own JS, exactly what a React/Svelte/Vue reconciliation
    // pass would do.
    await page.evaluate(() => {
      const el = document.querySelector('[data-estalara-slot="headline"]');
      if (el) el.textContent = 'Marbella Villa';
    });

    // Give the MutationObserver callback + its rAF-deferred repair time to run in the
    // real browser event loop (no fake timers here).
    await page.waitForTimeout(500);

    const repairedText = await headline.textContent();
    // Before FOLLOW-795 this stayed 'Marbella Villa' forever (RETRO-244 §4a LG-5(a)).
    expect(repairedText).toContain('Rental Yield:');

    expect(errors).toHaveLength(0);
  });
});
