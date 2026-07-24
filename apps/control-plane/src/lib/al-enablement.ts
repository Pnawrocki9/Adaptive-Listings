/**
 * Adaptive Listings per-tenant ON/OFF enforcement (FOLLOW-633).
 *
 * The SINGLE shared point the adapt path (`api/adapt/route.ts` GET + POST) uses to
 * decide whether Adaptive Listings serving is enabled for a tenant, so the two
 * handlers cannot diverge. A tenant is OFF when EITHER:
 *   - `tenants.al_enabled = false` — the explicit staff/superadmin operator switch
 *     (written by `/api/admin/tenants/al-state`), OR
 *   - `tenants.status IN ('suspended','canceled')` — a billing/lifecycle cut-off.
 * `pending` and `active` stay ON (do NOT cut off `pending` — that would risk the
 * single live tenant during onboarding).
 *
 * When OFF, callers serve a valid neutral / pass-through 200 (no adaptation, the
 * tenant's page still works) — NEVER an error that breaks the site.
 *
 * FAIL-OPEN posture (Rule K.2 nuance): this is an off-SWITCH, not a decision-grade
 * data surface — it returns no fabricated numbers. On a lookup problem we fail OPEN
 * to normal adaptation (serving the tenant's REAL adaptation is not fabricated data;
 * a forced-neutral would be the fabricated fallback and would break the ONE live
 * tenant during a transient DB blip):
 *   - "dependency NOT configured" (dev/CI, no DATABASE_URL_ADMIN) → fail open,
 *     NO Sentry — this is the allowed dev/CI mock path (Rule K.2 distinction).
 *   - "configured but THREW" → fail open AND capture to Sentry (observable), so the
 *     enforcement-check failure is never silent.
 * Both are mirrored on the sibling demo-override read in the same route file, which
 * likewise degrades to the normal path on a configured-but-failed DB read.
 *
 * Per-request cost: ONE indexed primary-key lookup on `tenants`
 * (`SELECT al_enabled, status FROM tenants WHERE id = $1 LIMIT 1`), sub-millisecond.
 * No cache is added deliberately — an off-switch must take effect promptly (a
 * suspended tenant must be cut off on the next request), and correctness of the
 * cut-off outweighs shaving a PK lookup. Revisit with a short Redis TTL only if the
 * adapt p95 budget is threatened.
 *
 * @module apps/control-plane/src/lib/al-enablement
 */

import { eq } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, tenants } from '@estalara/db';

/**
 * Reason an adapt request was served neutral, for observability / provenance.
 * Module-private: the adapt route consumes `resolveAlEnablement`'s inferred return
 * type, so this is not re-exported (Rule I — no dead cross-file exports).
 */
type AlOffReason = 'al_disabled' | 'status_suspended' | 'status_canceled';

interface AlEnablement {
  /** True when adaptation MUST be suppressed (serve neutral pass-through). */
  off: boolean;
  /** Why serving is off; `null` when on. Surfaced on the wire as `al_off_reason`. */
  reason: AlOffReason | null;
}

const ON: AlEnablement = { off: false, reason: null };

/**
 * Resolve whether Adaptive Listings serving is OFF for a tenant.
 *
 * @param tenantId - The server-derived tenant id (never a caller-supplied header).
 * @returns `{ off, reason }` — `off:false` (ON) on any lookup problem (fail-open).
 */
export async function resolveAlEnablement(tenantId: string): Promise<AlEnablement> {
  if (!tenantId || tenantId === 'unknown') return ON;

  // "Dependency not configured" (dev/CI) — fail OPEN with no Sentry noise. This is
  // the Rule K.2-sanctioned dev/CI path (distinct from configured-but-threw below).
  const dbConfigured =
    Boolean(process.env.DATABASE_URL_ADMIN) || Boolean(process.env.DATABASE_URL_DIRECT);
  if (!dbConfigured) return ON;

  try {
    const db = createAdminClient();
    const rows = await db
      .select({ alEnabled: tenants.alEnabled, status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    // Read the row DEFENSIVELY (values as `unknown`): only an EXPLICIT `al_enabled
    // === false` or an exact off-status forces OFF. A missing/garbled value fails
    // OPEN — we never cut a tenant off on a value we cannot positively classify
    // (can't be worse than the pre-FOLLOW-633 always-serve behaviour).
    const row = rows[0] as { alEnabled?: unknown; status?: unknown } | undefined;
    if (!row) return ON;

    if (row.alEnabled === false) return { off: true, reason: 'al_disabled' };
    if (row.status === 'suspended') return { off: true, reason: 'status_suspended' };
    if (row.status === 'canceled') return { off: true, reason: 'status_canceled' };

    return ON;
  } catch (err: unknown) {
    // Configured-but-threw (Rule K.2): fail LOUD to Sentry, then fail OPEN to normal
    // adaptation so a transient DB blip never breaks the live tenant's page. We serve
    // the tenant's REAL adaptation (not fabricated data), so nothing on the wire is
    // misrepresented; the enforcement-check failure itself is captured for ops.
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { area: 'adapt', kind: 'al_enablement_db_error' },
      extra: { tenant_id: tenantId },
    });
    console.error(
      '[al-enablement] tenant lookup failed — failing open to normal adaptation:',
      err instanceof Error ? err.message : err,
    );
    return ON;
  }
}
