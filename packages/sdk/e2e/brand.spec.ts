/**
 * E2E tests for the per-tenant brand slice — FOLLOW-623 / ADR-0019.
 *
 * Drives the REAL SDK init path (NOT a value-injecting unit test — evidence requirement):
 *   GET /mock-decision/api/quiz/public-config  (serve.js emits a `brand` slice)
 *     → fetchQuizConfig() parses PresentationConfigResponse
 *       → mergeQuizConfig() overlays SdkConfig.brand
 *         → renderQuizTrigger() paints the sticky trigger with brand.primary_color
 *         → renderQuizWidget()  renders the brand logo atop the quiz card
 *
 * The 30s quiz-trigger delay (`QUIZ_TRIGGER_DELAY_MS`) is skipped with Playwright's fake
 * clock so the test stays fast while exercising the same production timer path.
 *
 * @module packages/sdk/e2e/brand
 */

import { test, expect, type Page } from '@playwright/test';

const PUBLIC_CONFIG_URL = 'http://localhost:4444/mock-decision/api/quiz/public-config';
const BRAND_PRIMARY_RGB = 'rgb(26, 115, 232)'; // #1a73e8
const BRAND_LOGO_URL = 'http://localhost:4444/e2e/fixtures/brand-logo.svg';

/**
 * Load the brand fixture with consent pre-granted and a fake clock installed, then advance
 * past the 30s trigger delay so the (real) scheduled trigger fires.
 */
async function gotoBrandAndRevealTrigger(page: Page): Promise<void> {
  await page.clock.install();
  await page.addInitScript(() => {
    localStorage.setItem('estalara_consent', 'granted');
  });
  // Register the response waiter BEFORE navigating so the real config fetch (which fires
  // during async init) cannot resolve before the listener is attached (avoids a race).
  const configResponse = page.waitForResponse(PUBLIC_CONFIG_URL);
  await page.goto('http://localhost:4444/brand.html');
  await configResponse;
  // Let the remaining awaited init steps settle (merge + directives + trigger scheduling)
  // — real test-runner time, independent of the faked page clock.
  await page.waitForTimeout(500);
  // Fast-forward past QUIZ_TRIGGER_DELAY_MS (30s) so the scheduled trigger renders.
  await page.clock.runFor(31_000);
}

test.describe('SDK brand slice (FOLLOW-623 / ADR-0019)', () => {
  test('SDK initializes without errors on the brand fixture', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await gotoBrandAndRevealTrigger(page);
    expect(errors).toHaveLength(0);
  });

  test('quiz trigger background uses brand.primary_color from the fetched config', async ({
    page,
  }) => {
    await gotoBrandAndRevealTrigger(page);

    // Compare the trigger's computed background INSIDE the page (returning a boolean keeps
    // the evaluate return DOM-type-free, matching the existing consent.spec pattern). The
    // brand color (#1a73e8 → rgb(26,115,232)) proves the fetched brand slice reached the
    // real render path; if it matched, it is definitionally NOT the #ef4444 default.
    const bgIsBrand = await page.evaluate((expected: string): boolean => {
      const host = document.querySelector('[data-estalara-host]');
      const btn = host?.shadowRoot?.querySelector('.estalara-trigger');
      return !!btn && window.getComputedStyle(btn).backgroundColor === expected;
    }, BRAND_PRIMARY_RGB);
    expect(bgIsBrand).toBe(true);

    // And assert it is NOT the hardcoded #ef4444 default.
    const bgIsDefault = await page.evaluate((): boolean => {
      const host = document.querySelector('[data-estalara-host]');
      const btn = host?.shadowRoot?.querySelector('.estalara-trigger');
      return !!btn && window.getComputedStyle(btn).backgroundColor === 'rgb(239, 68, 68)';
    });
    expect(bgIsDefault).toBe(false);
  });

  test('quiz widget renders the brand logo atop the card after the trigger is clicked', async ({
    page,
  }) => {
    await gotoBrandAndRevealTrigger(page);

    await page.locator('button.estalara-trigger').click();

    // Assert the brand logo <img> rendered with the fetched src (boolean return — no DOM
    // types leak out of the evaluate, matching the consent.spec pattern).
    const logoRendered = await page.evaluate((expected: string): boolean => {
      const host = document.querySelector('[data-estalara-host]');
      const img = host?.shadowRoot?.querySelector('img.estalara-quiz-logo');
      return !!img && img.getAttribute('src') === expected;
    }, BRAND_LOGO_URL);
    expect(logoRendered).toBe(true);
  });
});
