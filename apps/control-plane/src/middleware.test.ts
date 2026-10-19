/**
 * @vitest-environment node
 *
 * The `node` environment override is required because checkAdminSession calls
 * NextResponse.next({ request: req }), which does `req.headers instanceof Headers`.
 * In jsdom, the global `Headers` is shimmed, making the instanceof check fail even
 * for a correctly-constructed NextRequest (Next.js E119). The middleware file has no
 * DOM dependency; the node environment uses the native fetch Headers consistently.
 *
 * Tests for src/middleware.ts — CORS injection for SDK-facing adapt routes,
 * admin gate (checkAdminSession) via @supabase/ssr (FOLLOW-336, RETRO-083 TG-2),
 * and the `/dashboard/*` → `/admin` redirects that replaced the agency dashboard
 * gate (FOLLOW-1335).
 *
 * Covers the dev-only localhost CORS gating added for local E2E testing
 * (Estalara-app SvelteKit on :5173 calling control-plane on :3000).
 *
 * Coverage:
 *   CORS-OPTIONS-1: OPTIONS from localhost:5173 → 204 + Allow-Origin in dev
 *   CORS-OPTIONS-2: OPTIONS from localhost:5173 → 204 + NO Allow-Origin in prod
 *   CORS-OPTIONS-3: OPTIONS from admin.estalara.com → 204 + Allow-Origin in prod
 *   CORS-OPTIONS-4: OPTIONS from evil.example.com → 204 + no Allow-Origin in dev
 *   CORS-GET-1: GET /api/adapt from localhost:5173 → middleware injects Allow-Origin in dev
 *   CORS-GET-2: GET /api/adapt from localhost:5173 → Allow-Origin in prod too [FOLLOW-949: GET
 *               /api/adapt is fully origin-gated and reflects unconditionally; POST does not]
 *   CORS-GET-3: GET /api/adapt/description from localhost:5173 → Allow-Origin in dev
 *   CORS-GET-4: GET /api/adapt/feedback (POST) from localhost:5173 → Allow-Origin in dev
 *   CORS-NON-ADAPT: GET /api/quiz/public-config is NOT matched by adapter prefix
 *                   (that route sets its own `*` CORS — middleware must not interfere)
 *
 *   ADMIN-1: GET /admin/dashboard — staff session (estalara_staff: true, valid role) →
 *            passes through (no redirect), X-Staff-Role header set
 *   ADMIN-2: GET /admin/sessions — no Supabase session (getUser → null) →
 *            redirect to /sign-in with redirect query param
 *   ADMIN-3: GET /admin/sessions — non-staff user (estalara_staff absent) →
 *            redirect to /sign-in
 *   ADMIN-4: GET /sign-in → NOT caught by the admin gate → passes through (no redirect loop)
 *   ADMIN-5: GET /admin/dashboard — Supabase env vars absent → redirect to /sign-in
 *
 *   REDIRECT-*: every `/dashboard/*` URL → 307 to its `/admin` equivalent, without a
 *               session lookup; the target is still staff-gated (FOLLOW-1335)
 *   NO-AGENCY-HEADER: no response or forwarded request header names an agency role
 *
 * Auth calls are mocked so the test does not require a live DB or JWT secret.
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

// ─── Mock @supabase/ssr ────────────────────────────────────────────────────────
// createServerClient is called by the REAL checkAdminSession inside middleware.
// We expose mockGetUser so individual tests can control what getUser() resolves to.
// The mock factory is hoisted (vi.mock calls are hoisted before imports).

const mockGetUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';
import { middleware } from './middleware.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(pathname: string, method = 'GET', origin: string | null = null): NextRequest {
  const url = `http://localhost:3000${pathname}`;
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  return new NextRequest(url, { method, headers });
}

/**
 * Build a NextRequest whose headers is a native Headers instance.
 *
 * checkAdminSession calls NextResponse.next({ request: req }) which requires
 * req.headers to be a native Headers instance (Next.js E119). Tests that reach
 * the admin gate must use this helper instead of makeRequest.
 */
function makeAdminRequest(pathname: string): NextRequest {
  const url = `http://localhost:3000${pathname}`;
  return new NextRequest(url, { method: 'GET', headers: new Headers() });
}

// ─── OPTIONS preflight tests ──────────────────────────────────────────────────

describe('CORS OPTIONS preflight — /api/adapt routes', () => {
  it('CORS-OPTIONS-1: localhost:5173 preflight returns 204 + Allow-Origin in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt', 'OPTIONS', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('CORS-OPTIONS-2: the preflight does NOT answer localhost in prod [FOLLOW-1333]', async () => {
    // BEHAVIOUR CHANGED TWICE. FOLLOW-941 made the preflight reflect any origin, because it could
    // not resolve the tenant whose per-tenant list would decide. FOLLOW-1333 replaced that list
    // with one constant, so the preflight now gives the answer the actual request will.
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/adapt', 'OPTIONS', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('CORS-OPTIONS-3: app.estalara.com preflight returns Allow-Origin in prod', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/adapt', 'OPTIONS', 'https://app.estalara.com');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.estalara.com');
  });

  it('CORS-OPTIONS-4: a hostile origin does not clear the preflight, in dev or prod [FOLLOW-1333]', async () => {
    // Under FOLLOW-941 this origin cleared the preflight and was refused one hop later, by
    // `resolveApiKey`'s 403. It is now refused at both layers.
    for (const env of ['development', 'production']) {
      vi.stubEnv('NODE_ENV', env);
      const res = await middleware(
        makeRequest('/api/adapt', 'OPTIONS', 'https://evil.example.com'),
      );
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin'), env).toBeNull();
    }
  });

  it('OPTIONS preflight matches /api/adapt/description in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt/description', 'OPTIONS', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('OPTIONS preflight matches /api/adapt/feedback in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt/feedback', 'OPTIONS', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});

// ─── Non-preflight inject tests ───────────────────────────────────────────────

describe('CORS preflight — POST /api/quiz/completion (FOLLOW-936)', () => {
  // This route had NO CORS producer. The SDK POSTs it with three non-safelisted headers
  // (`packages/sdk/src/core/adapt.ts:264`), so a preflight is MANDATORY, and Next's
  // auto-generated OPTIONS answered 204 with zero CORS headers — the browser never sent the POST,
  // so `resolved_archetype` never reached `quiz_completions` for any cross-origin visitor. Silent:
  // the call is fire-and-forget behind `.catch(console.warn)`.
  //
  // Red-first: every case here fails with `SDK_CORS_PREFIXES = ['/api/adapt']`.

  it('answers the preflight with the listed origin, not a wildcard', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/quiz/completion', 'OPTIONS', 'https://app.estalara.com');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    // The listed origin, NOT `*` — this route is HMAC-signed and writes tenant-scoped rows, so it
    // takes /api/adapt's allow-list. `consent-text.json` uses `*` for the opposite reason
    // (ADR-0021 §D3 requires its response to be identical for every visitor). Two answers, one axis.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.estalara.com');
  });

  it('allows POST and every non-safelisted header the SDK actually sends', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/quiz/completion', 'OPTIONS', 'https://app.estalara.com');
    const res = await middleware(req);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    const allowed = res.headers.get('Access-Control-Allow-Headers') ?? '';
    // Derived from the consumer, not guessed: adapt.ts:264 sends exactly these three.
    for (const header of ['Authorization', 'Content-Type', 'X-Estalara-Signature']) {
      expect(
        allowed,
        `preflight does not allow ${header}, so the POST never leaves the browser`,
      ).toContain(header);
    }
  });

  it('carries the CORS header on the actual POST, not only on the preflight', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/quiz/completion', 'POST', 'https://app.estalara.com');
    const res = await middleware(req);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.estalara.com');
  });

  it('does not answer an unlisted origin on the preflight [FOLLOW-1333]', async () => {
    // The authenticated layer still refuses it with 403 (this route WRITES, and omitting a CORS
    // header only stops the browser READING the response) — the preflight refusal is extra.
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/quiz/completion', 'OPTIONS', 'https://evil.example.com');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('FOLLOW-1333 — the ACTUAL response answers listed origins only, on every SDK route', () => {
  // FOLLOW-942/950 reflected the caller's own origin on the fully origin-gated routes, so an
  // external brand on its own domain could read its responses. With one tenant (ESC-085) there
  // is no such brand: every SDK route and method now gives the preflight's answer.
  const SDK_ROUTES = [
    ['/api/adapt', 'POST'],
    ['/api/adapt/description', 'GET'],
    ['/api/adapt/feedback', 'POST'],
    ['/api/quiz/completion', 'POST'],
    ['/api/quiz/run', 'POST'],
  ] as const;

  it('no SDK route reflects an unlisted origin in prod', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const [path, method] of SDK_ROUTES) {
      const res = await middleware(makeRequest(path, method, 'https://homes.clientbrand.com'));
      expect(res.headers.get('Access-Control-Allow-Origin'), `${path} [${method}]`).toBeNull();
    }
  });

  it('every SDK route answers both prod origins in prod', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const origin of ['https://app.estalara.com', 'https://admin.estalara.com']) {
      for (const [path, method] of SDK_ROUTES) {
        const res = await middleware(makeRequest(path, method, origin));
        expect(res.headers.get('Access-Control-Allow-Origin'), `${path} [${method}]`).toBe(origin);
      }
    }
  });

  it('a path variant or an unrouted method under an SDK prefix reflects nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const [path, method] of [
      ['/api/adapt/', 'POST'],
      ['/api/adapt/', 'GET'],
      ['/api/adapt/description', 'POST'],
      ['/api/adapt/some-future-route', 'GET'],
    ] as const) {
      const res = await middleware(makeRequest(path, method, 'https://homes.clientbrand.com'));
      expect(res.headers.get('Access-Control-Allow-Origin'), `${path} [${method}]`).toBeNull();
    }
  });

  // ⚠️ There is deliberately NO case here asserting `Vary: Origin` on the ACTUAL response.
  // [FOLLOW-956] One existed and it PASSED while the shipped response carried no `Origin` at
  // all: it read headers off the `NextResponse` this middleware RETURNS, which is the
  // middleware's OUTPUT and not the response the browser receives. Over HTTP/2 through Vercel
  // the duplicate `Vary` (ours + Next's RSC keys) is collapsed above the application and Next's
  // wins, so no assertion at THIS layer can distinguish a working fix from a broken one — which
  // is why the producer was removed instead of re-asserted. The only instrument that can judge
  // it is a probe of the deployed origin. Re-adding a case here without that probe would
  // recreate the false green (Rule AU).

  it('FOLLOW-953: the PREFLIGHT declares Vary: Origin, listed origin or not', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const origin of ['https://homes.clientbrand.com', 'https://app.estalara.com']) {
      const req = makeRequest('/api/adapt/feedback', 'OPTIONS', origin);
      const res = await middleware(req);
      expect(res.status).toBe(204);
      expect(res.headers.get('Vary'), origin).toMatch(/\bOrigin\b/);
    }
  });
});

describe('CORS header injection — GET/POST to /api/adapt routes', () => {
  it('CORS-GET-1: GET /api/adapt from localhost:5173 injects Allow-Origin header in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt', 'GET', 'http://localhost:5173');
    const res = await middleware(req);
    // Middleware calls NextResponse.next() and sets header — it is not a real 200 response
    // (route handler hasn't run), but the returned NextResponse carries the injected header.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('CORS-GET-2: GET /api/adapt from localhost reflects NOTHING in prod [FOLLOW-1333]', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/adapt', 'GET', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('CORS-GET-3: GET /api/adapt/description injects Allow-Origin in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt/description', 'GET', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('CORS-GET-4: POST /api/adapt/feedback injects Allow-Origin in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt/feedback', 'POST', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('CORS-NON-ADAPT: /api/quiz/public-config is NOT matched (middleware passes through)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/quiz/public-config', 'GET', 'http://localhost:5173');
    const res = await middleware(req);
    // Middleware passes through — it must NOT inject a conflicting Allow-Origin.
    // The route itself sets `*`; middleware should not override it.
    // Since the middleware calls NextResponse.next() without headers here, the
    // header on the _middleware_ response will be null (the route sets it separately).
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

// ─── Admin gate tests (FOLLOW-336, RETRO-083 TG-2) ───────────────────────────
//
// These tests exercise the checkAdminSession branch of the REAL middleware function.
// createServerClient from @supabase/ssr is mocked above; mockGetUser controls what
// the SSR client returns. The REAL middleware reads the result — no logic is
// re-implemented in the test (Rule Q guardrail).
//
// NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set for
// checkAdminSession to proceed past its env guard; ADMIN-5 tests the absent-env path.

describe('Admin gate — /admin/* routes via checkAdminSession (FOLLOW-336)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
  });

  it('ADMIN-1: GET /admin/dashboard — staff session → passes through, X-Staff-Role header set', async () => {
    // The value under test — estalara_staff: true + estalara_role — comes from the
    // mocked createServerClient().auth.getUser() response, mirroring what Supabase
    // returns for an active staff session. The REAL checkAdminSession reads it.
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'staff-uuid',
          app_metadata: {
            estalara_staff: true,
            estalara_role: 'estalara:ops',
          },
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    });

    const req = makeAdminRequest('/admin/dashboard');
    const res = await middleware(req);

    // A redirect would have status 307/308; NextResponse.next() has no redirect.
    // The middleware returns the supabaseResponse which has no redirect URL set.
    expect(res.headers.get('location')).toBeNull();
    // Role must be surfaced as a response header (middleware.ts line 215).
    expect(res.headers.get('X-Staff-Role')).toBe('estalara:ops');
  });

  it('ADMIN-2: GET /admin/sessions — no Supabase session (getUser → null user) → redirect to /sign-in', async () => {
    // No active session — checkAdminSession returns { authorized: false }.
    // The REAL middleware calls loginRedirect() → NextResponse.redirect to /sign-in.
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const req = makeAdminRequest('/admin/sessions');
    const res = await middleware(req);

    // A redirect response has a location header.
    const location = res.headers.get('location');
    expect(location).not.toBeNull();
    expect(location).toContain('/sign-in');
    // The redirect should carry the original path as a ?redirect= param so the
    // sign-in page can send the user back.
    expect(location).toContain('redirect=%2Fadmin%2Fsessions');
  });

  it('ADMIN-3: GET /admin/sessions — non-staff user (estalara_staff: false) → redirect to /sign-in', async () => {
    // A valid Supabase session exists but the user is not Estalara staff.
    // checkAdminSession returns { authorized: false } → loginRedirect.
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'tenant-uuid',
          app_metadata: { provider: 'email' },
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    });

    const req = makeAdminRequest('/admin/sessions');
    const res = await middleware(req);

    const location = res.headers.get('location');
    expect(location).not.toBeNull();
    expect(location).toContain('/sign-in');
  });

  it('ADMIN-4: GET /sign-in → NOT caught by admin gate → passes through (no redirect loop)', async () => {
    // /sign-in is in PUBLIC_PREFIXES; it does NOT start with /admin, so the admin
    // gate is never reached. Verify no redirect is issued — this proves the
    // middleware cannot loop: an unauthenticated /admin request redirects to
    // /sign-in, and /sign-in itself is always passed through.
    //
    // mockGetUser is irrelevant here; /sign-in bypasses checkAdminSession entirely.
    const req = makeRequest('/sign-in');
    const res = await middleware(req);

    expect(res.headers.get('location')).toBeNull();
  });

  it.each(['/forgot-password', '/auth/callback', '/reset-password'])(
    'RECOVERY-PUBLIC (FOLLOW-1336): GET %s → reachable without a staff session (no redirect, no Supabase lookup)',
    async (path) => {
      const res = await middleware(makeRequest(path));

      expect(res.headers.get('location')).toBeNull();
      expect(mockGetUser).not.toHaveBeenCalled();
    },
  );

  it('RECOVERY-PUBLIC-NARROW (FOLLOW-1336): /admin is still gated — a lookalike path does not ride the public prefixes', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeAdminRequest('/admin/reset-password'));

    expect(res.headers.get('location')).toContain('/sign-in');
  });

  it('ADMIN-5: GET /admin/dashboard — Supabase env vars absent → redirect to /sign-in', async () => {
    // When NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are unset, checkAdminSession
    // returns early with { authorized: false } — same redirect outcome as no session.
    vi.unstubAllEnvs();
    // Deliberately do NOT set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.

    const req = makeAdminRequest('/admin/dashboard');
    const res = await middleware(req);

    const location = res.headers.get('location');
    expect(location).not.toBeNull();
    expect(location).toContain('/sign-in');
  });
});

// ─── /dashboard → /admin redirects (FOLLOW-1335) ─────────────────────────────
//
// The agency dashboard and its session gate are gone. Every old /dashboard URL answers a 307 to
// the /admin page that hosts the same function; the redirect needs no session (it reveals nothing
// the target's own staff gate does not), and the target is still gated like any /admin path.

const T = `/admin/tenants/${ESTALARA_TENANT_ID}`;

describe('Dashboard redirects — /dashboard/* → /admin (FOLLOW-1335)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
  });

  it.each([
    ['/dashboard', '/admin'],
    ['/dashboard/', '/admin'],
    ['/dashboard/analytics', `${T}/analytics`],
    ['/dashboard/analytics?tab=pilot', `${T}/analytics?tab=pilot`],
    ['/dashboard/analytics?tab=quiz', `${T}/analytics?tab=quiz`],
    ['/dashboard/analytics?tab=overview', `${T}/analytics?tab=overview`],
    ['/dashboard/analytics?tab=https%3A%2F%2Fevil.example', `${T}/analytics`],
    ['/dashboard/pilot', `${T}/analytics?tab=pilot`],
    ['/dashboard/quiz/analytics', `${T}/analytics?tab=quiz`],
    ['/dashboard/analytics/labels', `${T}/labels`],
    ['/dashboard/quiz', `${T}/quiz`],
    ['/dashboard/demo/override', `${T}/demo`],
    ['/dashboard/settings', '/admin/settings'],
    ['/dashboard/listings/listing-42/answers', `${T}/listings/listing-42/answers`],
    ['/dashboard/onboarding/detect', '/admin'],
    ['/dashboard/listings/listing-42', '/admin'],
  ])('REDIRECT: %s → 307 %s, no session lookup', async (from, to) => {
    const res = await middleware(makeAdminRequest(from));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`http://localhost:3000${to}`);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it.each([
    '/dashboard/listings/%2F%2Fevil.com/answers',
    '/dashboard/listings/%5Cevil.com/answers',
    '/dashboard/listings/%5C%5Cevil.com/answers',
    '/dashboard/listings/%2e%2e/answers',
    '/dashboard/listings/../answers',
    '/dashboard/listings/..%2F..%2Fsign-in/answers',
    '/dashboard/listings/https:%2F%2Fevil.com/answers',
  ])('REDIRECT-HOSTILE: listing id in %s never leaves /admin on the same origin', async (from) => {
    const res = await middleware(makeAdminRequest(from));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location') ?? '', 'http://unparseable.invalid');
    expect(location.origin).toBe('http://localhost:3000');
    expect(location.pathname.startsWith('/admin/') || location.pathname === '/admin').toBe(true);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('REDIRECT-PREFIX: a lookalike path (/dashboards) is not redirected', async () => {
    const res = await middleware(makeRequest('/dashboards'));

    expect(res.headers.get('location')).toBeNull();
  });

  it('REDIRECT-GATED: the redirect target still requires a staff session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const hop = await middleware(makeAdminRequest('/dashboard/analytics?tab=pilot'));
    const target = new URL(hop.headers.get('location') ?? '');

    const res = await middleware(makeAdminRequest(`${target.pathname}${target.search}`));

    expect(res.headers.get('location')).toContain('/sign-in');
  });

  it('REDIRECT-GATED: a former agency session (tenant_id + agency_role, no staff flag) cannot open the target', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-uuid',
          app_metadata: { tenant_id: 'tenant-uuid-001', agency_role: 'agency:owner' },
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    });

    const res = await middleware(makeAdminRequest(`${T}/analytics`));

    expect(res.headers.get('location')).toContain('/sign-in');
  });
});

describe('No agency role header (FOLLOW-1335)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
  });

  it('NO-AGENCY-HEADER: no response header (incl. forwarded request headers) names an agency role', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'staff-uuid',
          app_metadata: {
            estalara_staff: true,
            estalara_role: 'estalara:superadmin',
            // A stale claim left on an old account must not be forwarded either.
            agency_role: 'agency:owner',
            tenant_id: 'tenant-uuid-001',
          },
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    });
    const responses = [
      await middleware(makeAdminRequest(`${T}/analytics`)),
      await middleware(makeAdminRequest('/dashboard/analytics')),
      await middleware(makeRequest('/sign-in')),
      await middleware(makeRequest('/api/adapt', 'POST', 'https://app.estalara.com')),
    ];

    for (const res of responses) {
      // NextResponse.next({ request: { headers } }) forwards request headers to the route as
      // `x-middleware-request-<name>` response headers, so this also covers the forwarded set.
      const names = [...res.headers.keys()];
      expect(names.filter((n) => n.includes('agency'))).toEqual([]);
    }
    // The staff request reached the gate and passed (the loop did not vacuously see redirects).
    expect(responses[0]?.headers.get('X-Staff-Role')).toBe('estalara:superadmin');
  });
});
