import { test, expect } from '@playwright/test';

test.describe('Estalara SDK', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('estalara_consent', 'granted');
    });
    await page.goto('http://localhost:4444/');
    // Wait for SDK to initialize
    await page.waitForTimeout(500);
  });

  test('SDK initializes without throwing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.addInitScript(() => {
      localStorage.setItem('estalara_consent', 'granted');
    });
    await page.goto('http://localhost:4444/');
    await page.waitForTimeout(500);
    expect(errors).toHaveLength(0);
  });

  test('Estalara global is defined', async ({ page }) => {
    const hasEstalara = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).Estalara !== 'undefined';
    });
    expect(hasEstalara).toBe(true);
  });

  test('identify() function is exposed', async ({ page }) => {
    const hasIdentify = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const E = w.Estalara as Record<string, unknown> | undefined;
      return typeof E?.identify === 'function';
    });
    expect(hasIdentify).toBe(true);
  });

  test('Shadow DOM host is attached to body', async ({ page }) => {
    const hasShadowHost = await page.evaluate(() => {
      const host = document.querySelector('[data-estalara-host]');
      return host !== null && host.shadowRoot !== null;
    });
    expect(hasShadowHost).toBe(true);
  });

  test('events are dispatched to ingest after timeout', async ({ page }) => {
    // Wait for the 5s batch flush
    await page.waitForTimeout(6000);

    const captured = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown[]>).__capturedRequests;
    });

    // At least one batch should have been sent
    expect(captured.length).toBeGreaterThan(0);

    // First batch should contain page.view
    const firstBatch = captured[0] as { body: { events: { type: string }[] } };
    const hasPageView = firstBatch.body.events.some((e) => e.type === 'page.view');
    expect(hasPageView).toBe(true);
  });
});
