/**
 * N2 backoffice smoke (FOLLOW-1343, plan instrument N2 v0 for checkpoint K1). LOCAL ONLY.
 *
 * Drives the REAL control plane on localhost (`scripts/dev/localhost-up.sh`, :3000). Nothing here
 * stubs a route or injects a session: every status asserted is what the running middleware and
 * route handlers answer.
 *
 * WHAT IT PROVES (v0)
 *   - `/sign-in` renders the email + password form.
 *   - `/admin` answers 307 (not the browser-cached 308 FOLLOW-1322 removed) to
 *     `/sign-in?redirect=%2Fadmin`, and EVERY page in the `app/admin/**\/page.tsx` inventory is
 *     gated the same way — no admin page answers 2xx or 5xx to an anonymous caller.
 *   - Unknown routes: `/admin/<unknown>` is gated before routing (307); a public unknown route is a
 *     404 status.
 *   - FOLLOW-1321 rank matrix on the live API, for every credential localhost can honestly mint:
 *     anonymous 401; `ADMIN_API_SECRET` bearer GET 200 with `x-estalara-staff-can-write: false`,
 *     POST intent config 403, PUT generation-model 403; a staff JWT signed with a key the server
 *     does not hold 401. The readonly/ops JWT rows run only when SUPABASE_JWT_SECRET is set for
 *     BOTH this process and the control plane (see the AUTH GAP below).
 *   - Any HTTP >= 500 or Next error-overlay text on a browser-visited page fails the test.
 *
 * AUTH GAP (for FOLLOW-1336 / checkpoint K3) — measured 2026-10-18 at 4506baaa:
 *   - PAGES: `middleware.ts` gates `/admin/*` with `checkAdminSession` ONLY — `@supabase/ssr`
 *     `supabase.auth.getUser()` against NEXT_PUBLIC_SUPABASE_URL, i.e. the PRODUCTION Supabase
 *     project, whose only account is the CEO's. There is no JWT/bearer branch for pages, so no
 *     locally-minted credential can open an admin page. "Lands on the Estalara tenant", "sidebar
 *     pinned", "Live Monitor carries tenant_id" and "every sidebar page < 500" therefore cannot be
 *     asserted in a browser without real credentials; they are covered from source by
 *     `apps/control-plane/src/app/admin/__tests__/admin-nav-reachability.test.ts` and by the
 *     C2 unit tests, and are the skipped `K3 gap` test below.
 *   - API: `lib/tracer-auth.ts` path 3 (`via: 'staff_jwt'`) verifies HS256 with
 *     SUPABASE_JWT_SECRET (`packages/auth/src/middleware.ts` `verifyAndDecodeJwtPayload`). That
 *     name exists in neither Doppler `dev` nor `scripts/dev/localhost-up.sh`, so on localhost the
 *     path is fail-secure and refuses every bearer JWT. A localhost-only random value exported by
 *     localhost-up.sh to both the server and this spec would enable the readonly/ops rows.
 *
 * Run: see tests/e2e/backoffice/README.md.
 *
 * @module tests/e2e/backoffice/admin-smoke.spec
 */

import { createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Types only (erased at runtime); the value is required from packages/sdk below.
import type * as Pw from '../../../packages/sdk/node_modules/@playwright/test';
import type { Page } from '../../../packages/sdk/node_modules/@playwright/test';

// `@playwright/test` lives in packages/sdk (it owns the browser matrix); resolving it from there
// gives the SAME module instance the CLI (`packages/sdk/node_modules/@playwright/test/cli.js`) runs.
const requireFromSdk = createRequire(
  new URL('../../../packages/sdk/package.json', import.meta.url),
);
const { test, expect } = requireFromSdk('@playwright/test') as typeof Pw;

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN_DIR = join(HERE, '../../../apps/control-plane/src/app/admin');

// The seeded tenant localhost-up.sh exports as OPS_TENANT_ID / NEXT_PUBLIC_ESTALARA_TENANT_ID.
const TENANT_ID =
  process.env.NEXT_PUBLIC_ESTALARA_TENANT_ID ??
  process.env.OPS_TENANT_ID ??
  '00000000-0000-0000-0000-0000000000e2';
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

/** Next dev overlay / default error page markers. `error.tsx` lands with FOLLOW-1336 (M3). */
const ERROR_MARKERS = [
  'Unhandled Runtime Error',
  'Application error: a server-side exception has occurred',
  'Internal Server Error',
  'Build Error',
];

/** Every `app/admin/**\/page.tsx`, dynamic segments filled with the seeded tenant id. */
function adminPagePaths(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const full = join(dir, n);
      if (statSync(full).isDirectory()) return n === '__tests__' ? [] : walk(full);
      return n === 'page.tsx' ? [full] : [];
    });
  return walk(ADMIN_DIR)
    .map((f) =>
      relative(ADMIN_DIR, dirname(f))
        .split(sep)
        .filter((s) => s && !/^\(.*\)$/.test(s))
        .map((s) => (/^\[.+\]$/.test(s) ? TENANT_ID : s)),
    )
    .map((segs) => ['/admin', ...segs].join('/'))
    .sort();
}

/** HS256 JWT in the shape `packages/auth` `extractClaims` accepts for a staff user. */
function mintStaffJwt(key: string, role: 'estalara:readonly' | 'estalara:ops'): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({
    sub: '00000000-0000-0000-0000-000000000002',
    email: 'n2-smoke@localhost.invalid',
    estalara_staff: true,
    estalara_role: role,
    tenant_id: null,
    mfa_verified: false,
    iat: now,
    exp: now + 300,
  });
  const sig = createHmac('sha256', key).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** Fail on any >= 500 the page loads and on error-overlay text in the rendered body. */
async function assertNoServerError(page: Page, serverErrors: string[]): Promise<void> {
  expect(serverErrors, 'HTTP >= 500 during navigation').toEqual([]);
  const text = await page.locator('body').innerText();
  for (const marker of ERROR_MARKERS) expect(text, `error text: ${marker}`).not.toContain(marker);
}

test.describe('N2 backoffice smoke — anonymous', () => {
  let serverErrors: string[] = [];
  test.beforeEach(({ page }) => {
    serverErrors = [];
    page.on('response', (r) => {
      if (r.status() >= 500) serverErrors.push(`${String(r.status())} ${String(r.url())}`);
    });
  });

  test('/sign-in renders the email + password form', async ({ page }) => {
    const res = await page.goto('/sign-in');
    expect(res?.status()).toBe(200);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await assertNoServerError(page, serverErrors);
  });

  test('/admin answers 307 (not 308) to /sign-in?redirect=%2Fadmin', async ({ page, request }) => {
    const res = await request.get('/admin', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(new URL(res.headers().location ?? '', 'http://x').pathname).toBe('/sign-in');
    expect(res.headers().location).toContain('redirect=%2Fadmin');
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fadmin$/);
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await assertNoServerError(page, serverErrors);
  });

  test('every admin page in the inventory is gated: 307 to sign-in, never 2xx/5xx', async ({
    request,
  }) => {
    const paths = adminPagePaths();
    expect(paths.length).toBeGreaterThanOrEqual(20);
    const wrong: string[] = [];
    for (const p of paths) {
      const res = await request.get(p, { maxRedirects: 0 });
      const loc = res.headers().location ?? '';
      const want = `/sign-in?redirect=${encodeURIComponent(p)}`;
      if (res.status() !== 307 || !loc.endsWith(want))
        wrong.push(`${p} -> ${String(res.status())} ${String(loc)}`);
    }
    expect(wrong).toEqual([]);
  });

  test('unknown routes: /admin/* gated before routing; public unknown is 404', async ({
    page,
    request,
  }) => {
    const gated = await request.get('/admin/does-not-exist', { maxRedirects: 0 });
    expect(gated.status()).toBe(307);
    const res = await page.goto('/n2-smoke-does-not-exist');
    expect(res?.status()).toBe(404);
    // TODO(FOLLOW-1336, checkpoint K3): after M3 ships `app/not-found.tsx`, assert the branded page:
    // await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
    await assertNoServerError(page, serverErrors);
  });
});

test.describe('N2 backoffice smoke — FOLLOW-1321 rank matrix on the live API', () => {
  const CONFIG = '/api/admin/intent/config';
  const GEN_MODEL = '/api/admin/generation-model';
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  test('anonymous GET intent config -> 401', async ({ request }) => {
    expect((await request.get(CONFIG)).status()).toBe(401);
  });

  test('a staff JWT signed with a key the server does not hold -> 401', async ({ request }) => {
    const jwt = mintStaffJwt(randomBytes(32).toString('hex'), 'estalara:ops');
    expect((await request.get(CONFIG, { headers: bearer(jwt) })).status()).toBe(401);
  });

  test.describe('ADMIN_API_SECRET bearer (headless, read-only)', () => {
    test.skip(!ADMIN_API_SECRET, 'ADMIN_API_SECRET not set in this process (README: Run)');
    const h = () => bearer(ADMIN_API_SECRET ?? '');

    test('GET intent config -> 200, x-estalara-staff-can-write: false', async ({ request }) => {
      const res = await request.get(CONFIG, { headers: h() });
      expect(res.status()).toBe(200);
      expect(res.headers()['x-estalara-staff-can-write']).toBe('false');
    });
    test('POST intent config -> 403', async ({ request }) => {
      expect((await request.post(CONFIG, { headers: h(), data: {} })).status()).toBe(403);
    });
    test('PUT generation-model -> 403', async ({ request }) => {
      expect((await request.put(GEN_MODEL, { headers: h(), data: {} })).status()).toBe(403);
    });
  });

  test.describe('staff JWT rows (readonly / ops)', () => {
    test.skip(
      !SUPABASE_JWT_SECRET,
      'SUPABASE_JWT_SECRET is in neither Doppler dev nor localhost-up.sh: the staff_jwt path refuses every JWT on localhost (FOLLOW-1336/K3 gap)',
    );
    const jwt = (role: 'estalara:readonly' | 'estalara:ops') =>
      bearer(mintStaffJwt(SUPABASE_JWT_SECRET ?? '', role));

    test('readonly GET -> 200, can-write false', async ({ request }) => {
      const res = await request.get(CONFIG, { headers: jwt('estalara:readonly') });
      expect(res.status()).toBe(200);
      expect(res.headers()['x-estalara-staff-can-write']).toBe('false');
    });
    test('ops GET -> 200, can-write true', async ({ request }) => {
      const res = await request.get(CONFIG, { headers: jwt('estalara:ops') });
      expect(res.status()).toBe(200);
      expect(res.headers()['x-estalara-staff-can-write']).toBe('true');
    });
    test('readonly POST intent config -> 403', async ({ request }) => {
      const res = await request.post(CONFIG, { headers: jwt('estalara:readonly'), data: {} });
      expect(res.status()).toBe(403);
    });
    test('ops PUT generation-model -> 403 (superadmin only)', async ({ request }) => {
      const res = await request.put(GEN_MODEL, { headers: jwt('estalara:ops'), data: {} });
      expect(res.status()).toBe(403);
    });
  });
});

test('K3 gap: staff page session (landing tenant, pinned sidebar, Live Monitor tenant_id)', () => {
  test.skip(
    true,
    'No local staff page session: middleware.ts checkAdminSession only accepts a Supabase SSR session validated by getUser() against the production project (FOLLOW-1336/K3)',
  );
});
