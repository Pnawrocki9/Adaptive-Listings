/**
 * POST /api/adapt — DEPRECATED Cloudflare Worker adapt endpoint.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Phase 1 retirement — 410 Gone (ADR-0006 §Decision 3, FOLLOW-105 substep 1c).
 * ───────────────────────────────────────────────────────────────────────────
 *
 * ADR-0004 §1 made `apps/control-plane/src/app/api/adapt/route.ts` THE canonical
 * production adapt path (18-archetype playbook + LLM + RAG + A/B holdout). ADR-0004
 * §2 declared this Worker's 3-bucket `detectArchetype()` stub "MUST NOT be called
 * for archetype selection in production." ADR-0006 enforces that at runtime: this
 * handler now hard-fails with `410 Gone` instead of serving a 3-bucket fallback.
 *
 * Every call is logged (structured) so any residual traffic source is identifiable
 * before Phase 2 full retirement (FOLLOW-107, Sprint 14). The audit (§C.2) found
 * the Worker had NO request-level logging; this is the only signal gating the
 * FOLLOW-107 zero-traffic decision.
 *
 * The previous handler's archetype-selection logic (`detectArchetype()`, the
 * INVESTOR/FAMILY/NEUTRAL directive bases), consent gate, A/B holdout assignment,
 * `ab.assignment` emit, and ReorderDirective building have all been removed — the
 * canonical control-plane route owns the production equivalents of each. The
 * decision-api lib layer that backed them (`ab-assignment`, `ab-events`,
 * `consent-gate`, `llm-gateway`, `reorder`) is now unreachable from production and
 * is slated for removal alongside this file in FOLLOW-107.
 *
 * Edge-compatible — no Node.js APIs.
 *
 * @module apps/decision-api/src/app/api/adapt/route
 */

import type { Env } from '../../../index.js';

/**
 * Canonical adapt endpoint — the only production adapt path (ADR-0004 §1).
 * Returned in the 410 body so any caller can self-correct.
 *
 * NOTE: ADR-0006 §Decision 3 drafted this as `control-plane.estalara.com`, which
 * is STALE. The live control-plane host is `admin.estalara.com` (see
 * `packages/shared/src/domains.ts` CONTROL_PLANE_URL); the canonical route is
 * `/api/adapt`. [FOLLOW-105]
 */
const CANONICAL_ADAPT_URL = 'https://admin.estalara.com/api/adapt';

/** Deprecation date — also the `since` field of the 410 body. */
const DEPRECATED_SINCE = '2026-05-25';

/**
 * Best-effort extract of `tenant_id` from a JSON request body, for logging only.
 * Never throws — a malformed/streamed/empty body yields `null`.
 */
async function bestEffortTenantId(request: Request): Promise<string | null> {
  try {
    const cloned = request.clone();
    const raw: unknown = await cloned.json();
    if (raw !== null && typeof raw === 'object' && 'tenant_id' in raw) {
      const t = (raw as { tenant_id?: unknown }).tenant_id;
      return typeof t === 'string' ? t : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Handles POST /api/adapt — always 410 Gone (Phase 1 retirement).
 *
 * Logs each call with the fields the FOLLOW-107 retirement decision needs
 * (audit §C.2): `User-Agent` (external callers), `Referer` (browser-sourced
 * calls), a timestamp, best-effort `tenant_id`, and a stack trace (internal
 * callers — captured via `new Error().stack`).
 *
 * @param request - The incoming Request object.
 * @param _env    - Cloudflare Worker environment bindings (unused; kept for the
 *                  index.ts handler signature).
 */
export async function handleAdaptRequest(
  request: Request,
  _env: Env = {} as Env,
): Promise<Response> {
  const tenantId = await bestEffortTenantId(request);

  // Structured deprecation log — REQUIRED. This is the sole signal that gates
  // FOLLOW-107 Phase-2 retirement (audit §C.2). Do not remove without FOLLOW-107.
  // `new Error().stack` surfaces internal (same-bundle) callers; User-Agent/Referer
  // identify external/browser callers.
  console.warn(
    '[decision-api] DEPRECATED /api/adapt called (410 Gone)',
    JSON.stringify({
      event: 'worker_adapt_deprecated_call',
      timestamp: new Date().toISOString(),
      user_agent: request.headers.get('User-Agent'),
      referer: request.headers.get('Referer'),
      tenant_id: tenantId,
      canonical: CANONICAL_ADAPT_URL,
      stack: new Error('worker /api/adapt deprecated-call trace').stack ?? null,
    }),
  );

  return Response.json(
    {
      error: 'deprecated',
      canonical: CANONICAL_ADAPT_URL,
      since: DEPRECATED_SINCE,
    },
    { status: 410 },
  );
}
