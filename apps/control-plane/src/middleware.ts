/**
 * Next.js App Router middleware — JWT-based route protection.
 *
 * Route rules:
 *   /admin/*      → Estalara staff only (estalara:readonly minimum)
 *   /dashboard/*  → Agency tenant users only (agency:viewer minimum)
 *   /             → public (landing page)
 *   /login        → public
 *   /register     → public
 *   /api/health   → public
 *   everything else → public (no auth gate at middleware level)
 *
 * Auth failures redirect to /login with a `redirect` query param so the login
 * page can send the user back after successful authentication.
 *
 * @module apps/control-plane/src/middleware
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  getAuthClaims,
  isStaffClaims,
  isTenantClaims,
  requireAgencyRole,
  requireStaffRole,
} from '@estalara/auth';

/** Routes that require no authentication. */
const PUBLIC_PREFIXES = ['/', '/login', '/register', '/api/health'];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

function loginRedirect(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('redirect', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  // Generate a correlation ID for every gated request.
  const requestId = crypto.randomUUID();

  // Staff admin routes — require Estalara staff (readonly minimum)
  if (pathname.startsWith('/admin')) {
    const claims = await getAuthClaims(req);
    if (!claims) return loginRedirect(req);
    try {
      requireStaffRole(claims, 'estalara:readonly');
    } catch {
      return loginRedirect(req);
    }
    const res = NextResponse.next();
    res.headers.set('X-Request-Id', requestId);
    if (isStaffClaims(claims)) {
      res.headers.set('X-Staff-Role', claims.estalara_role);
    }
    return res;
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
