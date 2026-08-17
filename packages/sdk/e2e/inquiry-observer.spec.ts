/**
 * E2E tests for inquiry.started observer — FOLLOW-097
 *
 * Verifies that inquiry_submit_selector flows end-to-end:
 *   data-inquiry-submit-selector (script tag)
 *     → SdkConfig.inquirySubmitSelector
 *       → setupObservers() options.inquirySubmitSelector
 *         → inquiry.started event fired on click
 *
 * Also covers the SPA navigation race-condition: selector element injected
 * after SDK init must still be caught by the delegated click handler.
 *
 * @module packages/sdk/e2e/inquiry-observer
 */

import { test, expect, type Page } from '@playwright/test';

/**
 * Pre-granted consent PLUS the quiz-dismissed cooldown (FOLLOW-1015).
 *
 * The quiz card auto-opens on init now and anchors bottom-left, and this fixture's buttons are
 * appended to the end of a very short document — i.e. into that same corner — so the card
 * covers them and Playwright's actionability check refuses the click. That is fixture
 * geometry, not a product defect (any floating widget covers whatever sits under it; real
 * listing pages do not put their inquiry CTA in the bottom-left 24/96 box). These specs are
 * about the inquiry observer, so they suppress the quiz exactly the way a returning visitor
 * who closed it would, and `brand.spec.ts` keeps the coverage that the card renders at all.
 */
function seedInquiryStorage(): void {
  localStorage.setItem('estalara_consent', 'granted');
  localStorage.setItem('__estalara_quiz_dismissed__', String(Date.now()));
}

/** Navigate to the inquiry fixture and wait for SDK init. */
async function gotoInquiry(page: Page): Promise<void> {
  await page.addInitScript(seedInquiryStorage);
  await page.goto('http://localhost:4444/inquiry.html');
  // Give SDK enough time to initialize (DOMContentLoaded + async init)
  await page.waitForTimeout(600);
}

test.describe('SDK inquiry.started observer (FOLLOW-097)', () => {
  test('SDK initializes without errors on inquiry fixture', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await gotoInquiry(page);
    expect(errors).toHaveLength(0);
  });

  test('inquiry.started fires when the inquiry-submit button is clicked', async ({ page }) => {
    await gotoInquiry(page);

    // The SDK uses a delegated click listener on document — clicking the
    // button should immediately queue an inquiry.started event.
    await page.click('#inquiry-submit-btn');

    // Wait for the 5s batch flush to dispatch events to mock-ingest
    await page.waitForTimeout(6_000);

    const fired = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__inquiryStartedFired as boolean;
    });
    expect(fired).toBe(true);
  });

  test('inquiry.started payload has form_variant = contact_v2', async ({ page }) => {
    await gotoInquiry(page);

    await page.click('#inquiry-submit-btn');
    await page.waitForTimeout(6_000);

    const requests = await page.evaluate(() => {
      return (
        window as unknown as {
          __capturedRequests: {
            body: { events: { type: string; payload: Record<string, unknown> }[] };
          }[];
        }
      ).__capturedRequests;
    });

    const allEvents = requests.flatMap((r) => r.body.events);
    const inquiryEvent = allEvents.find((e) => e.type === 'inquiry.started');

    expect(inquiryEvent).toBeDefined();
    expect(inquiryEvent?.payload).toMatchObject({ form_variant: 'contact_v2' });
  });

  test('decoy button click does NOT fire inquiry.started', async ({ page }) => {
    await gotoInquiry(page);

    // Click the decoy button — it does NOT match the inquiry-submit selector
    await page.click('#decoy-btn');
    await page.waitForTimeout(6_000);

    const fired = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__inquiryStartedFired as boolean;
    });
    expect(fired).toBe(false);
  });

  test('inquiry.started fires even when button is injected after SDK init (SPA race condition)', async ({
    page,
  }) => {
    await page.addInitScript(seedInquiryStorage);
    await page.goto('http://localhost:4444/inquiry.html');
    await page.waitForTimeout(600);

    // Simulate SPA navigation: remove the existing button and inject a new one
    // with the same selector AFTER SDK is already initialized.
    await page.evaluate(() => {
      // Remove the original button
      const orig = document.getElementById('inquiry-submit-btn');
      if (orig) orig.remove();

      // Inject a brand-new button matching the same selector (simulates SPA route change)
      const newBtn = document.createElement('button');
      newBtn.id = 'spa-inquiry-btn';
      newBtn.setAttribute('data-estalara-slot', 'inquiry-submit');
      newBtn.textContent = 'New Route Inquiry';
      document.body.appendChild(newBtn);
    });

    // Wait a tick for any MutationObserver callbacks
    await page.waitForTimeout(100);

    // Click the new button
    await page.click('#spa-inquiry-btn');
    await page.waitForTimeout(6_000);

    // Because the SDK uses a delegated listener on document (not a direct
    // querySelector binding), the new button is caught without re-running setup.
    const fired = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__inquiryStartedFired as boolean;
    });
    expect(fired).toBe(true);
  });
});
