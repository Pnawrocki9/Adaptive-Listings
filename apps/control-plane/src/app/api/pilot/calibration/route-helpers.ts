/**
 * Shared types and assembly helpers for GET /api/pilot/calibration.
 *
 * Extracted from route.ts so that Next.js 15 App Router does not reject the
 * route segment for exporting non-handler functions (build error: "Route does
 * not match the required types of a Next.js Route").
 *
 * The calibration view answers: "Does a higher predicted confidence score
 * actually correspond to a higher real conversion rate?" This is the metric
 * that proves whether a fine-tuned `lora-tenant-*` model beats
 * `rulebased-bandit-v1` (MASTER_DESIGN §T.3).
 *
 * Export path (FOLLOW-221): `?format=json` returns a JSON array of
 * CalibrationExportRow objects — one per (outcome_class, model_version)
 * combination — with a Content-Disposition attachment header so it can be
 * downloaded directly and fed into FOLLOW-175 / §D.5.7 LoRA fine-tuning corpus.
 *
 * @module apps/control-plane/src/app/api/pilot/calibration/route-helpers
 */

import { z } from 'zod';

// ─── ClickHouse row shapes ────────────────────────────────────────────────────

/**
 * One row returned by the ClickHouse decisions query.
 * `adapt_decision_id` is the cross-store join key to Postgres `conversion_labels`.
 */
export interface ChDecisionRow {
  adapt_decision_id: string;
  /** Scorer confidence in [0, 1]. */
  confidence: number;
  model_version: string;
}

// ─── Postgres row shapes ──────────────────────────────────────────────────────

/**
 * One row returned from Postgres `conversion_labels` for the given tenant + window.
 * `prediction_id` = `adaptation_decisions.adapt_decision_id` (cross-store join key).
 */
export interface PgLabelRow {
  prediction_id: string;
  outcome_class: string;
}

// ─── Response types ───────────────────────────────────────────────────────────

/**
 * One row in the score-vs-actual reliability curve.
 *
 * `predicted_rate` is the mean model confidence in the decile bucket.
 * `actual_conversion_rate` is the fraction of labeled decisions in the bucket
 * that have a positive outcome (`viewing_booked`, `offer_made`,
 * `contract_signed`, `purchased`).
 *
 * A perfectly calibrated model has `predicted_rate ≈ actual_conversion_rate`
 * across all deciles (diagonal on the reliability diagram).
 */
export interface CalibrationRow {
  /** Lower bound of the confidence decile, e.g. 0.0 for [0.0, 0.1). */
  confidence_decile: number;
  /** Mean model confidence within this decile bucket. */
  predicted_rate: number;
  /**
   * Fraction of labeled decisions in this bucket with a positive outcome class.
   * Positive classes: 'viewing_booked', 'offer_made', 'contract_signed', 'purchased'.
   * Negative classes: 'no_response', 'lost'.
   * 0 when sample_size is 0 (no labels joined for this bucket).
   */
  actual_conversion_rate: number;
  /** Number of decisions in this bucket that have a conversion label. */
  sample_size: number;
  /** Model version this row belongs to. */
  model_version: string;
}

/**
 * Aggregate conversion counts per (outcome_class, model_version) for the
 * tenant + window. Satisfies AC1: conversion rate per outcome_class per tenant
 * per period.
 */
export interface ConversionAggRow {
  outcome_class: string;
  model_version: string;
  /** Count of labeled decisions with this (outcome_class, model_version). */
  count: number;
  /**
   * Fraction of all labeled decisions for this model_version that have this
   * outcome_class. null when total_for_model is 0.
   */
  rate: number | null;
}

export interface CalibrationResponse {
  window_days: number;
  tenant_id: string;
  /**
   * Reliability curve rows, grouped by model_version + confidence_decile.
   * Satisfies AC2: score-vs-actual calibration per model_version.
   */
  calibration: CalibrationRow[];
  /**
   * Conversion rate per outcome_class per model_version.
   * Satisfies AC1: aggregate conversion rate per outcome_class.
   */
  conversion_aggregates: ConversionAggRow[];
  generated_at: string;
  /**
   * Provenance field (Rule K.2). 'clickhouse' when data came from a configured
   * ClickHouse + Postgres query; 'mock' when CLICKHOUSE_URL is not set (dev / CI).
   * Never silently falls back to mock when CLICKHOUSE_URL is configured.
   */
  data_source: 'clickhouse' | 'mock';
}

// ─── JSON export schema (FOLLOW-221, FOLLOW-237) ─────────────────────────────

/**
 * Zod schema for one row of the structured JSON export returned by
 * `GET /api/pilot/calibration?format=json`.
 *
 * Shape documented in HANDOFFS.md "FOLLOW-221 → FOLLOW-175".
 *
 * Fields:
 *   outcome_class                — e.g. 'offer_made', 'no_response'
 *   model_version                — e.g. 'rulebased-bandit-v1'
 *   tenant                       — tenant_id from the JWT claim
 *   window                       — window_days as a number (7 | 14 | 30)
 *   count                        — labeled decisions with this (outcome_class, model_version)
 *   mean_model_predicted_rate    — mean of `predicted_rate` across all reliability-curve buckets
 *                                  for this model_version; a proxy for the typical confidence
 *                                  level the model emitted in this window. Derived per
 *                                  model_version (NOT per outcome_class — the name
 *                                  `avg_confidence` that appeared before FOLLOW-237 was
 *                                  misleading). null when no calibration rows exist for the
 *                                  model version.
 *                                  NOTE: values ride on raw model confidence which may include
 *                                  dwell-time inflation (FOLLOW-230 OPEN; dwell cap not yet
 *                                  applied as of commit b62faae). Cross-compare with
 *                                  FOLLOW-230 when using this field for corpus quality checks.
 *   data_source                  — provenance flag (Rule K.2): 'clickhouse' when built from
 *                                  real ClickHouse + Postgres data; 'mock' when CLICKHOUSE_URL
 *                                  is not set (dev / CI). MUST be checked before ingesting the
 *                                  file into a training corpus — mock fixtures must not
 *                                  contaminate a LoRA training corpus.
 */
export const CalibrationExportRowSchema = z.object({
  outcome_class: z.string(),
  model_version: z.string(),
  tenant: z.string(),
  window: z.number().int().positive(),
  count: z.number().int().nonnegative(),
  /**
   * Per-model_version mean predicted_rate across all reliability-curve buckets.
   * NOT per-outcome_class — this is a model-level confidence proxy.
   * Renamed from `avg_confidence` in FOLLOW-237 to prevent misinterpretation.
   * Rides on raw model confidence pending FOLLOW-230 dwell cap (commit b62faae).
   */
  mean_model_predicted_rate: z.number().nullable(),
  /**
   * Rule K.2 provenance. 'clickhouse' = real data; 'mock' = CLICKHOUSE_URL unset (dev/CI).
   * A consumer MUST read this field and reject mock-flagged files before corpus ingestion.
   */
  data_source: z.enum(['clickhouse', 'mock']),
});

/** TypeScript type inferred from CalibrationExportRowSchema. */
export type CalibrationExportRow = z.infer<typeof CalibrationExportRowSchema>;

/**
 * Build the structured export rows from pre-assembled response data.
 *
 * Produces one CalibrationExportRow per (outcome_class, model_version) entry in
 * `conversion_aggregates`, enriched with the tenant + window context, the
 * mean predicted_rate per model_version derived from the reliability curve, and
 * the `data_source` provenance flag (Rule K.2 — FOLLOW-237).
 *
 * `mean_model_predicted_rate` is the mean of `predicted_rate` across all
 * reliability-curve buckets for the same model_version — a proxy for the typical
 * confidence level the model emitted in this window. null when the model has no
 * calibration rows. NOTE: rides on raw confidence pending FOLLOW-230 dwell cap.
 *
 * All rows are validated against CalibrationExportRowSchema before return.
 * A parse error here indicates a bug in the aggregation logic, not a user error;
 * the caller propagates it as HTTP 500.
 *
 * @param dataSource — 'clickhouse' or 'mock'; propagated into every row (Rule K.2).
 */
export function buildCalibrationExportRows(
  tenantId: string,
  windowDays: number,
  calibration: CalibrationRow[],
  conversion_aggregates: ConversionAggRow[],
  dataSource: 'clickhouse' | 'mock',
): CalibrationExportRow[] {
  // Compute mean predicted_rate per model_version from the reliability curve.
  const modelPredictedRateSum = new Map<string, number>();
  const modelPredictedRateCount = new Map<string, number>();
  for (const row of calibration) {
    const mv = row.model_version;
    modelPredictedRateSum.set(mv, (modelPredictedRateSum.get(mv) ?? 0) + row.predicted_rate);
    modelPredictedRateCount.set(mv, (modelPredictedRateCount.get(mv) ?? 0) + 1);
  }

  const rows = conversion_aggregates.map((agg): CalibrationExportRow => {
    const mv = agg.model_version;
    const rateSum = modelPredictedRateSum.get(mv);
    const rateCount = modelPredictedRateCount.get(mv) ?? 0;
    const mean_model_predicted_rate =
      rateCount > 0 && rateSum !== undefined
        ? Math.round((rateSum / rateCount) * 10000) / 10000
        : null;

    return CalibrationExportRowSchema.parse({
      outcome_class: agg.outcome_class,
      model_version: mv,
      tenant: tenantId,
      window: windowDays,
      count: agg.count,
      mean_model_predicted_rate,
      data_source: dataSource,
    });
  });

  return rows;
}

// ─── Outcome taxonomy helpers ─────────────────────────────────────────────────

/**
 * Outcome classes treated as "converted" when computing actual_conversion_rate.
 * Aligns with ConversionOutcomeClass in @estalara/shared (§T.4 taxonomy).
 * Negative classes ('no_response', 'lost') are excluded.
 */
const POSITIVE_OUTCOME_CLASSES = new Set([
  'viewing_booked',
  'offer_made',
  'contract_signed',
  'purchased',
]);

/** Returns true when the outcome class represents a positive conversion. */
export function isPositiveOutcome(outcomeClass: string): boolean {
  return POSITIVE_OUTCOME_CLASSES.has(outcomeClass);
}

// ─── Decile bucketing ─────────────────────────────────────────────────────────

/**
 * Map a confidence value in [0, 1] to its decile lower bound.
 *
 * Decile buckets: [0.0, 0.1), [0.1, 0.2), ..., [0.9, 1.0].
 * confidence = 1.0 -> bucket 0.9 (inclusive upper bound for perfect scores).
 *
 * @example
 * confidenceDecile(0.0)  -> 0.0
 * confidenceDecile(0.05) -> 0.0
 * confidenceDecile(0.15) -> 0.1
 * confidenceDecile(1.0)  -> 0.9
 */
export function confidenceDecile(confidence: number): number {
  const clamped = Math.max(0, Math.min(1, confidence));
  // confidence = 1.0 -> floor(1.0 * 10) = 10 -> capped to 9
  const bucket = Math.min(9, Math.floor(clamped * 10));
  return Math.round(bucket) / 10;
}

// ─── Join + aggregation (in TypeScript) ──────────────────────────────────────

/**
 * Build the calibration reliability curve and conversion aggregates from
 * ClickHouse decision rows and Postgres label rows.
 *
 * Sync approach: query-time join (MVP — fine for pilot scale <10k decisions/tenant).
 * FOLLOW-175 will migrate to ClickHouse-materialized path for scale.
 *
 * Algorithm:
 * 1. Build a label map: prediction_id -> PgLabelRow.
 * 2. For each decision, look up its label. If found, assign to the (model_version,
 *    confidence_decile) bucket.
 * 3. Aggregate each bucket -> CalibrationRow.
 * 4. Build ConversionAggRow for every (outcome_class, model_version) pair
 *    among labeled decisions.
 */
export function buildCalibrationFromRaw(
  decisions: ChDecisionRow[],
  labels: PgLabelRow[],
): { calibration: CalibrationRow[]; conversion_aggregates: ConversionAggRow[] } {
  // Step 1: label lookup map.
  const labelMap = new Map<string, PgLabelRow>();
  for (const label of labels) {
    labelMap.set(label.prediction_id, label);
  }

  // Step 2: bucket accumulator.
  // Key: `${model_version}::${decile}` -> bucket stats.
  interface Bucket {
    model_version: string;
    decile: number;
    confidenceSum: number;
    positiveCount: number;
    sampleSize: number;
  }
  const buckets = new Map<string, Bucket>();

  // Step 2b: conversion-aggregate accumulator.
  // Key: `${model_version}::${outcome_class}` -> count.
  const aggMap = new Map<string, { model_version: string; outcome_class: string; count: number }>();
  // Total labeled per model_version for rate computation.
  const modelTotals = new Map<string, number>();

  for (const decision of decisions) {
    const label = labelMap.get(decision.adapt_decision_id);
    if (!label) continue; // only labeled decisions contribute to calibration

    const decile = confidenceDecile(decision.confidence);
    const mv = decision.model_version || 'unknown';
    const bucketKey = `${mv}::${String(decile)}`;

    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = { model_version: mv, decile, confidenceSum: 0, positiveCount: 0, sampleSize: 0 };
      buckets.set(bucketKey, bucket);
    }
    bucket.confidenceSum += decision.confidence;
    bucket.sampleSize += 1;
    if (isPositiveOutcome(label.outcome_class)) {
      bucket.positiveCount += 1;
    }

    // Conversion aggregate
    const aggKey = `${mv}::${label.outcome_class}`;
    const agg = aggMap.get(aggKey);
    if (agg) {
      agg.count += 1;
    } else {
      aggMap.set(aggKey, { model_version: mv, outcome_class: label.outcome_class, count: 1 });
    }
    modelTotals.set(mv, (modelTotals.get(mv) ?? 0) + 1);
  }

  // Step 3: build CalibrationRow[]
  const calibration: CalibrationRow[] = Array.from(buckets.values())
    .map(
      (b): CalibrationRow => ({
        confidence_decile: b.decile,
        predicted_rate:
          b.sampleSize > 0 ? Math.round((b.confidenceSum / b.sampleSize) * 10000) / 10000 : 0,
        actual_conversion_rate:
          b.sampleSize > 0 ? Math.round((b.positiveCount / b.sampleSize) * 10000) / 10000 : 0,
        sample_size: b.sampleSize,
        model_version: b.model_version,
      }),
    )
    .sort((a, b) => {
      // Sort by model_version asc, then decile asc
      if (a.model_version !== b.model_version) {
        return a.model_version < b.model_version ? -1 : 1;
      }
      return a.confidence_decile - b.confidence_decile;
    });

  // Step 4: build ConversionAggRow[]
  const conversion_aggregates: ConversionAggRow[] = Array.from(aggMap.values())
    .map((a): ConversionAggRow => {
      const total = modelTotals.get(a.model_version) ?? 0;
      return {
        outcome_class: a.outcome_class,
        model_version: a.model_version,
        count: a.count,
        rate: total > 0 ? Math.round((a.count / total) * 10000) / 10000 : null,
      };
    })
    .sort((a, b) => {
      if (a.model_version !== b.model_version) {
        return a.model_version < b.model_version ? -1 : 1;
      }
      return a.outcome_class < b.outcome_class ? -1 : 1;
    });

  return { calibration, conversion_aggregates };
}

// ─── Mock data (dev / CI fallback) ────────────────────────────────────────────

/** Deterministic integer hash of a string. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + (s.charCodeAt(i) | 0)) | 0;
  }
  return Math.abs(h);
}

/** Seeded pseudo-random in [0, 1). */
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

const MOCK_MODELS = ['rulebased-bandit-v1'] as const;
const MOCK_OUTCOME_CLASSES = ['viewing_booked', 'offer_made', 'no_response', 'lost'] as const;

/**
 * Build deterministic mock calibration data for dev / CI when ClickHouse is not
 * configured. Produces a realistic near-diagonal reliability curve.
 */
export function buildMockCalibrationResponse(
  tenantId: string,
  windowDays: number,
): CalibrationResponse {
  const seed = hash(tenantId) + windowDays;

  const calibration: CalibrationRow[] = [];
  const conversion_aggregates: ConversionAggRow[] = [];

  for (const mv of MOCK_MODELS) {
    // 10 decile buckets
    for (let d = 0; d < 10; d++) {
      const decile = d / 10;
      const s = seed + d * 31;
      const sampleSize = 10 + Math.floor(seededRandom(s) * 90);
      // Predicted rate is the midpoint of the decile + small noise
      const predictedRate =
        Math.round((decile + 0.05 + seededRandom(s + 1) * 0.02) * 10000) / 10000;
      // Actual rate is close to predicted (near-diagonal) with some noise
      const actualRate = Math.max(
        0,
        Math.min(1, Math.round((predictedRate + seededRandom(s + 2) * 0.1 - 0.05) * 10000) / 10000),
      );
      calibration.push({
        confidence_decile: decile,
        predicted_rate: predictedRate,
        actual_conversion_rate: actualRate,
        sample_size: sampleSize,
        model_version: mv,
      });
    }

    // Aggregates per outcome class
    const total = 200 + Math.floor(seededRandom(seed + 99) * 300);
    let remaining = total;
    MOCK_OUTCOME_CLASSES.forEach((oc, i) => {
      const count =
        i < MOCK_OUTCOME_CLASSES.length - 1
          ? Math.floor(seededRandom(seed + i * 17) * remaining * 0.4)
          : remaining;
      remaining -= count;
      conversion_aggregates.push({
        outcome_class: oc,
        model_version: mv,
        count,
        rate: total > 0 ? Math.round((count / total) * 10000) / 10000 : null,
      });
    });
  }

  return {
    window_days: windowDays,
    tenant_id: tenantId,
    calibration,
    conversion_aggregates,
    generated_at: new Date().toISOString(),
    data_source: 'mock',
  };
}
