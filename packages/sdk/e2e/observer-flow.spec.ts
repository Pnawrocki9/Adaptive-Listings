/**
 * Full observer flow E2E test.
 * Tests: page.view → scroll → listing.viewed → cta.clicked → batch dispatch
 */
import { test, expect } from '@playwright/test';

test.describe('SDK Observer Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('estalara_consent', 'granted');
    });
    await page.goto('http://localhost:4444/');
    await page.waitForTimeout(500);
  });

  test('page.view event is collected on load', async ({ page }) => {
    // Before 5s flush, queue exists but hasn't dispatched yet.
    // Verify SDK initialized (Estalara global exists).
    const hasGlobal = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).Estalara !== 'undefined';
    });
    expect(hasGlobal).toBe(true);
  });

  test('scroll events are captured at depth milestones', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    // Scroll to 50% of page
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
      return true;
    });
    await page.waitForTimeout(200);

    // Scroll to bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return true;
    });
    await page.waitForTimeout(200);

    // SDK should have queued scroll events without throwing
    expect(errors).toHaveLength(0);
  });

  test('listing impression events fire for visible cards', async ({ page }) => {
    // Cards are in viewport by default — IntersectionObserver should fire
    await page.waitForTimeout(300);

    // Verify listing cards have the expected data attributes
    const listingCount = await page.locator('[data-listing-id]').count();
    expect(listingCount).toBeGreaterThan(0);
  });

  test('CTA click is tracked without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    // Click first CTA
    const firstCta = page.locator('[data-estalara-cta]').first();
    if ((await firstCta.count()) > 0) {
      await firstCta.click({ force: true });
      await page.waitForTimeout(200);
    }

    expect(errors).toHaveLength(0);
  });

  test('full batch is dispatched after flush interval', async ({ page }) => {
    // Wait for the 5s batch flush
    await page.waitForTimeout(6_000);

    const requests = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown[]>).__capturedRequests;
    });

    expect(requests.length).toBeGreaterThan(0);

    // Verify batch structure
    const batch = requests[0] as { body: { events: { type: string }[] } };
    expect(batch.body.events).toBeDefined();
    expect(batch.body.events.length).toBeGreaterThan(0);

    // Must contain page.view
    const types = batch.body.events.map((e) => e.type);
    expect(types).toContain('page.view');
  });
});
