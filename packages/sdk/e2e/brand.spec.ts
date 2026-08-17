/**
 * E2E tests for the per-tenant brand slice — FOLLOW-623 / ADR-0019.
 *
 * Drives the REAL SDK init path (NOT a value-injecting unit test — evidence requirement):
 *   GET /mock-decision/api/quiz/public-config  (serve.js emits a `brand` slice)
 *     → fetchQuizConfig() parses PresentationConfigResponse
 *       → mergeQuizConfig() overlays SdkConfig.brand
 *         → renderProfilingToggle() paints the opt-out toggle with brand.primary_color
 *         → renderQuizWidget()     renders the brand logo atop the auto-opened quiz card
 *
 * FOLLOW-1015: this spec used to fast-forward a faked clock past the 30s
 * `QUIZ_TRIGGER_DELAY_MS` and then click `button.estalara-trigger`. Both are gone — the sticky
 * trigger was deleted and the quiz card opens by itself once consent and config resolve, so
 * there is no timer to skip and no button to click. `brand.primary_color` lost the trigger as
 * a consumer at the same time; the opt-out toggle's accent (FOLLOW-641 / ADR-0019 D4) is now
 * the field's only SDK consumer, so that is what proves the fetched value reached a renderer.
 *
 * @module packages/sdk/e2e/brand
 */

import { test, expect, type Page } from '@playwright/test';

const PUBLIC_CONFIG_URL = 'http://localhost:4444/mock-decision/api/quiz/public-config';
const BRAND_PRIMARY_RGB = 'rgb(26, 115, 232)'; // brand.primary_color #1a73e8
const SDK_ACCENT_RGB = 'rgb(37, 99, 235)'; // quiz_config.accent_color #2563EB (the fallback)
const BRAND_LOGO_URL = 'http://localhost:4444/e2e/fixtures/brand-logo.svg';

/**
 * Load the brand fixture with consent pre-granted, then let the real async init settle so the
 * config fetch, the merge, and the auto-opened quiz card have all landed.
 */
async function gotoBrand(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('estalara_consent', 'granted');
  });
  // Register the response waiter BEFORE navigating so the real config fetch (which fires
  // during async init) cannot resolve before the listener is attached (avoids a race).
  const configResponse = page.waitForResponse(PUBLIC_CONFIG_URL);
  await page.goto('http://localhost:4444/brand.html');
  await configResponse;
  // Let the remaining awaited init steps settle (merge + directives + the auto-open render).
  await page.waitForTimeout(500);
}

test.describe('SDK brand slice (FOLLOW-623 / ADR-0019)', () => {
  test('SDK initializes without errors on the brand fixture', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await gotoBrand(page);
    expect(errors).toHaveLength(0);
  });

  test('opt-out toggle accent uses brand.primary_color from the fetched config', async ({
    page,
  }) => {
    await gotoBrand(page);

    // Compare the toggle's computed accent INSIDE the page (returning a boolean keeps the
    // evaluate return DOM-type-free, matching the existing consent.spec pattern). The brand
    // color (#1a73e8 → rgb(26,115,232)) proves the fetched brand slice reached the real
    // render path.
    const accentIsBrand = await page.evaluate((expected: string): boolean => {
      const host = document.querySelector('[data-estalara-host]');
      const box = host?.shadowRoot?.querySelector('input[data-estalara-toggle-checkbox]');
      return !!box && window.getComputedStyle(box).getPropertyValue('accent-color') === expected;
    }, BRAND_PRIMARY_RGB);
    expect(accentIsBrand).toBe(true);

    // And assert it is NOT the `accent_color` fallback the toggle would use had the brand
    // slice failed to reach it (`config.brand?.primaryColor ?? config.accentColor`).
    const accentIsFallback = await page.evaluate((fallback: string): boolean => {
      const host = document.querySelector('[data-estalara-host]');
      const box = host?.shadowRoot?.querySelector('input[data-estalara-toggle-checkbox]');
      return !!box && window.getComputedStyle(box).getPropertyValue('accent-color') === fallback;
    }, SDK_ACCENT_RGB);
    expect(accentIsFallback).toBe(false);
  });

  test('auto-opened quiz card renders the brand logo atop it', async ({ page }) => {
    await gotoBrand(page);

    // FOLLOW-1015: no trigger click — the card is already on screen by the time init settles.
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
