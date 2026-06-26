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
 * The canonical archetype list mirrors `ArchetypeId` in
 * `packages/shared/src/directives.ts`. Both must be kept in sync when new
 * archetypes are added.
 *
 * @module apps/control-plane/src/lib/bandit-seed
 */

import { createAdminClient, abBanditWeights } from '@estalara/db';
import { SEED_VARIANTS } from './bandit-query.js';

/**
 * Canonical archetype identifiers for Thompson sampling bandit seeding.
 * Mirrors `ArchetypeId` in `packages/shared/src/directives.ts`.
 * Keep in sync with the shared type when adding new archetypes.
 *
 * FOLLOW-036 will move this to packages/shared/src/archetypes.ts as the single
 * source of truth. Until then, kept as a module-private constant.
 */
const CANONICAL_ARCHETYPES = [
  'yield_hunter',
  'vacation_rental_investor',
  'flip_investor',
  'portfolio_builder',
  'golden_visa_buyer',
  'commercial_investor',
  'family_buyer',
  'first_time_buyer',
  'upsizer',
  'downsizer',
  'luxury_buyer',
  'remote_worker',
  'lifestyle_expat',
  'retiree_relocator',
  'diaspora_buyer',
  'second_home_buyer',
  'student_parent',
  'neutral',
] as const;

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

  const rows = CANONICAL_ARCHETYPES.flatMap((archetype) =>
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
