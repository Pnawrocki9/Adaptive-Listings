/**
 * Dev-only CORS helpers for SDK-facing control-plane routes.
 *
 * Production CORS on SDK-facing routes (quiz/public-config, intent/config) uses
 * `Access-Control-Allow-Origin: *` because those routes are truly public (buyer-facing,
 * no credentials, no PII in the response). This already covers localhost.
 *
 * However, the `adapt`, `adapt/description`, and `adapt/feedback` routes currently
 * set no CORS headers. In local E2E testing the browser SDK on http://localhost:5173
 * (Estalara-app SvelteKit) calls these routes on http://localhost:3000. Without CORS
 * headers the browser rejects the cross-origin response.
 *
 * Strategy:
 *   - In production (`process.env.NODE_ENV === 'production'`): expose only the two
 *     known prod origins (`https://app.estalara.com`, `https://admin.estalara.com`).
 *   - In all other environments: additionally allow `http://localhost:5173` and
 *     `http://localhost:3000` so local E2E works without touching the prod allow-list.
 *
 * Both `buildCorsHeaders` and `OPTIONS` handler helpers accept the inbound `Origin`
 * request header so the response reflects the exact requesting origin (required for
 * credentials-bearing requests; safe here because we check allow-list membership).
 *
 * Usage in a route handler:
 *   ```ts
 *   import { buildCorsHeaders, corsPreflightResponse } from '@/lib/dev-cors';
 *
 *   export function OPTIONS(req: NextRequest) {
 *     return corsPreflightResponse(req.headers.get('Origin'));
 *   }
 *
 *   export async function GET(req: NextRequest) {
 *     const corsHeaders = buildCorsHeaders(req.headers.get('Origin'));
 *     return NextResponse.json({ ... }, { status: 200, headers: corsHeaders });
 *   }
 *   ```
 *
 * @module apps/control-plane/src/lib/dev-cors
 */

import { NextResponse } from 'next/server';

/** Production origins the SDK can call from. */
const PROD_ORIGINS = ['https://app.estalara.com', 'https://admin.estalara.com'] as const;

/**
 * Additional origins allowed only in non-production environments.
 * Never included when NODE_ENV === 'production'.
 */
const DEV_EXTRA_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'] as const;

/**
 * Returns the full set of permitted origins for the current environment.
 * Called once per request so the NODE_ENV check is always fresh.
 *
 * @internal
 */
function allowedOrigins(): readonly string[] {
  if (process.env.NODE_ENV === 'production') {
    return PROD_ORIGINS;
  }
  return [...PROD_ORIGINS, ...DEV_EXTRA_ORIGINS];
}

/**
 * Resolve the `Access-Control-Allow-Origin` value for a given request origin.
 *
 * Returns the origin string when it is in the allow-list; `null` otherwise.
 * Returning the exact request origin (reflection) is required for `credentials: true`
 * requests; for anonymous SDK requests it is equivalent to `*` but more explicit.
 *
 * @param requestOrigin - Value of the `Origin` request header (may be null).
 */
export function resolveAllowOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null;
  return (allowedOrigins() as string[]).includes(requestOrigin) ? requestOrigin : null;
}

/**
 * Build the CORS response headers for a regular (non-preflight) response.
 *
 * Returns a `Record<string, string>` ready to pass to `NextResponse.json(body, { headers })`.
 * When the request origin is not in the allow-list, `Access-Control-Allow-Origin` is omitted
 * (the browser will block the response as per the CORS spec).
 *
 * @param requestOrigin - Value of the `Origin` request header (may be null).
 * @param extra         - Additional headers to merge (e.g. Cache-Control).
 */
export function buildCorsHeaders(
  requestOrigin: string | null,
  extra: Record<string, string> = {},
): Record<string, string> {
  const allowOrigin = resolveAllowOrigin(requestOrigin);
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Estalara-Signature',
    ...extra,
  };
  if (allowOrigin) {
    base['Access-Control-Allow-Origin'] = allowOrigin;
  }
  return base;
}

/**
 * Build a 204 OPTIONS preflight response with the correct CORS headers.
 *
 * @param requestOrigin - Value of the `Origin` request header (may be null).
 */
export function corsPreflightResponse(requestOrigin: string | null): NextResponse {
  const headers = buildCorsHeaders(requestOrigin, {
    'Access-Control-Max-Age': '86400',
  });
  return new NextResponse(null, { status: 204, headers });
}
