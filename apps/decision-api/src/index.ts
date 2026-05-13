/**
 * Estalara decision API Cloudflare Worker.
 *
 * Routes:
 *   POST /api/adapt   — adaptation decision endpoint (TICKET-024)
 *   GET  /api/health  — liveness check
 *
 * Sprint 5+ will add:
 *   - Upstash Redis cache layer
 *   - Modal intent-engine fallback on cache miss
 *   - Tenant DB validation (TICKET-031)
 *
 * p95 latency targets: <80ms (cached path), <2000ms (LLM path)
 */

import { handleAdaptRequest } from './app/api/adapt/route.js';
import { handleHealthRequest } from './app/api/health/route.js';

export interface Env {
  ENVIRONMENT: string;
  /**
   * Optional API key for the adapt endpoint.
   * When set, every request's Bearer token must match this value exactly.
   * When absent (local dev / tests), presence-only auth is used.
   */
  ADAPT_API_KEY?: string;
  /**
   * Per-tenant daily LLM spend cap in USD.
   * Defaults to '1.00' when not set.
   * Example: '0.50' for $0.50/day per tenant.
   */
  LLM_DAILY_CAP_USD?: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/adapt' && request.method === 'POST') {
      return handleAdaptRequest(request, env);
    }

    if (pathname === '/api/health' && request.method === 'GET') {
      return handleHealthRequest();
    }

    return Response.json(
      { error: { code: 'not_found', message: `No route for ${request.method} ${pathname}` } },
      { status: 404 },
    );
  },
} satisfies ExportedHandler<Env>;
