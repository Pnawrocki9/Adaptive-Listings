/**
 * Shared types for GET /api/admin/labels.
 *
 * Extracted here so Next.js 15 App Router does not reject route.ts for
 * exporting non-handler symbols. Consumed by both the route handler and
 * the dashboard page — import from here, never redeclare inline.
 *
 * @module apps/control-plane/src/app/api/admin/labels/route-helpers
 */

import type { ArchetypeId } from '@estalara/shared';

// ─── Row types ────────────────────────────────────────────────────────────────

/**
 * One row from ClickHouse `adaptation_decisions` enriched for the label view.
 * Subset of columns needed to render prediction context next to the label.
 */
export interface PredictionRow {
  /** = conversion_labels.prediction_id (cross-store join key). */
  adapt_decision_id: string;
  /** Archetype the model selected for this decision. */
  archetype: string;
  /** Model confidence in [0, 1] — may be 0 when not stored. */
  confidence: number;
  /** Model version string (e.g. "rulebased-bandit-v1"). */
  model_version: string;
  /** ISO timestamp of the original decision. */
  ts: string;
}

/**
 * One row from Postgres `conversion_labels`, returned by the list endpoint.
 */
export interface LabelRow {
  id: string;
  tenant_id: string;
  prediction_id: string;
  lead_id: string;
  outcome_class: string;
  label_source: string;
  confidence: number | null;
  notes: string | null;
  labeled_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Joined row combining prediction context from ClickHouse + label from Postgres.
 * `prediction` is null when no matching ClickHouse row was found (e.g. the
 * decision predates the adaptation_decisions backfill).
 */
export interface JoinedLabelRow {
  label: LabelRow;
  /** null when ClickHouse has no matching adapt_decision_id. */
  prediction: PredictionRow | null;
}

// ─── Response type ────────────────────────────────────────────────────────────

/**
 * Response shape for GET /api/admin/labels.
 *
 * Rule K.2 provenance: data_source distinguishes real DB reads from mock.
 * The page MUST read this field and show a visible "MOCK DATA" badge.
 */
export interface AdminLabelsResponse {
  rows: JoinedLabelRow[];
  total: number;
  page: number;
  page_size: number;
  /** 'real' when both Postgres + ClickHouse were queried; 'mock' when either is absent (dev/CI). */
  data_source: 'real' | 'mock';
  generated_at: string;
}

// ─── Mock data (dev / CI — CLICKHOUSE_URL or DATABASE_URL_ADMIN absent) ────────

const MOCK_OUTCOME_CLASSES = [
  'viewing_booked',
  'offer_made',
  'contract_signed',
  'purchased',
  'lost',
  'no_response',
] as const;

const MOCK_ARCHETYPES: readonly ArchetypeId[] = [
  'yield_hunter',
  'upsizer',
  'first_time_buyer',
  'luxury_buyer',
  'downsizer',
] as const;

/**
 * Seeded pseudo-random in [0, 1) derived from an integer seed.
 */
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

/**
 * Build deterministic mock response for dev / CI.
 * Returns `data_source: 'mock'` so the page can show a badge.
 */
export function buildMockLabelsResponse(
  tenantId: string,
  page: number,
  pageSize: number,
): AdminLabelsResponse {
  const total = 24;
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const rows: JoinedLabelRow[] = [];

  for (let i = start; i < end; i++) {
    const seed = i * 31 + tenantId.length;
    const outcomeClass =
      MOCK_OUTCOME_CLASSES[Math.floor(seededRandom(seed) * MOCK_OUTCOME_CLASSES.length)];
    const archetype = MOCK_ARCHETYPES[Math.floor(seededRandom(seed + 1) * MOCK_ARCHETYPES.length)];
    const isManual = seededRandom(seed + 2) > 0.7;
    const id = `mock-label-${String(i).padStart(3, '0')}`;
    const predId = `mock-pred-${String(i).padStart(3, '0')}`;
    const daysAgo = Math.floor(seededRandom(seed + 3) * 30);
    const labeledAt = new Date(Date.now() - daysAgo * 86400_000).toISOString();

    rows.push({
      label: {
        id,
        tenant_id: tenantId,
        prediction_id: predId,
        lead_id: '',
        outcome_class: outcomeClass ?? 'no_response',
        label_source: isManual ? 'manual_admin' : 'system',
        confidence: isManual ? 1.0 : Math.round(seededRandom(seed + 4) * 100) / 100,
        notes: isManual ? 'Manually verified against CRM record.' : null,
        labeled_at: labeledAt,
        created_at: labeledAt,
        updated_at: labeledAt,
      },
      prediction: {
        adapt_decision_id: predId,
        archetype: archetype ?? 'yield_hunter',
        confidence: Math.round(seededRandom(seed + 5) * 100) / 100,
        model_version: 'rulebased-bandit-v1',
        ts: new Date(
          Date.parse(labeledAt) - Math.floor(seededRandom(seed + 6) * 3600_000),
        ).toISOString(),
      },
    });
  }

  return {
    rows,
    total,
    page,
    page_size: pageSize,
    data_source: 'mock',
    generated_at: new Date().toISOString(),
  };
}
