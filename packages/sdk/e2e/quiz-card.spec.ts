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

/** Box of the first element matching `sel` (Playwright pierces the open shadow root). */
async function box(page: Page, sel: string): Promise<{ top: number; bottom: number } | null> {
  const b = await page.locator(sel).first().boundingBox();
  return b ? { top: b.y, bottom: b.y + b.height } : null;
}

/**
 * Whether `sel` sits inside the card's visible box and on screen, and receives a pointer event
 * there (Playwright's actionability "receives events" check; the box test comes first so the
 * trial click's scroll-into-view cannot hide a header that scrolled away).
 */
async function hittable(page: Page, sel: string): Promise<boolean> {
  const c = await box(page, '.estalara-quiz-card');
  const b = await box(page, sel);
  const vh = page.viewportSize()?.height ?? 0;
  if (!c || !b || b.top < Math.max(0, c.top) - 1 || b.bottom > Math.min(vh, c.bottom) + 1) {
    return false;
  }
  return page
    .locator(sel)
    .first()
    .click({ trial: true, timeout: 2_000 })
    .then(
      () => true,
      () => false,
    );
}

test.describe('quiz card — fits short viewports (FOLLOW-1371)', () => {
  for (const [w, h, language] of [
    [375, 667, 'en'],
    [375, 667, 'pl'],
    [1280, 720, 'pl'],
    [667, 375, 'pl'],
  ] as const) {
    test(`${String(w)}x${String(h)} ${language}: the card, × and EN | PL stay on screen`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.route(CONFIG_GLOB, (route) => fulfillJson(route, served({ language })));
      await open(page);
      await expect(card(page)).toBeVisible({ timeout: 8_000 });
      const c = await box(page, '.estalara-quiz-card');
      expect(c?.top).toBeGreaterThanOrEqual(0);
      expect(c?.bottom).toBeLessThanOrEqual(h);
      expect(await hittable(page, '.estalara-quiz-close')).toBe(true);
      expect(await hittable(page, '.estalara-quiz-lang button')).toBe(true);
      // Scrolled to its end, the header (× and EN | PL) is still there to press.
      await page.evaluate(() => {
        const el = document
          .querySelector('[data-estalara-host]')
          ?.shadowRoot?.querySelector('.estalara-quiz-card');
        el?.scrollTo(0, el.scrollHeight);
      });
      expect(await hittable(page, '.estalara-quiz-close')).toBe(true);
      expect(await hittable(page, '.estalara-quiz-lang button')).toBe(true);
    });
  }
});
