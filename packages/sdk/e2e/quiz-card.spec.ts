/**
 * The auto-opening quiz card in a real browser, through the REAL init path (built IIFE, real
 * `GET …/quiz/public-config`, real `POST …/adapt`; responses shaped with `page.route`).
 *
 * FOLLOW-1370: the card opens only on the SERVED definition and waits for nothing else — a slow
 * `/api/adapt` does not hold it back, and an unserved config means no card at all (the SDK has
 * no built-in tree).
 *
 * @module packages/sdk/e2e/quiz-card
 */

import { test, expect, type Page, type Route } from '@playwright/test';
import { DEFAULT_QUIZ_DEFINITION_V2 } from '@estalara/shared';

const CONFIG_GLOB = '**/mock-decision/api/quiz/public-config';
const ADAPT_GLOB = '**/mock-decision/api/adapt';

/** A `db` public-config answer carrying the served EN + PL tree. */
function served(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    quiz_enabled: true,
    language: 'en',
    accent_color: '#2563EB',
    data_source: 'db',
    quiz_definition: DEFAULT_QUIZ_DEFINITION_V2,
    definition_hash: 'e'.repeat(64),
    definition_version: null,
    ...extra,
  };
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });
}

/** Consent granted, then the brand fixture (its snippet points at the mock decision API). */
async function open(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('estalara_consent', 'granted');
  });
  await page.goto('http://localhost:4444/brand.html');
}

const card = (page: Page) => page.locator('.estalara-quiz-card');

test.describe('quiz card — served definition only (FOLLOW-1370)', () => {
  test('config in 1.5 s, /api/adapt held for 20 s → the card opens before the first decision', async ({
    page,
  }) => {
    let adaptAnswered = false;
    await page.route(CONFIG_GLOB, async (route) => {
      await new Promise((r) => setTimeout(r, 1_500));
      await fulfillJson(route, served());
    });
    await page.route(ADAPT_GLOB, async (route) => {
      await new Promise((r) => setTimeout(r, 20_000));
      adaptAnswered = true;
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await open(page);
    await expect(card(page)).toBeVisible({ timeout: 8_000 });
    expect(adaptAnswered).toBe(false);
    // The served tree: the EN | PL switcher is on the card.
    await expect(page.locator('.estalara-quiz-lang button')).toHaveCount(2);
  });

  test('public-config fails → no card on this pageview (no built-in tree)', async ({ page }) => {
    let configRequested = false;
    await page.route(CONFIG_GLOB, async (route) => {
      configRequested = true;
      await route.abort('failed');
    });
    await open(page);
    await page.waitForTimeout(3_000);
    expect(configRequested).toBe(true);
    await expect(card(page)).toHaveCount(0);
  });

  test('a fallback answer without a quiz_definition → no card', async ({ page }) => {
    await page.route(CONFIG_GLOB, (route) =>
      fulfillJson(route, { quiz_enabled: true, language: 'en', data_source: 'fallback' }),
    );
    await open(page);
    await page.waitForTimeout(3_000);
    await expect(card(page)).toHaveCount(0);
  });
});
