/**
 * GET /api/admin/diagnostics/first-party-tenant — report the STATUS of the running
 * instance's `FIRST_PARTY_TENANT_ID`, never its value. [FOLLOW-973]
 *
 * ## Why this route exists
 *
 * `FIRST_PARTY_TENANT_ID` decides whether `classifyFirstPartyTenant` returns `'confirmed'`
 * or `'unverified'`, and prod runs exactly one tenant with `allowed_origins = []`, so every
 * live SDK request takes the branch that depends on it (`origin-policy.ts`). Three sessions
 * tried and failed to establish what the value actually IS in Vercel Production:
 *
 * - `vercel env pull` returns it empty — but it also returns 46 of 55 variables empty,
 *   including `NODE_ENV`, so an empty pull is a TOOL ARTEFACT and not evidence (FOLLOW-957).
 * - `vercel env ls` proves the variable EXISTS on Production (`Encrypted`, 17d ago as of
 *   2026-08-12) — which rules out `unset`, the dominant failure case, and nothing else
 *   (FOLLOW-973 / RETRO-269). "Encrypted" is a fact about the VALUE being unreadable, and was
 *   being misread as a fact about its EXISTENCE.
 * - The `first_party_tenant_id_unresolved` Sentry signal cannot answer it either: it has no
 *   channel at all (`SENTRY_DSN_CONTROL_PLANE` is unset in every Vercel environment —
 *   FOLLOW-965 / ESC-057), so its silence carries ZERO bits.
 *
 * The surviving `console.warn` is a weak instrument for the same question: it reaches only
 * Vercel runtime logs (unsubscribed, expiring), and it is emitted from a code path that
 * requires authenticated traffic carrying an `Origin` header — browser-shaped SDK traffic
 * this estate has not established reaches prod at all (`api-key-auth.ts:168-170,186`).
 * **Absence of that warning is consistent with at least four world-states**, so under Rule AR
 * it cannot close the question. This route reads the env var directly, on demand, from inside
 * the running instance — the one place the answer is not in doubt.
 *
 * ## What it reports, and why each field is safe
 *
 * | field                      | meaning                                                              |
 * | -------------------------- | -------------------------------------------------------------------- |
 * | `env_status`               | `unset` \| `malformed` \| `valid` — the shape verdict                |
 * | `resolves_to_known_tenant` | `valid` only: does a `tenants` row with that id exist?               |
 * | `tenant_status`            | that row's `status` (e.g. `active`), so a soft-deleted id is visible |
 *
 * **The value is NEVER returned, logged, or fingerprinted**, in any branch, including
 * `malformed` — `resolveFirstPartyTenantId` carries the raw text on the malformed variant and
 * this route deliberately drops it. A truncated hash was considered and rejected: it would let
 * a holder of a candidate UUID confirm a match offline, which is the leak this route exists to
 * avoid. The three fields above answer every world-state the question has without that.
 *
 * `resolves_to_known_tenant` is the field that closes the axis `vercel env ls` cannot reach:
 * a well-formed-but-WRONG UUID is `valid` on shape and `false` here.
 *
 * ## Auth
 *
 * Estalara staff ONLY, via `verifyTracerAdminAuth` — Bearer `ADMIN_API_SECRET` (constant-time
 * compare) or a verified Supabase JWT/SSR session carrying `estalara_staff: true`. A tenant's
 * own `agency:admin` is explicitly NOT sufficient: this reports platform configuration, not
 * tenant data. Read-only; no mutation, so no audit-log row and no replay concern beyond TLS.
 *
 * ## Fail-loud contract (Rule K.2)
 *
 * The env classification never throws and is reported unconditionally. The DB lookup is the
 * only fallible leg, and a configured-but-throwing DB reports `resolves_to_known_tenant: null`
 * with `tenant_lookup_error: true` — it does NOT fabricate `false`, which would read as
 * "the id is wrong" when the truth is "we could not tell". A route that answers a diagnostic
 * question with a guess is worse than one that refuses.
 *
 * @module apps/control-plane/src/app/api/admin/diagnostics/first-party-tenant/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import { resolveFirstPartyTenantId } from '@/lib/brand-identity';
import { createAdminClient, tenants } from '@estalara/db';
import { eq } from 'drizzle-orm';

/** Diagnostic report. Deliberately carries no field from which the value can be recovered. */
export interface FirstPartyTenantDiagnostic {
  /** Shape verdict from {@link resolveFirstPartyTenantId}. */
  env_status: 'unset' | 'malformed' | 'valid';
  /**
   * `true`/`false` when `env_status === 'valid'` and the lookup ran; `null` when the status is
   * not `valid` (nothing to look up) or the lookup itself failed (see `tenant_lookup_error`).
   */
  resolves_to_known_tenant: boolean | null;
  /** The matched tenant's `status` column, or `null` when there is no matched row. */
  tenant_status: string | null;
  /** `true` iff the DB was configured but the lookup threw — distinguishes "no" from "unknown". */
  tenant_lookup_error: boolean;
  /** ISO timestamp, so a pasted transcript carries its own date (the AC asks for a dated one). */
  checked_at: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyTracerAdminAuth(req);
  if (!auth.ok) {
    // `status` distinguishes 401 (no/!valid auth) from 403 (valid, but not staff) — matching
    // the sibling tracer routes, which use the same guard and the same envelope.
    return NextResponse.json(
      { error: { code: 'unauthorized', message: auth.message } },
      { status: auth.status },
    );
  }

  const resolved = resolveFirstPartyTenantId(process.env.FIRST_PARTY_TENANT_ID);

  const report: FirstPartyTenantDiagnostic = {
    env_status: resolved.status,
    resolves_to_known_tenant: null,
    tenant_status: null,
    tenant_lookup_error: false,
    checked_at: new Date().toISOString(),
  };

  // Only a well-formed UUID has anything to look up. `unset` and `malformed` are already
  // fully answered by the shape verdict.
  if (resolved.status === 'valid') {
    try {
      const db = createAdminClient();
      const rows = await db
        .select({ status: tenants.status })
        .from(tenants)
        .where(eq(tenants.id, resolved.value))
        .limit(1);

      const row = rows[0];
      report.resolves_to_known_tenant = Boolean(row);
      report.tenant_status = row?.status ?? null;
    } catch (err: unknown) {
      // Rule K.2 — fail loud. `false` here would be read as "the configured id is wrong",
      // which is a materially different (and alarming) answer from "the lookup broke".
      report.tenant_lookup_error = true;
      console.error(
        '[first-party-tenant diagnostic] tenant lookup failed:',
        err instanceof Error ? err.message : err,
      );
      // NOTE: inert in production until ESC-057 arms SENTRY_DSN_CONTROL_PLANE (FOLLOW-965).
      // The console.error above is the leg that actually reaches Vercel runtime logs today.
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { route: 'admin/diagnostics/first-party-tenant', op: 'tenant_lookup' },
      });
    }
  }

  // `no-store`: the whole point is the CURRENT instance's view of its own env.
  return NextResponse.json(report, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
