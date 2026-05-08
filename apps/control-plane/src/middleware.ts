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

import { getAuthClaims, requireAgencyRole, requireStaffRole } from '@estalara/auth';

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

  // Staff admin routes — require Estalara staff (readonly minimum)
  if (pathname.startsWith('/admin')) {
    const claims = await getAuthClaims(req);
    if (!claims) return loginRedirect(req);
    try {
      requireStaffRole(claims, 'estalara:readonly');
    } catch {
      return loginRedirect(req);
    }
    return NextResponse.next();
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
    return NextResponse.next();
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
