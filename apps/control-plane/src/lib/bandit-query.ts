/**
 * Bandit weights query helper — FOLLOW-007.
 *
 * Reads bandit arms for a `(tenant_id, archetype)` pair from `ab_bandit_weights`
 * so the live adapt path (`POST /api/adapt`) can call `thompsonSample()` to
 * select a variant per request.
 *
 * Auto-seeds three rows (`control`, `v1`, `v2`) with the uniform Beta(1, 1)
 * prior the first time a given `(tenant_id, archetype)` pair is observed.
 * Subsequent calls hit the index and return existing arms — the seed insert
 * is idempotent (`ON CONFLICT DO NOTHING`).
 *
 * The DB query uses the existing `ab_bandit_weights_tenant_archetype_idx`
 * (composite index on `(tenant_id, archetype)`) so it remains within the
 * ≤5ms p95 latency budget on Postgres / Supabase.
 *
 * @module apps/control-plane/src/lib/bandit-query
 */

import { and, eq } from 'drizzle-orm';
import { createAdminClient, abBanditWeights } from '@estalara/db';
import type { BanditArm } from '@estalara/shared';

/**
 * Seed variants for a new `(tenant_id, archetype)` pair.
 *
 * Three arms with the uniform Beta(1, 1) prior ensure Thompson sampling
 * starts unbiased — every variant has equal probability until evidence
 * (conversions / non-conversions) shifts the posterior.
 */
const SEED_VARIANTS = ['control', 'v1', 'v2'] as const;

/**
 * Returns the `BanditArm[]` for the given `(tenantId, archetype)` pair.
 *
 * Resolution order:
 *   1. Query `ab_bandit_weights` via the composite index.
 *   2. If zero rows: insert three seed rows (`control`, `v1`, `v2`) with
 *      `alpha=1, beta=1, paused=false` using `ON CONFLICT DO NOTHING`,
 *      then return the three seed arms.
 *   3. Otherwise: map the DB rows to `BanditArm[]` and return.
 *
 * Returns an empty array (never throws) when no admin DB URL is configured
 * (dev/test without a real DB). Callers should treat an empty array as
 * "bandit unavailable" and fall back to the default variant.
 *
 * @param tenantId  - Tenant UUID (or any tenant id string for demo mode).
 * @param archetype - Archetype label (e.g. `family_buyer`).
 * @returns BanditArm[] — at least 3 arms when the DB is reachable.
 */
export async function getBanditArms(tenantId: string, archetype: string): Promise<BanditArm[]> {
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!adminUrl) {
    // No admin DB configured — bandit unavailable. Caller should fall back to control.
    return [];
  }

  let db;
  try {
    db = createAdminClient();
  } catch (err) {
    console.error(
      '[bandit-query] createAdminClient failed:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }

  try {
    const rows = await db
      .select({
        variant: abBanditWeights.variant,
        alpha: abBanditWeights.alpha,
        beta: abBanditWeights.beta,
        paused: abBanditWeights.paused,
      })
      .from(abBanditWeights)
      .where(and(eq(abBanditWeights.tenantId, tenantId), eq(abBanditWeights.archetype, archetype)));

    if (rows.length > 0) {
      return rows.map((r) => ({
        variant: r.variant,
        alpha: r.alpha,
        beta: r.beta,
        paused: r.paused,
      }));
    }

    // Auto-seed on first request — three arms with Beta(1, 1) uniform prior.
    const seedRows = SEED_VARIANTS.map((variant) => ({
      tenantId,
      archetype,
      variant,
      alpha: 1.0,
      beta: 1.0,
      paused: false,
    }));

    await db.insert(abBanditWeights).values(seedRows).onConflictDoNothing();

    return seedRows.map((r) => ({
      variant: r.variant,
      alpha: r.alpha,
      beta: r.beta,
      paused: r.paused,
    }));
  } catch (err) {
    console.error('[bandit-query] DB query failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
