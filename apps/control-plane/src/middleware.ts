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
 * Admin session auth uses @supabase/ssr createServerClient so it handles the
 * chunked sb-<project-ref>-auth-token cookie format set by signInWithPassword().
 * The @estalara/auth getAuthClaims path remains for Bearer-token API routes and
 * tenant dashboard routes.
 *
 * @module apps/control-plane/src/middleware
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getAuthClaims, isTenantClaims, requireAgencyRole } from '@estalara/auth';

// ─── Dev-only CORS allow-list for SDK-facing adapt routes ─────────────────────

/** Production origins the browser SDK may call from. */
const CORS_PROD_ORIGINS = ['https://app.estalara.com', 'https://admin.estalara.com'] as const;

/**
 * Additional localhost origins permitted only in non-production environments.
 * Never served when NODE_ENV === 'production'.
 */
const CORS_DEV_EXTRA_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'] as const;

/**
 * SDK-facing routes that currently set no CORS headers inline.
 * We inject CORS here (in middleware) so we don't have to touch every return
 * path inside the complex route handlers.
 *
 * /api/intent/config and /api/quiz/public-config already return
 * `Access-Control-Allow-Origin: *` directly and are intentionally omitted.
 */
const SDK_CORS_PREFIXES = ['/api/adapt'] as const;

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
  const allowOrigin = resolveCorsOrigin(requestOrigin);
  const res = new NextResponse(null, { status: 204 });
  if (allowOrigin) {
    res.headers.set('Access-Control-Allow-Origin', allowOrigin);
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
    const claims = await getAuthClaims(req);
    if (!claims) return loginRedirect(req);
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
