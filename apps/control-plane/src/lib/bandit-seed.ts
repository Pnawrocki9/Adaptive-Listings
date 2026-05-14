/**
 * Bandit weights seed helper — TICKET-AB-006.
 *
 * Seeds `ab_bandit_weights` with 18 canonical archetype rows per new tenant
 * using uniform Beta(1, 1) priors. Called on every new tenant creation to
 * ensure the Thompson sampling layer (FOLLOW-007) always has arms to sample.
 *
 * The canonical archetype list mirrors `ArchetypeId` in
 * `packages/shared/src/directives.ts`. Both must be kept in sync when new
 * archetypes are added.
 *
 * @module apps/control-plane/src/lib/bandit-seed
 */

import { createAdminClient, abBanditWeights } from '@estalara/db';

/**
 * Canonical archetype identifiers for Thompson sampling bandit seeding.
 * Mirrors `ArchetypeId` in `packages/shared/src/directives.ts`.
 * Keep in sync with the shared type when adding new archetypes.
 */
export const CANONICAL_ARCHETYPES = [
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

export const CANONICAL_ARCHETYPE_COUNT = CANONICAL_ARCHETYPES.length;

/**
 * Seeds 18 `ab_bandit_weights` rows for a newly created tenant.
 *
 * One row per canonical archetype × variant='default' with uniform Beta(1, 1)
 * priors (alpha=1, beta=1). Idempotent — `ON CONFLICT DO NOTHING` semantics via
 * Drizzle's `onConflictDoNothing()`.
 *
 * Uses the admin client (service role) because this runs at tenant creation time,
 * before the tenant's JWT is issued.
 *
 * No-op when `DATABASE_URL_ADMIN` is not configured (dev/test without a real DB).
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

  const rows = CANONICAL_ARCHETYPES.map((archetype) => ({
    tenantId,
    archetype,
    variant: 'default',
    alpha: 1.0,
    beta: 1.0,
    paused: false,
  }));

  await db.insert(abBanditWeights).values(rows).onConflictDoNothing();
}
