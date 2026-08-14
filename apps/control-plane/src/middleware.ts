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
 * CORS for SDK-facing adapt routes:
 *   /api/adapt, /api/adapt/description, /api/adapt/feedback, /api/quiz/completion need CORS
 *   headers for the browser SDK calling both from http://localhost:5173 in local E2E mode AND
 *   from an external tenant's own domain in production. [CORRECTED, FOLLOW-949 — this paragraph
 *   was stale for three of four routes since #714/FOLLOW-941/942: most of the routes above
 *   REFLECT the caller's `Origin` in production rather than being restricted to the two prod
 *   origins.] See `isFullyOriginGated` below for exactly which (path, method) pairs qualify and
 *   why; today only `POST /api/adapt` is held back to `CORS_PROD_ORIGINS` (FOLLOW-943 tracks
 *   closing it) — `GET /api/adapt` reflects, same as the other three routes.
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

// ─── CORS allow-list / origin-gating for SDK-facing adapt routes ──────────────
// [CORRECTED, FOLLOW-949 — the "dev-only" framing was stale: `sdkCorsAllowedOrigins()` below is
// the dev-vs-prod PLATFORM allow-list `resolveCorsOrigin` falls back to, but most of these routes
// no longer use that fallback in production — they reflect via `isFullyOriginGated` instead.]

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
 * also means it inherits the preflight handler and — via `isFullyOriginGated` below — the same
 * fully-origin-gated REFLECTING behaviour `/api/adapt/feedback` and `/api/adapt/description` get,
 * for free. [CORRECTED, FOLLOW-949 — this sentence previously said "and `CORS_PROD_ORIGINS` for
 * free", i.e. restriction to the two platform origins; that was never what actually shipped
 * (`/api/quiz/completion`'s own registry row two paragraphs down has always read `reflects`), and
 * repeating the wrong claim here is exactly the class of drift RETRO-266/267 kept finding.]
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
    // FOLLOW-953 — the response body is constant but this HEADER is a function of the request's
    // `Origin`, over an unbounded set since FOLLOW-941 made it reflect. `Vary` is what tells any
    // shared cache that `Origin` is part of the cache key; without it a cache honouring
    // `cache-control: public` may serve origin A's header to origin B. Vercel's own edge does not
    // cache these today (`max-age=0, must-revalidate`, observed `BYPASS`), so this is correctness
    // ahead of exposure rather than an incident fix — but the omission is not something a future
    // caching change should have to rediscover.
    res.headers.append('Vary', 'Origin');
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

/**
 * Routes where every BROWSER-REACHABLE authentication path runs the per-tenant origin gate.
 * [FOLLOW-942]
 *
 * Only these may have their `Access-Control-Allow-Origin` REFLECTED on the actual request: a
 * non-permitted origin never receives a 2xx from them through any credential a page can hold,
 * because `resolveApiKey` (or the route's own inline gate) refuses it with 403 first. Reflecting
 * therefore exposes nothing an attacker's page could not already read — its own error response.
 *
 * **The claim is "browser-reachable", NOT "every path", and the difference is load-bearing.** All
 * three routes below also accept the `ADAPT_API_KEY` ops bearer, which returns BEFORE any origin
 * lookup (`quiz/completion/route.ts` Step 1, `adapt-get-auth.ts` Step 1,
 * `adapt/feedback/route.ts` Step 2). That path is deliberately un-gated and stays safe on one
 * stated condition: `ADAPT_API_KEY` is a server-side Doppler secret that is never shipped to a
 * browser, so no page can present it. **If that key is ever put into browser-delivered code, this
 * reflection becomes a hole and must be closed with it** — the same falsification condition the
 * ops exemption already documents in place, restated here because THIS is where it decides whether
 * a response is readable cross-origin.
 *
 * **`POST /api/adapt` is EXCLUDED, and the exclusion is the honest half of this fix: it has a
 * third auth path that IS browser-reachable — a valid demo JWT short-circuits before
 * `resolveApiKey` is ever called — so a non-permitted origin can genuinely get a 2xx there.**
 * Reflecting would hand any page a readable adapt response. Tracked as FOLLOW-943; this list
 * narrows the moment that lands.
 *
 * **[CORRECTED, FOLLOW-949] The exclusion above is scoped to POST, not the whole path.** This
 * function used to exclude the bare `/api/adapt` PATH regardless of method — but the demo-JWT
 * short-circuit that justifies the exclusion only exists on the POST handler
 * (`app/api/adapt/route.ts:1104` `POST`, demo-JWT check at `:1137-1155`). `GET /api/adapt`
 * authenticates through `resolveAdaptGetAuth` (`adapt-get-auth.ts`) — the SAME two-step resolver
 * (ops bearer → `resolveApiKey`) as `GET /api/adapt/description`, which already reflects — so a
 * non-permitted origin CANNOT get a 2xx from `GET /api/adapt` through any browser-held credential.
 * It belongs in the SAME safety class as the four routes above it, not in the one honest
 * exception. Traced per method in FOLLOW-949 (source: RETRO-267):
 *
 * | route                        | auth paths                                                    | un-gated browser path? |
 * | ----------------------------- | -------------------------------------------------------------- | ----------------------- |
 * | `POST /api/adapt`             | ops key → **demo JWT** → `resolveApiKey`                       | **YES** — stays excluded |
 * | `GET /api/adapt`               | `resolveAdaptGetAuth` → ops key → `resolveApiKey`               | no — now reflects        |
 * | `GET /api/adapt/description`   | the same helper, the same two steps                             | no — already reflected   |
 *
 * **Realized impact of the fix is currently zero**, same as the defect it closes: the SDK's own
 * `/api/adapt` call is a POST (`packages/sdk/src/core/adapt.ts:1191`), so no shipped browser path
 * changes behaviour today. What changes is that the STATED reason for excluding a path now
 * actually applies to the method it excludes, and any future browser-side `GET /api/adapt` caller
 * reflects instead of silently inheriting an exclusion that was never about it.
 *
 * **Why the decision is taken HERE and not in the six route handlers [FOLLOW-942 AC(2)].** The
 * handlers are the more precise place: each one already holds the resolved tenant, so it could echo
 * the exact per-tenant verdict instead of reflecting. That is what `ApiKeyAuthResult.allowedOrigin`
 * was built to carry, and it is deliberately deleted rather than wired, for two reasons. **Cost:**
 * moving the verdict into middleware instead would mean a per-tenant Postgres read on the edge hot
 * path for every SDK request, which this layer has never done and the latency budget has no room
 * for; reflecting costs nothing precisely because the 403 one hop downstream has already done that
 * work. **Count:** the handler variant is six return paths across five files, each of which has to
 * remember the header on every future error branch — the exact shape that produced FOLLOW-936 (a
 * route with no CORS producer at all) and this ticket. One place whose safety is stated and
 * testable beats six places that are individually correct on the day they are written.
 *
 * **That collision has now been resolved, and not in the direction this note expected.** #733
 * (FOLLOW-950) merged first and inverted the mechanism to the opt-IN `ORIGIN_REFLECTING_ROUTES`
 * Map below. The `['/api/adapt', ['GET']]` row this note anticipated was deliberately NOT added:
 * that registry and `sdk-cors-coverage.test.ts` together require a reflecting (path, method) to
 * be a real SDK `fetch(` site — one guard demands a matching `reflects` row, two more demand the
 * row name an existing call site and an `enforcedIn` file that actually gates. Nothing in a
 * browser calls `GET /api/adapt`: the SDK POSTs (`core/adapt.ts:1191`) and the real GET callers
 * are ops/E2E reachability traffic, which is server-side and needs no CORS at all — FOLLOW-949's
 * own AC(4) is what established that. So the grant would have had no browser client, which is
 * precisely the default-on permission the opt-in list exists to prevent. FOLLOW-949's substance
 * survives as the GET/POST distinction, the corrected docblocks and the method-aware registry;
 * only the grant itself proved unnecessary. Add the row if an SDK call site ever appears.
 */
/**
 * The ONLY (path, method) pairs permitted to reflect the caller's `Origin`. [FOLLOW-950 AC(1)]
 *
 * **This list is opt-IN, and the inversion is the whole point.** It used to be opt-OUT: reflection
 * was granted by PREFIX (`isSdkCorsRoute`) with one hardcoded exclusion for `/api/adapt`, so any
 * future `/api/adapt/<anything>` reflected any origin BY DEFAULT — whatever its auth shape, with
 * no test and no registry entry required. The registry could not catch it either, because it is
 * derived from SDK `fetch(` sites, so a route no SDK file calls never appears in it at all.
 *
 * The safe setting must be the default; the dangerous one must be the one you opt into. A new
 * route under an existing prefix is now `platform-only` until somebody adds it here on purpose.
 *
 * **Keyed by METHOD as well as path** because auth shape varies by method: a route may gate its
 * POST and leave a GET readable, and a path-only allow-list cannot express that.
 *
 * `OPTIONS` is deliberately absent: preflight returns earlier (`sdkCorsPreflightResponse`) and
 * reflects by design — it carries no credentials and cannot know the tenant, so it cannot make a
 * per-tenant decision. Enforcement happens on the actual request.
 *
 * **Adding a row here is a security decision.** The claim it asserts is that EVERY
 * browser-reachable auth path on that (path, method) reaches the origin gate before returning 2xx.
 * `sdk-cors-coverage.test.ts` checks that claim against the route source (FOLLOW-950 AC(2)); it is
 * not taken on trust from this comment.
 */
const ORIGIN_REFLECTING_ROUTES: ReadonlyMap<string, readonly string[]> = new Map([
  ['/api/adapt/description', ['GET'] as const],
  ['/api/adapt/feedback', ['POST'] as const],
  ['/api/quiz/completion', ['POST'] as const],
]);

function isFullyOriginGated(pathname: string, method: string): boolean {
  return ORIGIN_REFLECTING_ROUTES.get(pathname)?.includes(method) ?? false;
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
    // FOLLOW-942 — this line was the false half of FOLLOW-941's AC(4). #714 made the PREFLIGHT
    // reflect and left the ACTUAL response on the hardcoded platform pair, so an external brand
    // cleared the preflight, passed the per-tenant 403 gate, and then could not READ the response.
    // The refusal had moved one hop downstream rather than gone away — caught by RETRO-266 probing
    // production, not by any test, because both halves were green in isolation.
    const allowOrigin = isFullyOriginGated(pathname, req.method)
      ? requestOrigin
      : resolveCorsOrigin(requestOrigin);
    const res = NextResponse.next();
    if (allowOrigin) {
      res.headers.set('Access-Control-Allow-Origin', allowOrigin);
      // ⚠️ NO `Vary: Origin` HERE, and its absence is measured rather than overlooked.
      // [FOLLOW-956]
      //
      // This header varies by the request's `Origin`, so `Origin` belongs in the cache key, and
      // FOLLOW-953 duly appended it here. Probing the deployed origin showed it never reaches
      // the browser. Three writers were tried and all lose: the response leaves the Node server
      // with TWO `Vary` lines (this one and Next's RSC keys — locally both are visible, so
      // `.append()` works exactly as intended), and over HTTP/2 through Vercel the duplicate is
      // collapsed ABOVE the application, keeping Next's. A `next.config` `headers()` entry lost
      // the same way, and `routes-manifest.json` proves that rule COMPILED and MATCHED the path
      // — so it applied and still lost. The dead producers were removed rather than left to
      // read as "we handle this".
      //
      // The PREFLIGHT builder above keeps its `Vary: Origin` and it IS live-verified — that
      // response terminates in middleware, so Next never writes a competing one.
      //
      // Exposure today is nil: `x-vercel-cache` is `MISS`/`BYPASS` and every request carries
      // `Authorization`. REOPEN FOLLOW-956 the moment either stops being true — a cacheable
      // response on this path is what turns this from a correctness gap into a real leak.
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
