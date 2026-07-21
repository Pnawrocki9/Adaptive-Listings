/**
 * Demo override store — reads/writes the per-tenant DEMO MODE override.
 *
 * This module is the single source of truth for the demo_overrides table
 * access pattern used by both the admin API and the adapt endpoint.
 *
 * Behaviour:
 *   - getDemoOverride: returns the current override row for a tenant, or
 *     { enabled: false, overrideArchetype: null, overrideModel: 'claude-sonnet-4-6' }
 *     when no row exists (the safe/default state).
 *   - upsertDemoOverride: creates or updates the override row atomically.
 *
 * Fail-loud contract (Rule K.2):
 *   - getDemoOverride: throws when DB is configured but throws, so the adapt
 *     route can decide whether to degrade safely.
 *   - upsertDemoOverride: throws on DB failure — admin PUT must not silently
 *     swallow writes.
 *
 * Shared write helper (FOLLOW-609): `upsertDemoOverride` accepts an optional
 * `tx` (a Drizzle transaction handle) as its 4th argument. The AGENCY path
 * (`api/demo/override/route.ts` PUT, un-audited) calls it with no `tx`, opening
 * its own `createAdminClient()` exactly as before. The STAFF path calls it WITH
 * the route's own `db.transaction(async (tx) => { ... })` handle, so the same
 * single write implementation participates in the same transaction as the
 * `staff_audit_log` insert (ADR-0018 §3a) — eliminating the byte-duplicated
 * inline upsert RETRO-193 flagged (FOLLOW-596 had inlined it only so the
 * FOLLOW-607 atomicity guard would still recognise the mutation; FOLLOW-608
 * made the guard scope-aware and FOLLOW-609 extended its mutation detection to
 * recognise a call to this delegated helper, so the guard now engages on the
 * delegated form too — see scripts/check-staff-write-atomicity.cjs).
 *
 * @module apps/control-plane/src/lib/demo-override-store
 */

import { createAdminClient, demoOverrides } from '@estalara/db';
import type { Database, DemoOverrideRow } from '@estalara/db';
import { eq } from 'drizzle-orm';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DemoOverride {
  enabled: boolean;
  overrideArchetype: string | null;
  overrideModel: string;
}

// ─── Allow-lists (single source of truth) ────────────────────────────────────

/** The 13 reachable archetypes (Master Design §D.6). */
export const REACHABLE_ARCHETYPES = [
  'yield_hunter',
  'vacation_rental_investor',
  'flip_investor',
  'portfolio_builder',
  'family_buyer',
  'first_time_buyer',
  'upsizer',
  'downsizer',
  'luxury_buyer',
  'remote_worker',
  'lifestyle_expat',
  'second_home_buyer',
  'neutral',
] as const;

export type ReachableArchetype = (typeof REACHABLE_ARCHETYPES)[number];

/**
 * Curated LLM model allow-list (DEMO-001).
 * Mirrors scripts/dev/mock-decision-server.mjs MODELS.
 */
export const DEMO_ALLOWED_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
] as const;

export type DemoAllowedModel = (typeof DEMO_ALLOWED_MODELS)[number];

/** Default model for demo override (must be in DEMO_ALLOWED_MODELS). */
export const DEMO_DEFAULT_MODEL: DemoAllowedModel = 'claude-sonnet-4-6';

/**
 * Confidence value injected when DEMO MODE is active.
 * Must exceed CONFIDENCE_THRESHOLD (0.6) AND the playbook/LLM branch thresholds
 * so the full adaptation path runs. We use 0.95 to land in the "high confidence,
 * medium similarity" range when similarity is also forced to 0.75 — this triggers
 * the LLM tweak branch (Branch 3) of the decision tree, which generates copy
 * with the chosen model.
 *
 * The similarity is set to 0.75 (between LOW_SIMILARITY_THRESHOLD=0.6 and
 * HIGH_SIMILARITY_THRESHOLD=0.85) so Branch 3 (LLM tweak, uses chosen model)
 * is exercised. If you want Branch 4 (full LLM gen), set similarity to 0.5.
 * We prefer Branch 3 for demos because it is faster (Haiku-class latency unless
 * overridden to Sonnet/Opus).
 */
export const DEMO_OVERRIDE_CONFIDENCE = 0.95;
export const DEMO_OVERRIDE_SIMILARITY = 0.75;

// ─── Default value ────────────────────────────────────────────────────────────

const DEFAULT_OVERRIDE: DemoOverride = {
  enabled: false,
  overrideArchetype: null,
  overrideModel: DEMO_DEFAULT_MODEL,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read the current demo override for a tenant.
 *
 * Returns DEFAULT_OVERRIDE (enabled=false) when no row exists — the safe state
 * means no visitor is affected.
 *
 * THROWS when the DB is configured but the query fails (Rule K.2: fail-loud on
 * configured-but-threw dependency). The adapt route handles this by returning a
 * degraded 200 with explicit provenance.
 *
 * @param tenantId - Tenant UUID.
 */
export async function getDemoOverride(tenantId: string): Promise<DemoOverride> {
  const db = createAdminClient();
  const rows = await db
    .select({
      enabled: demoOverrides.enabled,
      overrideArchetype: demoOverrides.overrideArchetype,
      overrideModel: demoOverrides.overrideModel,
    })
    .from(demoOverrides)
    .where(eq(demoOverrides.tenantId, tenantId))
    .limit(1);

  const row = rows[0];
  if (!row) return { ...DEFAULT_OVERRIDE };

  return {
    enabled: row.enabled,
    overrideArchetype: row.overrideArchetype ?? null,
    overrideModel: row.overrideModel,
  };
}

/**
 * Create or update the demo override for a tenant.
 *
 * Upserts by tenant_id (ON CONFLICT DO UPDATE). Sets updated_at = now().
 *
 * THROWS on DB failure — callers must not silently swallow write failures.
 *
 * @param tenantId - Tenant UUID.
 * @param patch    - Fields to set (all required for a PUT semantics endpoint).
 * @param updatedBy - User UUID who made the change (for audit).
 * @param tx - Optional Drizzle transaction handle (FOLLOW-609). When supplied,
 *   the upsert runs on this handle instead of opening a new
 *   `createAdminClient()` — pass the route's own `db.transaction(async (tx) =>
 *   ...)` callback argument so this write commits/rolls back atomically with
 *   whatever else the caller does inside that same transaction (e.g. a
 *   `staff_audit_log` insert, ADR-0018 §3a). Omit it for a standalone write
 *   (the agency path).
 * @returns The full updated row.
 */
export async function upsertDemoOverride(
  tenantId: string,
  patch: {
    enabled: boolean;
    overrideArchetype: string | null;
    overrideModel: string;
  },
  updatedBy: string | null,
  tx?: Database,
): Promise<DemoOverrideRow> {
  const db = tx ?? createAdminClient();

  const rows = await db
    .insert(demoOverrides)
    .values({
      tenantId,
      enabled: patch.enabled,
      overrideArchetype: patch.overrideArchetype ?? null,
      overrideModel: patch.overrideModel,
      updatedBy: updatedBy ?? undefined,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: demoOverrides.tenantId,
      set: {
        enabled: patch.enabled,
        overrideArchetype: patch.overrideArchetype ?? null,
        overrideModel: patch.overrideModel,
        updatedBy: updatedBy ?? undefined,
        updatedAt: new Date(),
      },
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error('[demo-override-store] upsert returned no rows');
  }
  return row;
}
