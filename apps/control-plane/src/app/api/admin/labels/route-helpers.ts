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

// ─── ClickHouse prediction query (parameterised) ──────────────────────────────

/**
 * Allowlist for the user-supplied `model_version` filter: word chars, dot,
 * space, hyphen (e.g. `rulebased-bandit-v1`, `intent v2.1`).
 *
 * FOLLOW-782: this is the FIRST of two independent layers. It is enforced at the
 * route's Zod validation boundary, so a value outside the allowlist is rejected
 * with a 400 rather than silently dropping the filter clause (which returned
 * unfiltered rows while the UI still showed the filter as active). The SECOND
 * layer is {@link buildPredictionsQuery}, which binds the value as a ClickHouse
 * `{name:Type}` param — so query structure is unaffected by the value even if
 * this pattern is widened in future.
 */
export const MODEL_VERSION_FILTER_PATTERN = /^[\w. -]+$/;

/** UUID-shaped allowlist for `adapt_decision_id` values built into the IN list. */
const DECISION_ID_PATTERN = /^[0-9a-f-]+$/i;

/**
 * A ClickHouse HTTP query: SQL text plus the values to bind as `param_<name>`
 * URL query parameters (same contract as `chTracerQuery` in
 * `@/lib/clickhouse-tracer`). No user input is ever interpolated into `sql`.
 *
 * Deliberately not exported: it is only ever named as `buildPredictionsQuery`'s
 * return type, and exporting it would add a Rule I `zero non-test importers`
 * violation for a type nothing outside this file needs to name.
 */
interface ClickHouseQuerySpec {
  /** SQL text using `{name:Type}` placeholders for every user-supplied value. */
  sql: string;
  /** Values to bind, keyed by placeholder name (sent as `param_<name>`). */
  params: Record<string, string>;
}

/**
 * Build the `adaptation_decisions` lookup for the label view.
 *
 * Structure is independent of caller-supplied values: `tenant_id` and the
 * optional `model_version` filter are bound as typed ClickHouse params, never
 * interpolated (FOLLOW-782).
 *
 * `decisionIds` are NOT user input — they are `prediction_id` values already
 * read back from Postgres through a parameterised Drizzle query. ClickHouse
 * typed params do not accept an array literal for an `IN` list, so they are
 * interpolated, but only after a UUID-shape allowlist filter (defence in depth;
 * ids failing the shape check are dropped).
 *
 * @param tenantId - Tenant fence, bound as `{tenant_id:String}`.
 * @param decisionIds - Candidate `adapt_decision_id`s from Postgres.
 * @param modelVersionFilter - Optional exact-match filter, bound as `{model_version:String}`.
 * @returns The query spec, or null when no decision id survived the shape filter.
 */
export function buildPredictionsQuery(
  tenantId: string,
  decisionIds: string[],
  modelVersionFilter?: string,
): ClickHouseQuerySpec | null {
  const safeIds = decisionIds
    .filter((id) => DECISION_ID_PATTERN.test(id))
    .map((id) => `'${id}'`)
    .join(', ');

  if (!safeIds) return null;

  const params: Record<string, string> = { tenant_id: tenantId };
  let mvCondition = '';
  if (modelVersionFilter) {
    mvCondition = 'AND model_version = {model_version:String}';
    params.model_version = modelVersionFilter;
  }

  const sql = `
    SELECT
      adapt_decision_id,
      archetype,
      toFloat64(confidence) AS confidence,
      model_version,
      formatDateTime(ts, '%Y-%m-%dT%H:%i:%SZ') AS ts
    FROM adaptation_decisions
    WHERE tenant_id = {tenant_id:String}
      AND adapt_decision_id IN (${safeIds})
      ${mvCondition}
    LIMIT 1000
  `;

  return { sql, params };
}

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
