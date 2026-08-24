/**
 * Session-identifier E2E — FOLLOW-1106 / ESC-070 Path C.
 *
 * These assertions exist because a unit test CANNOT make the decisive one.
 * The defect being closed was that `generateSessionId()` returned an unkeyed
 * `SHA-256(userAgent | screen.WxH | timeZone | language)` — a device
 * fingerprint. Its signature is that two INDEPENDENT visitors on identical
 * devices receive the SAME identifier. Playwright browser contexts are exactly
 * that: same browser build, same user-agent, same viewport, same locale, same
 * timezone, but separate storage. So `mints a different id in a second browser
 * context with identical device signals` is a direct, executed falsification of
 * the old mechanism against the REAL init path — the loader parses the real
 * data-* attributes, `init()` runs, and the id that reaches the wire is read
 * back out of the actual POST body rather than injected by the test.
 *
 * Evidence: docs/compliance/FOLLOW-1105-session-identifier-assessment.md
 * Ruling:   backlog/ESCALATIONS.md ESC-070 (Path C, CEO, 2026-08-24)
 */
import type { Browser, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:4444/';

/** RFC 4122 v4 layout, as minted by `crypto.randomUUID()`. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The 64-char lowercase hex shape the pre-FOLLOW-1106 build produced. */
const LEGACY_FINGERPRINT = /^[0-9a-f]{64}$/;

interface StoredSession {
  sessionId: string;
  startedAt: number;
  pageCount: number;
}

/** Read the session the REAL init path persisted, not one the test wrote. */
async function readPersistedSession(page: Page): Promise<StoredSession> {
  const raw = await page.evaluate(() => sessionStorage.getItem('__estalara_session__'));
  expect(raw, 'init() must have persisted a session to sessionStorage').not.toBeNull();
  return JSON.parse(raw!) as StoredSession;
}

/** The session_id actually carried by a dispatched ingest POST body. */
async function readDispatchedSessionId(page: Page): Promise<string> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __capturedRequests: unknown[] }).__capturedRequests.length,
        ),
      { message: 'the SDK must flush at least one ingest batch', timeout: 10_000 },
    )
    .toBeGreaterThan(0);

  return page.evaluate(() => {
    const captured = (
      window as unknown as {
        __capturedRequests: { body: { events?: { session_id?: string }[] } }[];
      }
    ).__capturedRequests;
    return captured[0]?.body.events?.[0]?.session_id ?? '';
  });
}

/** Boot a page with consent already granted so init() reaches the session step. */
async function bootGranted(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('estalara_consent', 'granted');
  });
  await page.goto(BASE_URL);
  await page.waitForFunction(
    () => typeof (window as unknown as Record<string, unknown>).Estalara !== 'undefined',
  );
}

test.describe('session identifier — FOLLOW-1106', () => {
  test('the real init path mints a random UUID, and that value is what reaches ingest', async ({
    page,
  }) => {
    await bootGranted(page);

    const session = await readPersistedSession(page);
    expect(session.sessionId).toMatch(UUID_V4);
    expect(session.sessionId).not.toMatch(LEGACY_FINGERPRINT);

    // The persisted value and the wire value must be the same string: this is
    // the seven-hop chain the assessment traced (session.ts → index.ts →
    // events.ts → ingest), asserted end to end rather than at hop 1.
    expect(await readDispatchedSessionId(page)).toBe(session.sessionId);
  });

  test('survives a full reload — sessionStorage-first read, not a fresh mint', async ({ page }) => {
    await bootGranted(page);
    const before = await readPersistedSession(page);

    await page.reload();
    await page.waitForFunction(
      () => typeof (window as unknown as Record<string, unknown>).Estalara !== 'undefined',
    );

    const after = await readPersistedSession(page);
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.startedAt).toBe(before.startedAt);
  });

  // ── The assertion the old implementation could not survive ────────────────
  test('mints a different id in a second browser context with identical device signals', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await bootGranted(pageA);
      await bootGranted(pageB);

      const a = await readPersistedSession(pageA);
      const b = await readPersistedSession(pageB);

      // Same user-agent, viewport, locale and timezone in both contexts — so
      // under the pre-FOLLOW-1106 digest these two strings were IDENTICAL, and
      // two unrelated visitors shared one identifier, one analytics row and one
      // Art. 17 erasure. They must now differ.
      const signalsA = await pageA.evaluate(() => ({
        ua: navigator.userAgent,
        screen: `${String(screen.width)}x${String(screen.height)}`,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        lang: navigator.language,
      }));
      const signalsB = await pageB.evaluate(() => ({
        ua: navigator.userAgent,
        screen: `${String(screen.width)}x${String(screen.height)}`,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        lang: navigator.language,
      }));
      expect(
        signalsB,
        'the two contexts must be fingerprint-identical for this to prove anything',
      ).toEqual(signalsA);

      expect(b.sessionId).not.toBe(a.sessionId);
      expect(a.sessionId).toMatch(UUID_V4);
      expect(b.sessionId).toMatch(UUID_V4);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
