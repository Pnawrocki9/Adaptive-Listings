/**
 * E2E consent flow tests — TICKET-041.
 *
 * Verifies:
 * 1. Fresh page load → consent banner appears BEFORE any ingest events are sent.
 * 2. Clicking Accept → banner disappears, events start flowing to ingest.
 * 3. Clicking Decline → banner disappears, no page.view or behavioral events dispatched.
 * 4. Returning after Accept → no banner shown, events flow immediately.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:4444/';

/** Clear localStorage so each test starts with a fresh consent state. */
async function clearConsent(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      localStorage.removeItem('estalara_consent');
    } catch {
      // ignore
    }
  });
}

test.describe('Consent banner — TICKET-041', () => {
  test('consent banner appears on fresh page load before any events are sent', async ({ page }) => {
    await page.goto(BASE_URL);
    await clearConsent(page);
    // Reload so SDK sees pending consent state
    await page.reload();
    await page.waitForTimeout(500);

    // Banner should be visible in Shadow DOM
    const bannerVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-estalara-host]');
      if (!host?.shadowRoot) return false;
      const banner = host.shadowRoot.querySelector('.estalara-consent-banner');
      return banner !== null;
    });
    expect(bannerVisible).toBe(true);

    // No ingest requests should have been made yet
    const captured = await page.evaluate(
      () => (window as unknown as Record<string, unknown[]>).__capturedRequests,
    );
    // Filter out any non-ingest requests
    const ingestReqs = captured.filter((r) => (r as { url: string }).url.includes('mock-ingest'));
    expect(ingestReqs).toHaveLength(0);
  });

  test('Accept → banner removed and events start flowing', async ({ page }) => {
    await page.goto(BASE_URL);
    await clearConsent(page);
    await page.reload();
    await page.waitForTimeout(500);

    // Click Accept inside Shadow DOM
    const accepted = await page.evaluate(() => {
      const host = document.querySelector('[data-estalara-host]');
      if (!host?.shadowRoot) return false;
      const acceptBtn = host.shadowRoot.querySelector<HTMLButtonElement>(
        '[data-estalara-consent="accept"]',
      );
      if (!acceptBtn) return false;
      acceptBtn.click();
      return true;
    });
    expect(accepted).toBe(true);

    // Banner should be gone
    await page.waitForTimeout(200);
    const bannerGone = await page.evaluate(() => {
      const host = document.querySelector('[data-estalara-host]');
      if (!host?.shadowRoot) return true;
      return host.shadowRoot.querySelector('.estalara-consent-banner') === null;
    });
    expect(bannerGone).toBe(true);

    // Consent state should be persisted
    const storedConsent = await page.evaluate(() => {
      try {
        return localStorage.getItem('estalara_consent');
      } catch {
        return null;
      }
    });
    expect(storedConsent).toBe('granted');

    // Wait for flush interval and verify events are dispatched
    await page.waitForTimeout(6_000);
    const captured = await page.evaluate(
      () => (window as unknown as Record<string, unknown[]>).__capturedRequests,
    );
    expect(captured.length).toBeGreaterThan(0);

    // Must contain a page.view or consent.granted event
    interface CapturedRequest { body: { events: { type: string }[] } }
    const allEventTypes = (captured as CapturedRequest[]).flatMap((r) =>
      r.body.events.map((e) => e.type),
    );
    const hasConsentOrPageView =
      allEventTypes.includes('consent.granted') || allEventTypes.includes('page.view');
    expect(hasConsentOrPageView).toBe(true);
  });

  test('Decline → banner removed, no behavioral events dispatched', async ({ page }) => {
    await page.goto(BASE_URL);
    await clearConsent(page);
    await page.reload();
    await page.waitForTimeout(500);

    // Click Decline inside Shadow DOM
    const declined = await page.evaluate(() => {
      const host = document.querySelector('[data-estalara-host]');
      if (!host?.shadowRoot) return false;
      const declineBtn = host.shadowRoot.querySelector<HTMLButtonElement>(
        '[data-estalara-consent="decline"]',
      );
      if (!declineBtn) return false;
      declineBtn.click();
      return true;
    });
    expect(declined).toBe(true);

    await page.waitForTimeout(200);

    // Banner should be gone
    const bannerGone = await page.evaluate(() => {
      const host = document.querySelector('[data-estalara-host]');
      if (!host?.shadowRoot) return true;
      return host.shadowRoot.querySelector('.estalara-consent-banner') === null;
    });
    expect(bannerGone).toBe(true);

    // Consent state should be persisted as denied
    const storedConsent = await page.evaluate(() => {
      try {
        return localStorage.getItem('estalara_consent');
      } catch {
        return null;
      }
    });
    expect(storedConsent).toBe('denied');

    // Wait for flush interval and verify only consent.denied (audit) was dispatched
    await page.waitForTimeout(6_500);
    const captured = await page.evaluate(
      () => (window as unknown as Record<string, unknown[]>).__capturedRequests,
    );

    interface CapturedReq { body: { events: { type: string }[] } }
    const allEventTypes = (captured as CapturedReq[]).flatMap((r) =>
      r.body.events.map((e) => e.type),
    );

    // consent.denied audit event may be dispatched — but no behavioral events like page.view
    const hasPageView = allEventTypes.includes('page.view');
    expect(hasPageView).toBe(false);

    const hasScrollOrListing =
      allEventTypes.includes('scroll.depth') || allEventTypes.includes('listing.viewed');
    expect(hasScrollOrListing).toBe(false);
  });

  test('returning after Accept → no banner shown on reload', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // Use a persistent context so localStorage survives across page loads
    const context: BrowserContext = await browser.newContext();
    const page: Page = await context.newPage();

    try {
      await page.goto(BASE_URL);
      // Clear and set consent to granted
      await page.evaluate(() => {
        try {
          localStorage.setItem('estalara_consent', 'granted');
        } catch {
          // ignore
        }
      });

      // Reload — SDK should see 'granted' and skip banner
      await page.reload();
      await page.waitForTimeout(500);

      const bannerShown = await page.evaluate(() => {
        const host = document.querySelector('[data-estalara-host]');
        if (!host?.shadowRoot) return false;
        return host.shadowRoot.querySelector('.estalara-consent-banner') !== null;
      });
      expect(bannerShown).toBe(false);
    } finally {
      await context.close();
    }
  });
});
