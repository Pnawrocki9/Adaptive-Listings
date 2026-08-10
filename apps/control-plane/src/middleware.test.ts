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
 * and dashboard gate (checkDashboardSession) via @supabase/ssr (FOLLOW-454).
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
 *   CORS-GET-2: GET /api/adapt from localhost:5173 → no Allow-Origin in prod
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
 *   DASHBOARD-1: GET /dashboard/analytics — SSR browser session (agency:admin) →
 *                passes through, X-Tenant-Id header set (FOLLOW-454)
 *   DASHBOARD-2: GET /dashboard/analytics — no SSR session → redirect to /sign-in
 *   DASHBOARD-3: GET /dashboard/analytics — SSR session belongs to staff (no tenant) →
 *                redirect to /sign-in
 *   DASHBOARD-4: GET /dashboard/analytics — Supabase env vars absent + no legacy JWT →
 *                redirect to /sign-in
 *   DASHBOARD-5: legacy Bearer JWT (Path 1) still authorizes — SSR client never invoked
 *
 * Auth calls are mocked so the test does not require a live DB or JWT secret.
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

// ─── Mock @estalara/auth ───────────────────────────────────────────────────────
// Keeps the dashboard/admin bearer-JWT branches from needing real JWTs.

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
  isStaffClaims: vi.fn().mockReturnValue(false),
  isTenantClaims: vi.fn().mockReturnValue(false),
  requireAgencyRole: vi.fn(),
  requireStaffRole: vi.fn(),
}));

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

import { getAuthClaims, isTenantClaims } from '@estalara/auth';
import { middleware } from './middleware.js';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockIsTenantClaims = vi.mocked(isTenantClaims);

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

  it('CORS-OPTIONS-2: the preflight REFLECTS any origin, including one the platform list omits', async () => {
    // BEHAVIOUR CHANGED DELIBERATELY IN FOLLOW-941 — this case previously asserted a null header.
    //
    // The preflight carries no API key (browsers strip it), so the tenant cannot be resolved and
    // a per-tenant answer is impossible at this layer. Refusing here refused every external brand
    // on its own domain, which is the defect FOLLOW-941 fixed. Reflecting grants nothing: the
    // actual request is authenticated and `resolveApiKey` answers a non-allow-listed origin with
    // 403 before any handler runs. The refusal did not disappear — it moved to the only layer
    // that can make it correctly, and `lib/origin-policy.test.ts` proves it there.
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/adapt', 'OPTIONS', 'http://localhost:5173');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('CORS-OPTIONS-3: app.estalara.com preflight returns Allow-Origin in prod', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/adapt', 'OPTIONS', 'https://app.estalara.com');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.estalara.com');
  });

  it('CORS-OPTIONS-4: a hostile origin also clears the preflight, and is refused at the gate', async () => {
    // Also changed by FOLLOW-941, and this is the case worth being uncomfortable about, so state
    // the security argument rather than assuming it: a cleared preflight authorises NOTHING. The
    // attacker still needs a valid API key, and even holding one, `resolveApiKey` refuses the
    // origin with 403 before the handler runs — so no read, and for a write route no row. The
    // ingest Worker made the same trade and documents it as DOMAIN-INDEPENDENCE.
    vi.stubEnv('NODE_ENV', 'development');
    const req = makeRequest('/api/adapt', 'OPTIONS', 'https://evil.example.com');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://evil.example.com');
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

  it('answers the preflight with the reflected origin, not a wildcard', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/quiz/completion', 'OPTIONS', 'https://app.estalara.com');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    // Reflected, NOT `*` — this route is HMAC-signed and writes tenant-scoped rows, so it takes
    // /api/adapt's allow-list. `consent-text.json` uses `*` for the opposite reason (ADR-0021 §D3
    // requires its response to be identical for every tenant). Two answers, one axis.
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

  it('reflects on the preflight — the origin decision belongs to the authenticated layer', async () => {
    // Written in FOLLOW-936 to assert a preflight refusal; FOLLOW-941 moved that decision. This
    // route WRITES, so the refusal has to be a 403 anyway: omitting a CORS header only stops the
    // browser READING the response, and the row would already be in `quiz_completions`.
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/quiz/completion', 'OPTIONS', 'https://evil.example.com');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://evil.example.com');
  });
});

describe('FOLLOW-942 — the ACTUAL response, not only the preflight, admits an external brand', () => {
  // The defect RETRO-266 found by probing production: #714 made the preflight reflect and left
  // this half on the hardcoded platform pair, so an external brand cleared the preflight, passed
  // the per-tenant 403 gate, and then could not READ the response. Both halves were green in
  // isolation; nothing tested the pair.

  it('reflects the origin on a fully-gated route (/api/adapt/feedback)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/adapt/feedback', 'POST', 'https://homes.clientbrand.com');
    const res = await middleware(req);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://homes.clientbrand.com');
  });

  it('reflects on /api/adapt/description and /api/quiz/completion too', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const path of ['/api/adapt/description', '/api/quiz/completion']) {
      const res = await middleware(makeRequest(path, 'POST', 'https://homes.clientbrand.com'));
      expect(res.headers.get('Access-Control-Allow-Origin'), path).toBe(
        'https://homes.clientbrand.com',
      );
    }
  });

  it('does NOT reflect on /api/adapt itself — its demo-JWT path bypasses the origin gate', async () => {
    // The honest half. A valid demo JWT short-circuits before `resolveApiKey` runs, so a
    // non-permitted origin CAN get a 2xx there; reflecting would make it readable. Narrows when
    // FOLLOW-943 gates that third path.
    vi.stubEnv('NODE_ENV', 'production');
    const res = await middleware(makeRequest('/api/adapt', 'GET', 'https://homes.clientbrand.com'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('FOLLOW-953: declares Vary: Origin, so Origin is part of the cache key', async () => {
    // The header is now a function of the request's Origin over an UNBOUNDED set. Without Vary a
    // shared cache honouring `cache-control: public` could serve origin A's header to origin B.
    // Vercel's edge does not cache these today, so this guards the answer, not an incident.
    vi.stubEnv('NODE_ENV', 'production');
    const res = await middleware(
      makeRequest('/api/adapt/feedback', 'POST', 'https://homes.clientbrand.com'),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://homes.clientbrand.com');
    expect(res.headers.get('Vary')).toMatch(/\bOrigin\b/);
  });

  it('FOLLOW-953: the PREFLIGHT declares it too', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = makeRequest('/api/adapt/feedback', 'OPTIONS', 'https://homes.clientbrand.com');
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Vary')).toMatch(/\bOrigin\b/);
  });

  it('still serves the platform origins on /api/adapt', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await middleware(makeRequest('/api/adapt', 'GET', 'https://app.estalara.com'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.estalara.com');
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

  it('CORS-GET-2: GET /api/adapt from localhost:5173 — no Allow-Origin in prod', async () => {
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

// ─── Dashboard gate tests (FOLLOW-454) ────────────────────────────────────────
//
// These tests exercise the checkDashboardSession branch of the REAL middleware
// function, plus the legacy Bearer/getAuthClaims Path 1 that must keep working
// unmodified. createServerClient from @supabase/ssr is mocked above; mockGetUser
// controls what the SSR client returns. The REAL middleware reads the result —
// no logic is re-implemented in the test (Rule Q guardrail).

function makeBearerRequest(pathname: string, token: string): NextRequest {
  const url = `http://localhost:3000${pathname}`;
  return new NextRequest(url, {
    method: 'GET',
    headers: new Headers({ Authorization: `Bearer ${token}` }),
  });
}

describe('Dashboard gate — /dashboard/* routes via checkDashboardSession (FOLLOW-454)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
  });

  it('DASHBOARD-1: GET /dashboard/analytics — SSR browser session (agency:admin) → passes through, X-Tenant-Id header set', async () => {
    // The value under test — tenant_id + agency_role — comes from the mocked
    // createServerClient().auth.getUser() response, mirroring what Supabase
    // returns for an active agency-user session with NO Authorization header
    // (same-origin browser fetch relying solely on the chunked SSR cookie).
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-uuid',
          app_metadata: { tenant_id: 'tenant-uuid-001', agency_role: 'agency:admin' },
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    });

    const req = makeAdminRequest('/dashboard/analytics');
    const res = await middleware(req);

    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('X-Tenant-Id')).toBe('tenant-uuid-001');
  });

  it('DASHBOARD-2: GET /dashboard/analytics — no SSR session (getUser → null user) → redirect to /sign-in', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const req = makeAdminRequest('/dashboard/analytics');
    const res = await middleware(req);

    const location = res.headers.get('location');
    expect(location).not.toBeNull();
    expect(location).toContain('/sign-in');
    expect(location).toContain('redirect=%2Fdashboard%2Fanalytics');
  });

  it('DASHBOARD-3: GET /dashboard/analytics — SSR session belongs to Estalara staff (no tenant scope) → redirect to /sign-in', async () => {
    // Staff accounts use /admin, not /dashboard — checkDashboardSession must
    // reject them even though they hold a valid Supabase session.
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'staff-uuid',
          app_metadata: { estalara_staff: true, estalara_role: 'estalara:ops' },
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    });

    const req = makeAdminRequest('/dashboard/analytics');
    const res = await middleware(req);

    const location = res.headers.get('location');
    expect(location).not.toBeNull();
    expect(location).toContain('/sign-in');
  });

  it('DASHBOARD-4: GET /dashboard/analytics — Supabase env vars absent AND no legacy JWT → redirect to /sign-in', async () => {
    vi.unstubAllEnvs();
    // Deliberately do NOT set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.

    const req = makeAdminRequest('/dashboard/analytics');
    const res = await middleware(req);

    const location = res.headers.get('location');
    expect(location).not.toBeNull();
    expect(location).toContain('/sign-in');
  });

  it('DASHBOARD-5: legacy Bearer JWT (Path 1) still authorizes — SSR client never invoked', async () => {
    // Regression guard: programmatic/API-key callers and existing tests that rely
    // on getAuthClaims must keep working unmodified after the FOLLOW-454 fallback
    // was added.
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: 'tenant-uuid-legacy',
      agency_role: 'agency:admin',
      estalara_staff: false,
      mfa_verified: true,
    });
    mockIsTenantClaims.mockReturnValue(true);

    const req = makeBearerRequest('/dashboard/analytics', 'mock-jwt-token');
    const res = await middleware(req);

    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('X-Tenant-Id')).toBe('tenant-uuid-legacy');
    // The SSR fallback (Path 2) must not run once Path 1 already authorized.
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});
