/**
 * FOLLOW-1316 — the built IIFE in a real browser (Rule BD), every network answer stubbed: the send,
 * the withdrawal control and NC-3, NC-7, NC-9 as far as they can run with no control plane. The key
 * in the store and the REAL `/api/adapt` belong to AC(9) on localhost, not to this file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';
import { test, expect } from '@playwright/test';

const PAGE_URL = 'http://localhost:4444/returning-buyer-page';
const CONTROL_PLANE = 'http://localhost:4444/mock-cp/api';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const CONSENT_TEXT_DOC = readFileSync(
  fileURLToPath(new URL('../../../apps/control-plane/public/consent-text.json', import.meta.url)),
  'utf8',
);
const SERVED_TEXT_VERSION = (JSON.parse(CONSENT_TEXT_DOC) as { text_version: string }).text_version;

const PAGE_HTML = `<!doctype html><html><body>
<div data-estalara-listing-id="listing-1">
  <h1 data-estalara-slot="headline">Seller headline</h1>
  <p data-estalara-slot="description">Seller description.</p>
</div>
<script src="/dist/estalara-sdk.iife.js" data-api-key="e2e-follow1316-key"
  data-decision-url="${CONTROL_PLANE}" data-tenant-id="${TENANT_ID}"
  data-ingest-url="http://localhost:4444/mock-ingest"></script>
</body></html>`;

interface Stub {
  flag?: boolean;
  language?: 'en' | 'pl' | 'es';
  /** Block the erase at the network (NC-9). */
  blockErase?: boolean;
}

interface Sent {
  url: string;
  body: string;
}

/** Every request the page makes, so "the xid went nowhere else" is read off the wire. */
function capture(page: Page): Sent[] {
  const sent: Sent[] = [];
  page.on('request', (req) => {
    sent.push({ url: req.url(), body: req.postData() ?? '' });
  });
  return sent;
}

async function stub(page: Page, options: Stub): Promise<void> {
  const json = (route: Route, body: unknown): Promise<void> =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === PAGE_URL) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: PAGE_HTML });
    } else if (url.endsWith('/consent-text.json')) {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: CONSENT_TEXT_DOC,
      });
    } else if (url.endsWith('/quiz/public-config')) {
      await json(route, {
        quiz_enabled: false,
        language: options.language ?? 'en',
        accent_color: '#2563EB',
        data_source: 'db',
        ...(options.flag === undefined ? {} : { buyer_profile_enabled: options.flag }),
      });
    } else if (url.endsWith('/profile/erase')) {
      if (options.blockErase) await route.abort('failed');
      else await json(route, { result: 'deleted', data_source: 'redis' });
    } else if (url.includes('/adapt/description')) {
      await route.fulfill({ status: 404, body: '{}' });
    } else if (url.endsWith('/adapt')) {
      await json(route, {
        adapt_decision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        session_id: 'e'.repeat(36),
        archetype: 'yield_hunter',
        confidence: 0.85,
        similarity: 0.5,
        source: 'playbook',
        generated_at: '2026-11-02T00:00:00.000Z',
        profile_restore: 'restored',
        directives: [
          {
            type: 'text',
            slot: 'headline',
            value: 'Adapted headline',
            archetype: 'yield_hunter',
            confidence: 0.85,
          },
        ],
      });
    } else if (url.includes('/mock-cp/') || url.includes('/mock-ingest')) {
      await json(route, {});
    } else {
      await route.continue();
    }
  });
}

const storage = (page: Page, key: string): Promise<string | null> =>
  page.evaluate((k) => localStorage.getItem(k), key);

/** Seed what a real Accept leaves behind, before the SDK's first read. */
async function seedConsented(page: Page, version: string = SERVED_TEXT_VERSION): Promise<void> {
  await page.addInitScript((v) => {
    if (sessionStorage.getItem('__e2e_seeded__')) return;
    sessionStorage.setItem('__e2e_seeded__', '1');
    localStorage.setItem('estalara_consent', 'granted');
    localStorage.setItem('estalara_consent_text_version', v);
  }, version);
}

const shadow = (page: Page, selector: string) => page.locator(`[data-estalara-host] ${selector}`);
const withdraw = (page: Page) => shadow(page, '[data-estalara-withdraw]');

const adaptBodies = (sent: Sent[]): Record<string, unknown>[] =>
  sent
    .filter((s) => /\/adapt(\?|$)/.test(s.url))
    .map((s) => JSON.parse(s.body) as Record<string, unknown>);

const storedXid = async (page: Page): Promise<string | undefined> =>
  (JSON.parse((await storage(page, '__estalara_xid__')) ?? '{}') as { id?: string }).id;

function expectXidOnlyInAllowedBodies(sent: Sent[], xid: string): void {
  for (const { url, body } of sent) {
    expect(url).not.toContain(xid);
    if (!url.endsWith('/adapt') && !url.endsWith('/profile/erase')) {
      expect(body, url).not.toContain(xid);
    }
  }
}

test.describe('FOLLOW-1316 in a real browser', () => {
  test('Accept on the banner, then the xid travels in the POST body only', async ({ page }) => {
    await stub(page, { flag: true });
    const sent = capture(page);
    await page.goto(PAGE_URL);
    // NC-7, pending: nothing has gone out yet, and no id exists.
    await expect(shadow(page, '[data-estalara-consent="accept"]')).toBeVisible();
    expect(await storage(page, '__estalara_xid__')).toBeNull();
    expect(adaptBodies(sent)).toEqual([]);

    await shadow(page, '[data-estalara-consent="accept"]').click();
    await expect(withdraw(page)).toBeVisible();
    await expect.poll(() => adaptBodies(sent).length).toBeGreaterThan(0);

    const xid = await storedXid(page);
    expect(xid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await storage(page, 'estalara_consent_text_version')).toBe(SERVED_TEXT_VERSION);
    expect(adaptBodies(sent)[0]?.xid).toBe(xid);
    expect(adaptBodies(sent)[0]?.consent_state).toBe('consented');
    // The restore lands in the DOM.
    await expect(page.locator('[data-estalara-slot="headline"]')).toHaveText('Adapted headline');

    await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    await page.reload();
    await expect.poll(() => adaptBodies(sent).length).toBeGreaterThan(1);
    expect(adaptBodies(sent).at(-1)?.xid).toBe(xid);
    expectXidOnlyInAllowedBodies(sent, String(xid));
  });

  test('NC-3: one click: denied, delete, id gone, tenant copy back, widget gone, next page silent', async ({
    page,
  }) => {
    await seedConsented(page);
    await stub(page, { flag: true });
    const sent = capture(page);
    await page.goto(PAGE_URL);
    await expect(page.locator('[data-estalara-slot="headline"]')).toHaveText('Adapted headline');
    const xid = await storedXid(page);

    await withdraw(page).click();
    await expect.poll(() => storage(page, 'estalara_consent')).toBe('denied');
    await expect.poll(() => storage(page, '__estalara_xid__')).toBeNull();
    const erase = sent.find((s) => s.url.endsWith('/profile/erase'));
    expect(JSON.parse(erase?.body ?? '{}')).toEqual({ tenant_id: TENANT_ID, xid });
    await expect(page.locator('[data-estalara-slot="headline"]')).toHaveText('Seller headline');
    await expect(page.locator('[data-estalara-host]')).toHaveCount(0);
    expect(await storage(page, 'estalara_consent_text_version')).toBeNull();

    sent.length = 0;
    await page.reload();
    await page.waitForTimeout(500);
    expect(sent.filter((s) => s.url.includes('/mock-'))).toEqual([]);
  });

  test('NC-9: delete blocked at the network: id kept; the next load deletes, then erases', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const blocked = await context.newPage();
    await seedConsented(blocked);
    await stub(blocked, { flag: true, blockErase: true });
    await blocked.goto(PAGE_URL);
    await expect(withdraw(blocked)).toBeVisible();
    const xid = await storedXid(blocked);

    const attempt = blocked.waitForEvent('requestfailed', (r) =>
      r.url().endsWith('/profile/erase'),
    );
    await withdraw(blocked).click();
    await attempt;
    expect(await storage(blocked, 'estalara_consent')).toBe('denied');
    expect(await storedXid(blocked)).toBe(xid);
    await blocked.close();

    const next = await context.newPage();
    await stub(next, { flag: true });
    const sent = capture(next);
    await next.goto(PAGE_URL);
    await expect.poll(() => storage(next, '__estalara_xid__')).toBeNull();
    const toServer = sent.filter((s) => s.url.includes('/mock-'));
    expect(toServer.map((s) => new URL(s.url).pathname)).toEqual(['/mock-cp/api/profile/erase']);
    expect(JSON.parse(toServer[0]?.body ?? '{}')).toEqual({ tenant_id: TENANT_ID, xid });
    await context.close();
  });

  test('NC-7: GPC on: the session runs and no id leaves', async ({ page }) => {
    await seedConsented(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
    });
    await stub(page, { flag: true });
    const sent = capture(page);
    await page.goto(PAGE_URL);
    await expect.poll(() => adaptBodies(sent).length).toBeGreaterThan(0);
    const xid = await storedXid(page);
    expect(xid).toBeDefined();
    for (const { url, body } of sent) expect(`${url} ${body}`).not.toContain(xid);
  });

  test('NC-7: a grant of an older text: re-asked, and no id leaves until Accept', async ({
    page,
  }) => {
    await seedConsented(page, '2026-01-01.1');
    await stub(page, { flag: true });
    const sent = capture(page);
    await page.goto(PAGE_URL);
    await expect(shadow(page, '[data-estalara-consent="accept"]')).toBeVisible();
    expect(adaptBodies(sent)).toEqual([]);

    await shadow(page, '[data-estalara-consent="accept"]').click();
    await expect.poll(() => adaptBodies(sent).length).toBeGreaterThan(0);
    expect(adaptBodies(sent)[0]?.xid).toBe(await storedXid(page));
  });

  test('flag off: the id stays home, no control, and a denial erases it with no request', async ({
    page,
  }) => {
    await seedConsented(page);
    await stub(page, { flag: false });
    const sent = capture(page);
    await page.goto(PAGE_URL);
    await expect.poll(() => adaptBodies(sent).length).toBeGreaterThan(0);
    await expect(shadow(page, '[data-estalara-toggle-checkbox]')).toBeVisible();
    await expect(withdraw(page)).toHaveCount(0);
    const xid = await storedXid(page);
    expect(xid).toBeDefined();
    for (const { url, body } of sent) expect(`${url} ${body}`).not.toContain(xid);

    await page.evaluate(() => {
      localStorage.setItem('estalara_consent', 'denied');
    });
    sent.length = 0;
    await page.reload();
    await expect.poll(() => storage(page, '__estalara_xid__')).toBeNull();
    // The outgoing page may still flush its events; no request of any kind carries the id.
    expect(sent.filter((s) => s.url.includes('/mock-cp/'))).toEqual([]);
    for (const { url, body } of sent) expect(`${url} ${body}`).not.toContain(xid);
  });

  for (const [language, label] of [
    ['en', 'Withdraw consent'],
    ['pl', 'Wycofaj zgodę'],
    ['es', 'Retirar el consentimiento'],
  ] as const) {
    test(`R24: the control reads "${label}" in ${language}, next to the toggle`, async ({
      page,
    }, testInfo) => {
      await seedConsented(page);
      await stub(page, { flag: true, language });
      await page.goto(PAGE_URL);
      await expect(withdraw(page)).toHaveText(label);
      await expect(withdraw(page)).toBeVisible();
      await withdraw(page).focus();
      await expect(withdraw(page)).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`withdraw-${language}.png`),
        clip: { x: 0, y: 560, width: 420, height: 160 },
      });
    });
  }
});
