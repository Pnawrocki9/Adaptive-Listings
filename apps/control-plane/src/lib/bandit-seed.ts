/**
 * Bandit weights seed helper — TICKET-AB-006.
 *
 * Seeds `ab_bandit_weights` with 54 rows per new tenant:
 * 18 canonical archetypes × 3 variants (control / v1 / v2) with uniform
 * Beta(1, 1) priors.  Called on every new tenant creation to ensure the
 * Thompson sampling layer (FOLLOW-007) always has arms to sample.
 *
 * The variant list is derived from `SEED_VARIANTS` exported by
 * `bandit-query.ts` — the single source of truth for the three-arm
 * convention (Rule K.1 / FOLLOW-361).  Do NOT maintain a separate copy of
 * the variant list here.
 *
 * The canonical archetype list is `CANONICAL_ARCHETYPE_IDS`, imported from
 * `@estalara/shared` (FOLLOW-584 — supersedes the never-promoted FOLLOW-036,
 * which this module-private constant's removal fulfills). That array is the
 * single source of truth within `packages/shared` and is guarded against
 * drift from `ARCHETYPE_NAMES` (`packages/sdk/src/core/intent.ts`) by
 * `packages/shared/src/__tests__/archetype-canonical-parity.test.ts`.
 *
 * @module apps/control-plane/src/lib/bandit-seed
 */

import { createAdminClient, abBanditWeights } from '@estalara/db';
import { CANONICAL_ARCHETYPE_IDS } from '@estalara/shared';
import { SEED_VARIANTS } from './bandit-query';

/**
 * Seeds 54 `ab_bandit_weights` rows for a newly created tenant.
 *
 * 18 canonical archetypes × 3 variants (control / v1 / v2) with uniform
 * Beta(1, 1) priors (alpha=1, beta=1).  Idempotent — `ON CONFLICT DO
 * NOTHING` semantics via Drizzle's `onConflictDoNothing()`.
 *
 * The variant list is imported from `SEED_VARIANTS` in `bandit-query.ts`
 * so both code paths always stay in sync (FOLLOW-361 fix).
 *
 * Uses the admin client (service role) because this runs at tenant creation
 * time, before the tenant's JWT is issued.
 *
 * No-op when `DATABASE_URL_ADMIN` is not configured (dev/test without a
 * real DB).
 *
 * @param tenantId - The UUID of the newly created tenant.
 */
export async function seedBanditWeightsForTenant(tenantId: string): Promise<void> {
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!adminUrl) {
    // No admin DB configured — skip seeding (dev/test environment).
    return;
  }

  const db = createAdminClient();

  const rows = CANONICAL_ARCHETYPE_IDS.flatMap((archetype) =>
    SEED_VARIANTS.map((variant) => ({
      tenantId,
      archetype,
      variant,
      alpha: 1.0,
      beta: 1.0,
      paused: false,
    })),
  );

  await db.insert(abBanditWeights).values(rows).onConflictDoNothing();
}
