/**
 * E2E test for the FOLLOW-1138 widened page-type heuristic.
 *
 * Verifies end-to-end, through the REAL SDK bundle in a real browser (Rule Q — not a unit test
 * injecting a value into one module directly):
 *
 *   page served at a path without '/listing/', no data-page-type attribute, exactly one
 *   [data-estalara-listing-id] element on the page (the FOLLOW-819 differentiator fixture's
 *   exact shape)
 *     → detectPageType()'s widened heuristic (packages/sdk/src/index.ts)
 *       → the real `POST /adapt` request body carries page_type: 'listing_detail'
 *         → an adapt.page_type_resolved event reaches the real ingest batch with
 *           provenance: 'dom_signal'
 *
 * Before FOLLOW-1138 this page's `page_type` resolved 'listing_list', and
 * `filterDirectivesByPageType()` (apps/control-plane/src/app/api/adapt/route.ts:1269) stripped
 * the `headline` directive server-side, silently — the exact defect this ticket fixed.
 *
 * @module packages/sdk/e2e/page-type-signal
 */
import { test, expect } from '@playwright/test';

test.describe('SDK page-type widened heuristic (FOLLOW-1138)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('estalara_consent', 'granted');
    });
    await page.goto('http://localhost:4444/page-type-signal.html');
    await page.waitForTimeout(1200);
  });

  test('the real POST /adapt request carries page_type: listing_detail for a single-listing page with no /listing/ URL and no data-page-type', async ({
    page,
  }) => {
    const adaptRequests = await page.evaluate(
      () => (window as unknown as { __adaptRequests: { page_type?: string }[] }).__adaptRequests,
    );

    expect(adaptRequests.length).toBeGreaterThan(0);
    expect(adaptRequests[0]?.page_type).toBe('listing_detail');
  });

  test('an adapt.page_type_resolved event (provenance: dom_signal) reaches the real ingest batch', async ({
    page,
  }) => {
    // Force the real beforeunload flush path (production teardown), same pattern as
    // boot-timing-ceiling.spec.ts.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    await page.waitForTimeout(500);

    const requests = await page.evaluate(
      () =>
        (
          window as unknown as {
            __capturedRequests: { body: { events: { type: string; payload: unknown }[] } }[];
          }
        ).__capturedRequests,
    );

    const allEvents = requests.flatMap((r) => r.body.events);
    const resolvedEvents = allEvents.filter((e) => e.type === 'adapt.page_type_resolved');
    expect(resolvedEvents.length).toBeGreaterThan(0);
    expect(resolvedEvents[0]?.payload).toMatchObject({
      page_type: 'listing_detail',
      provenance: 'dom_signal',
    });
  });

  test('the headline slot is not stripped -- an observable DOM change reaches [data-estalara-slot="headline"]', async ({
    page,
  }) => {
    const headline = page.locator('[data-estalara-slot="headline"]').first();
    await expect(headline).toHaveText(/Rental Yield/);
  });

  test('no JavaScript errors thrown during page-type resolution or directive application', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });
    await page.reload();
    await page.waitForTimeout(1200);
    expect(errors).toHaveLength(0);
  });
});
