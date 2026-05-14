/**
 * ReorderDirective builder helpers — canonical implementation.
 *
 * Canonical location: apps/decision-api/src/lib/reorder.ts
 *
 * The control-plane adapt POST route imports from this module.
 * Cross-app TS imports are not supported by the tsconfig path setup, so the
 * control-plane duplicates these helpers with a reference comment pointing here.
 * See apps/control-plane/src/app/api/adapt/route.ts for the duplication note.
 *
 * Design note:
 *   getTenantSchema() keeps the est_demo_tenant hardcode for backward compatibility.
 *   Real DB lookup is tracked in FOLLOW-018 (separate ticket).
 *
 * @module apps/decision-api/src/lib/reorder
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal per-tenant schema for reorder capability.
 * Mirrors the fields consumed from TenantSiteSchema.IndexSchema in packages/shared.
 * Real tenants will get this from a DB lookup (FOLLOW-018); demo tenant is hard-coded.
 */
export interface TenantSiteSchema {
  reorder_capable: boolean;
  container_selector?: string;
  item_selector?: string;
}

/**
 * ReorderDirective — instructs the SDK to reorder listing cards in the DOM.
 *
 * Mirrors packages/shared/src/directives.ts ReorderDirective exactly.
 * Duplicated here because decision-api does not depend on @estalara/shared
 * (Cloudflare Worker bundle constraint — no workspace packages at runtime).
 */
export interface ReorderDirective {
  type: 'reorder';
  /** CSS selector for the grid/list container. */
  container_selector: string;
  /** CSS selector for individual listing card elements within the container. */
  item_selector: string;
  /** Scoring algorithm used to rank cards. */
  score_function: 'archetype_affinity';
  /** Ordered list of listing IDs with their affinity scores (descending). */
  scores: {
    listing_id: string;
    score: number;
  }[];
  /** Archetype ID that produced these scores. */
  archetype: string;
  /** Confidence score 0–1 from the intent engine. */
  confidence: number;
}

// ─── DEMO schema ──────────────────────────────────────────────────────────────

const DEMO_SCHEMA: TenantSiteSchema = {
  reorder_capable: true,
  container_selector: '[data-estalara-listings-grid]',
  item_selector: '[data-estalara-listing-id]',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the tenant's site schema for reorder capability.
 *
 * Currently only the demo tenant is supported.
 * Real DB lookup is tracked in FOLLOW-018.
 *
 * Backward compat: est_demo_tenant always returns DEMO_SCHEMA.
 *
 * @param tenantId - The tenant UUID (or 'est_demo_tenant' for the demo).
 * @returns TenantSiteSchema if the tenant is reorder-capable, null otherwise.
 */
export function getTenantSchema(tenantId: string): TenantSiteSchema | null {
  if (tenantId === 'est_demo_tenant') {
    return DEMO_SCHEMA;
  }
  return null;
}

/**
 * Produce a stable 0–1 affinity score for a listing + archetype pair.
 *
 * Uses a multiplicative hash (djb2-style) so the ordering is deterministic
 * across reloads and workers. The key is `archetype:listingId` to ensure
 * different archetypes produce different orderings for the same set of listings.
 *
 * Not exported — an internal implementation detail of {@link buildReorderDirective}.
 * Test coverage is provided via buildReorderDirective integration tests.
 *
 * @param archetype  - Archetype identifier string (e.g. 'investor').
 * @param listingId  - Opaque listing ID string (max 64 chars per Zod schema).
 * @returns          A deterministic float in [0, 1).
 */
function deterministicScore(archetype: string, listingId: string): number {
  const key = `${archetype}:${listingId}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0; // unsigned 32-bit
  }
  return (hash % 10000) / 10000;
}

/**
 * Build a ReorderDirective from a tenant schema + listing IDs.
 *
 * Scores are computed deterministically via {@link deterministicScore} and
 * sorted descending (highest first).
 *
 * Returns null when the tenant schema is not reorder-capable or the
 * container_selector is missing.
 *
 * @param schema      - The tenant site schema (from {@link getTenantSchema}).
 * @param listingIds  - Array of listing ID strings to score and sort.
 * @param archetype   - The detected archetype for this session.
 * @param confidence  - Intent confidence 0–1 (passed through to the directive).
 * @returns           A ReorderDirective, or null if schema is not capable.
 */
export function buildReorderDirective(
  schema: TenantSiteSchema,
  listingIds: string[],
  archetype: string,
  confidence: number,
): ReorderDirective | null {
  if (!schema.reorder_capable || !schema.container_selector) {
    return null;
  }

  const scores = listingIds.map((id) => ({
    listing_id: id,
    score: deterministicScore(archetype, id),
  }));
  scores.sort((a, b) => b.score - a.score);

  return {
    type: 'reorder',
    container_selector: schema.container_selector,
    item_selector: schema.item_selector ?? '[data-estalara-listing-id]',
    score_function: 'archetype_affinity',
    scores,
    archetype,
    confidence,
  };
}
