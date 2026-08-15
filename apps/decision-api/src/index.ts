/**
 * Estalara decision API Cloudflare Worker.
 *
 * Routes:
 *   POST /api/adapt   — DEPRECATED — 410 Gone (ADR-0006 Phase 1, since 2026-05-25).
 *                       See apps/decision-api/src/app/api/adapt/route.ts.
 *   GET  /api/health  — liveness check
 *
 * ── Phase 1 retirement status (RETRO-103 HW-2 / FOLLOW-383) ────────────────
 * POST /api/adapt returns 410 Gone for all requests. The canonical production
 * adapt path is `apps/control-plane/src/app/api/adapt/route.ts` GET /api/adapt
 * (ADR-0004 §1). This Worker is retained for FOLLOW-107 Phase 2 decision (Sprint
 * 14): once residual traffic reaches zero the entire package will be removed.
 *
 * The lib layer under `src/lib/` (`consent-gate`, `ab-assignment`, `ab-events`,
 * `llm-gateway`, `reorder`) is unreachable from production in this state.
 * `consentGate.profilingOptOut` (FOLLOW-372) is specifically RESERVED — it is
 * the canonical interface definition for the opt-out contract and is kept intact
 * so that revival of decision-api as a gate requires no interface redesign.
 * The active enforcement point for `profilingOptOut` is the control-plane
 * GET /api/adapt handler (FOLLOW-372, PR #337). See ConsentGateInput JSDoc.
 * ────────────────────────────────────────────────────────────────────────────
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
  /**
   * Upstash Redis REST URL for schema caching. [TICKET-AB-011]
   * Example: 'https://us1-xxxx.upstash.io'
   * When absent, the Redis cache layer is skipped.
   */
  UPSTASH_REDIS_URL?: string;
  /**
   * Upstash Redis REST token. [TICKET-AB-011]
   * Required when UPSTASH_REDIS_URL is set.
   */
  UPSTASH_REDIS_TOKEN?: string;
  /**
   * Control-plane internal schema API URL. [TICKET-AB-011]
   * Example: 'https://admin.estalara.com/api/internal/schema'
   * GET with ?tenant_id=<id> → TenantSiteSchema | null
   */
  SCHEMA_API_URL?: string;
  /**
   * Bearer token for authenticating internal schema API calls. [TICKET-AB-011]
   */
  SCHEMA_API_TOKEN?: string;
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
