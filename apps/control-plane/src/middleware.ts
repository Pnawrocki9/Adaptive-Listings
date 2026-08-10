/**
 * Next.js App Router middleware — JWT-based route protection + dev-only CORS.
 *
 * Route rules:
 *   /admin/*      → Estalara staff only (estalara:readonly minimum)
 *   /dashboard/*  → Agency tenant users only (agency:viewer minimum)
 *   /             → public (redirects to /sign-in)
 *   /sign-in      → public
 *   /register     → public
 *   /api/health   → public
 *   everything else → public (no auth gate at middleware level)
 *
 * Auth failures redirect to /sign-in with a `redirect` query param so the sign-in
 * page can send the user back after successful authentication.
 *
 * CORS for SDK-facing adapt routes (dev only):
 *   /api/adapt, /api/adapt/description, /api/adapt/feedback need CORS headers
 *   for the browser SDK calling from http://localhost:5173 in local E2E mode.
 *   In production (NODE_ENV === 'production') only the two prod origins are allowed.
 *   The /api/intent/config and /api/quiz/public-config routes already set
 *   Access-Control-Allow-Origin: * inline and are unaffected.
 *
 * Admin AND dashboard session auth use @supabase/ssr createServerClient so they
 * handle the chunked sb-<project-ref>-auth-token cookie format set by
 * signInWithPassword() (FOLLOW-326 for /admin, FOLLOW-454 for /dashboard). The
 * @estalara/auth getAuthClaims path is tried first in both blocks and remains the
 * path for Bearer-token programmatic API callers and existing tests; the SSR
 * cookie check is the fallback for same-origin browser-session requests.
 *
 * @module apps/control-plane/src/middleware
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getAuthClaims, isTenantClaims, requireAgencyRole } from '@estalara/auth';

import { CORS_PROD_ORIGINS, CORS_DEV_EXTRA_ORIGINS } from '@/lib/origin-policy';

// ─── Dev-only CORS allow-list for SDK-facing adapt routes ─────────────────────

// The platform origin lists live in `lib/origin-policy` so the preflight layer here and the
// authenticated per-tenant gate read ONE list (Rule AQ, FOLLOW-941).

/**
 * SDK-facing routes that currently set no CORS headers inline.
 * We inject CORS here (in middleware) so we don't have to touch every return
 * path inside the complex route handlers.
 *
 * /api/intent/config and /api/quiz/public-config already return
 * `Access-Control-Allow-Origin: *` directly and are intentionally omitted.
 *
 * `/api/quiz/completion` joined this list in FOLLOW-936. It had **no CORS producer at all**: the
 * SDK POSTs it with `Authorization`, `Content-Type` and `X-Estalara-Signature`
 * (`packages/sdk/src/core/adapt.ts:264`) — three non-safelisted headers, so a preflight is
 * mandatory — and Next's auto-generated `OPTIONS` answered 204 with zero CORS headers. The browser
 * therefore never sent the POST, so `resolved_archetype` never reached `quiz_completions` for any
 * cross-origin visitor, silently: the call is fire-and-forget behind `.catch(console.warn)`.
 *
 * **Reflected allow-list, deliberately NOT the wildcard `consent-text.json` uses.** The two answers
 * in this estate differ on one axis: whether the response is tenant-identified. `consent-text.json`
 * is byte-identical for every tenant and carries no credentials, so `*` is correct there and an
 * allow-list would actually violate ADR-0021 §D3 by making the response vary by origin. This route
 * is HMAC-signed and writes tenant-scoped rows, so it takes `/api/adapt`'s reflected allow-list.
 * Added as a PREFIX here rather than as a second inline CORS block in the route (Rule AQ), which
 * also means it inherits the preflight handler and `CORS_PROD_ORIGINS` for free.
 */
const SDK_CORS_PREFIXES = ['/api/adapt', '/api/quiz/completion'] as const;

/**
 * Returns the set of allowed origins for CORS on SDK-facing routes,
 * gated on the runtime NODE_ENV.
 */
function sdkCorsAllowedOrigins(): readonly string[] {
  if (process.env.NODE_ENV === 'production') {
    return CORS_PROD_ORIGINS;
  }
  return [...CORS_PROD_ORIGINS, ...CORS_DEV_EXTRA_ORIGINS];
}

/**
 * Resolve the reflected `Access-Control-Allow-Origin` value for a given origin.
 * Returns the origin when it is in the allow-list; null otherwise.
 */
function resolveCorsOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null;
  return (sdkCorsAllowedOrigins() as string[]).includes(requestOrigin) ? requestOrigin : null;
}

/**
 * Build a 204 preflight response for SDK-facing adapt routes.
 */
function sdkCorsPreflightResponse(requestOrigin: string | null): NextResponse {
  const res = new NextResponse(null, { status: 204 });
  // REFLECT the requested origin — permissive by design. [FOLLOW-941]
  //
  // The preflight carries NO API key: browsers strip `Authorization` and custom headers from it,
  // so the tenant CANNOT be resolved here and a per-tenant answer is impossible at this layer.
  // The ingest Worker reached the same conclusion and documents it as the DOMAIN-INDEPENDENCE
  // requirement (`apps/ingest/src/router.ts`): an external brand's own domain, unknown to this
  // app up front, must clear the preflight before its tenant config can be consulted.
  //
  // **This grants nothing.** A preflight authorises no side effect; the actual request is still
  // authenticated, and `resolveApiKey` refuses a non-allow-listed origin with 403 before any
  // handler runs. Enforcing a hardcoded list HERE was the FOLLOW-941 defect: it refused every
  // external brand at the one layer that cannot know whether they are legitimate.
  if (requestOrigin) {
    res.headers.set('Access-Control-Allow-Origin', requestOrigin);
  }
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Estalara-Signature',
  );
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}

/** Routes that require no authentication. */
const PUBLIC_PREFIXES = ['/', '/sign-in', '/register', '/api/health'];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

function isSdkCorsRoute(pathname: string): boolean {
  return SDK_CORS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}

// ─── Supabase SSR admin session check ─────────────────────────────────────
// @supabase/ssr sets chunked cookies named sb-<project-ref>-auth-token rather
// than the legacy sb-access-token that @estalara/auth reads. For /admin/* routes
// we use createServerClient to reassemble the session from those cookies, then
// read estalara_staff / estalara_role from app_metadata directly. The cookie
// adapter's setAll callback writes refreshed tokens back onto the response so
// the session stays alive across request boundaries.

type EstalaraRole = 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly';

const STAFF_ROLE_RANK: Record<EstalaraRole, number> = {
  'estalara:superadmin': 3,
  'estalara:ops': 2,
  'estalara:readonly': 1,
};

function isEstalaraRole(v: unknown): v is EstalaraRole {
  return v === 'estalara:superadmin' || v === 'estalara:ops' || v === 'estalara:readonly';
}

async function checkAdminSession(req: NextRequest): Promise<{
  authorized: boolean;
  role?: EstalaraRole;
  supabaseResponse: NextResponse;
}> {
  const supabaseResponse = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { authorized: false, supabaseResponse };

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { authorized: false, supabaseResponse };

  const appMeta = user.app_metadata as Record<string, unknown>;
  const isStaff = appMeta.estalara_staff === true;
  const staffRole = appMeta.estalara_role;

  if (!isStaff || !isEstalaraRole(staffRole)) return { authorized: false, supabaseResponse };
  if (STAFF_ROLE_RANK[staffRole] < STAFF_ROLE_RANK['estalara:readonly']) {
    return { authorized: false, supabaseResponse };
  }

  return { authorized: true, role: staffRole, supabaseResponse };
}

// ─── Supabase SSR tenant (agency) session check ─────────────────────────────
// Same rationale as checkAdminSession above, applied to /dashboard/* routes:
// an agency user's browser session also lives in the chunked SSR cookie, not
// the legacy sb-access-token cookie that getAuthClaims reads, so a logged-in
// dashboard user got 401s on every same-origin fetch (FOLLOW-454).

type AgencyRole = 'agency:owner' | 'agency:admin' | 'agency:viewer';

const AGENCY_ROLE_RANK: Record<AgencyRole, number> = {
  'agency:owner': 3,
  'agency:admin': 2,
  'agency:viewer': 1,
};

function isAgencyRole(v: unknown): v is AgencyRole {
  return v === 'agency:owner' || v === 'agency:admin' || v === 'agency:viewer';
}

interface DashboardSessionClaims {
  sub: string;
  tenantId: string;
  agencyRole: AgencyRole;
}

async function checkDashboardSession(req: NextRequest): Promise<{
  authorized: boolean;
  claims?: DashboardSessionClaims;
  supabaseResponse: NextResponse;
}> {
  const supabaseResponse = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { authorized: false, supabaseResponse };

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { authorized: false, supabaseResponse };

  const appMeta = user.app_metadata as Record<string, unknown>;
  // Staff accounts have no tenant scope — /dashboard is agency-user-only
  // (staff use /admin, gated by checkAdminSession above).
  if (appMeta.estalara_staff === true) return { authorized: false, supabaseResponse };

  const tenantId = appMeta.tenant_id;
  const agencyRole = appMeta.agency_role;
  if (typeof tenantId !== 'string' || tenantId.length === 0 || !isAgencyRole(agencyRole)) {
    return { authorized: false, supabaseResponse };
  }
  if (AGENCY_ROLE_RANK[agencyRole] < AGENCY_ROLE_RANK['agency:viewer']) {
    return { authorized: false, supabaseResponse };
  }

  return {
    authorized: true,
    claims: { sub: user.id, tenantId, agencyRole },
    supabaseResponse,
  };
}

// ───────────────────────────────────────────────────────────────────────────

function loginRedirect(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = '/sign-in';
  url.searchParams.set('redirect', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  // Generate a correlation ID for every gated request.
  const requestId = crypto.randomUUID();

  // ── CORS preflight for SDK-facing adapt routes ───────────────────────────────
  // Handle OPTIONS before the auth guards so the browser can complete its preflight
  // without authentication. This must come before the /admin and /dashboard checks.
  if (req.method === 'OPTIONS' && isSdkCorsRoute(pathname)) {
    return sdkCorsPreflightResponse(req.headers.get('Origin'));
  }

  // ── Inject CORS response headers for SDK-facing adapt routes (non-preflight) ─
  // For actual GET/POST requests, we add the CORS header via NextResponse.next()
  // so the downstream route handler response carries it. The route handler's own
  // headers are merged on top, so no conflict with quiz/intent routes (they set * inline).
  if (isSdkCorsRoute(pathname)) {
    const requestOrigin = req.headers.get('Origin');
    const allowOrigin = resolveCorsOrigin(requestOrigin);
    const res = NextResponse.next();
    if (allowOrigin) {
      res.headers.set('Access-Control-Allow-Origin', allowOrigin);
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.headers.set(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, X-Estalara-Signature',
      );
    }
    return res;
  }

  // Staff admin routes — require Estalara staff (readonly minimum)
  // Uses @supabase/ssr to handle the chunked cookie format from signInWithPassword().
  if (pathname.startsWith('/admin')) {
    const { authorized, role, supabaseResponse } = await checkAdminSession(req);
    if (!authorized) return loginRedirect(req);
    supabaseResponse.headers.set('X-Request-Id', requestId);
    if (role) supabaseResponse.headers.set('X-Staff-Role', role);
    return supabaseResponse;
  }

  // Tenant dashboard routes — require agency user (viewer minimum)
  if (pathname.startsWith('/dashboard')) {
    // Path 1: legacy Bearer header / sb-access-token cookie (existing
    // programmatic callers and tests — unchanged).
    const claims = await getAuthClaims(req);
    if (claims) {
      try {
        requireAgencyRole(claims, 'agency:viewer');
      } catch {
        return loginRedirect(req);
      }
      // Forward tenant identity in request headers so Server Components can read them
      // via `import { headers } from 'next/headers'` or populate AsyncLocalStorage.
      // AsyncLocalStorage cannot be written from Edge Runtime (middleware); layouts
      // should call tenantContextStorage.run() using these headers.
      const reqHeaders = new Headers(req.headers);
      if (isTenantClaims(claims)) {
        reqHeaders.set('x-tenant-id', claims.tenant_id);
        reqHeaders.set('x-user-id', claims.sub);
        reqHeaders.set('x-agency-role', claims.agency_role);
      }
      reqHeaders.set('x-request-id', requestId);
      const res = NextResponse.next({ request: { headers: reqHeaders } });
      // Also surface as response headers for debugging
      if (isTenantClaims(claims)) {
        res.headers.set('X-Tenant-Id', claims.tenant_id);
      }
      res.headers.set('X-Request-Id', requestId);
      return res;
    }

    // Path 2: Supabase SSR browser session (chunked sb-<project-ref>-auth-token
    // cookie) — the path a logged-in agency dashboard browser session actually
    // takes (FOLLOW-454; mirrors checkAdminSession above for /admin).
    const {
      authorized,
      claims: sessionClaims,
      supabaseResponse,
    } = await checkDashboardSession(req);
    if (!authorized || !sessionClaims) return loginRedirect(req);

    const reqHeaders = new Headers(req.headers);
    reqHeaders.set('x-tenant-id', sessionClaims.tenantId);
    reqHeaders.set('x-user-id', sessionClaims.sub);
    reqHeaders.set('x-agency-role', sessionClaims.agencyRole);
    reqHeaders.set('x-request-id', requestId);
    const res = NextResponse.next({ request: { headers: reqHeaders } });
    res.headers.set('X-Tenant-Id', sessionClaims.tenantId);
    res.headers.set('X-Request-Id', requestId);
    // Propagate any refreshed session cookie captured by checkDashboardSession's
    // setAll callback onto the final response — res is a fresh NextResponse.next()
    // call (needed to forward the x-tenant-id request headers), distinct from the
    // supabaseResponse object that setAll wrote the refreshed cookie onto.
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      res.cookies.set(cookie);
    });
    return res;
  }

  // Public routes — no auth required
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // All other routes — pass through (individual pages handle their own guards)
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (Next.js static assets)
     * - _next/image (Next.js image optimisation)
     * - favicon.ico
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
