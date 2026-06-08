/**
 * Conversion-label taxonomy — the single source of truth for the Conversion Label Loop
 * (MASTER_DESIGN §T.4, FOLLOW-171).
 *
 * A conversion label pairs a logged prediction (`adaptation_decisions.adapt_decision_id`)
 * with the lead's later real-world outcome, so a per-tenant classifier can be fine-tuned
 * later (TALLRec/LoRA, §D.5.7). This module defines:
 *
 *   - `ConversionOutcomeClassSchema` — the canonical outcome taxonomy enum.
 *   - `ConversionLabelSourceSchema`  — who produced the label (system vs manual admin).
 *   - `conversionLabelRank`          — the precedence function for upsert conflict resolution
 *     (FOLLOW-179): a comparable number used to decide whether an incoming write should
 *     overwrite an existing row.
 *   - `OUTCOME_CLASS_RANK`           — exported map: class → per-class rank (FOLLOW-182).
 *   - `MANUAL_ADMIN_OFFSET`          — exported offset for manual_admin labels (FOLLOW-182).
 *   - `allRankEntries`               — derives the full (12-pair) rank table from the TS map
 *     so that `@estalara/db` can build the SQL CASE at runtime without duplicating literals
 *     (Rule K.1 amendment, FOLLOW-182).
 *
 * Both the control-plane routes (which write labels) and the `@estalara/db` drizzle
 * schema (the `conversion_labels` table) import these so the taxonomy is defined once.
 *
 * @module @estalara/shared/schemas/conversion-label
 */

import { z } from 'zod';

/**
 * Canonical lead-outcome taxonomy (§T.4). Ordered shallow → deep:
 *   - `viewing_booked`   — a viewing/contact was booked (the product's primary funnel
 *     conversion: `live.signup` OR `chat.contact_initiated`). The shallowest positive class.
 *   - `offer_made`       — the lead made an offer.
 *   - `contract_signed`  — a contract was signed.
 *   - `purchased`        — the purchase completed (the deepest positive outcome).
 *   - `lost`             — the lead was explicitly lost / went elsewhere.
 *   - `no_response`      — no qualifying outcome was observed (the negative label).
 *
 * Shallow classes (`viewing_booked`, `no_response`) are mappable from anonymous in-funnel
 * signals already in ClickHouse `events`. Deep classes (`offer_made` … `lost`) live in
 * tenant CRMs and arrive only via the CRM ingest path (FOLLOW-172).
 */
export const ConversionOutcomeClassSchema = z.enum([
  'viewing_booked',
  'offer_made',
  'contract_signed',
  'purchased',
  'lost',
  'no_response',
]);

export type ConversionOutcomeClass = z.infer<typeof ConversionOutcomeClassSchema>;

/**
 * How an outcome label was produced (§T.2.b / §T.4).
 *   - `system`       — auto-mapped from a conversion signal (the feedback ping, or CRM ingest).
 *   - `manual_admin` — set or corrected by staff in admin.estalara.com. Human-verified labels
 *     can be weighted higher when building the fine-tuning corpus.
 */
export const ConversionLabelSourceSchema = z.enum(['system', 'manual_admin']);

export type ConversionLabelSource = z.infer<typeof ConversionLabelSourceSchema>;

/**
 * The set of outcome classes mappable from the coarse `converted` boolean carried by the
 * Thompson-bandit feedback ping (`POST /api/adapt/feedback`). The ping only knows whether the
 * configured conversion goal fired, so it can only produce the shallowest classes:
 *   - `converted: true`  → `viewing_booked` (a contact/viewing was booked — the product's
 *     primary funnel conversion).
 *   - `converted: false` → `no_response`.
 * Deeper classes (offer/contract/purchase/lost) are out of scope for the ping and arrive via
 * CRM ingest (FOLLOW-172).
 */
export function outcomeClassFromConverted(converted: boolean): ConversionOutcomeClass {
  return converted ? 'viewing_booked' : 'no_response';
}

// ─── Precedence ranking for upsert conflict resolution (FOLLOW-179) ───────────

/**
 * Per-class rank within the same `label_source`. Higher = more authoritative.
 *
 * Funnel/finality ordering rationale:
 *   - `no_response` = 0   — the weakest label; no outcome observed yet.
 *   - `viewing_booked` = 1 — in-funnel progress, shallowest positive.
 *   - `offer_made` = 2     — deeper funnel progress.
 *   - `contract_signed` = 3 — near-terminal progress.
 *   - `lost` = 4           — a definitive negative terminal outcome.
 *     `lost` outranks in-funnel classes (`viewing_booked`, `offer_made`, `contract_signed`)
 *     because a deal that died is final information: overwriting "offer_made" with "lost" is
 *     an accurate reflection of reality; overwriting "lost" with "offer_made" (the reverse)
 *     would re-open a closed story and corrupt the training corpus.
 *   - `purchased` = 5      — the strongest terminal positive. Never overridden by `lost` from
 *     the same source: if a purchase was recorded, a later system-generated `lost` signal is
 *     either erroneous or concerns a different decision (correlation artefact). A human admin
 *     can still override via `manual_admin`.
 *
 * Note: one reasonable alternative ordering would place `lost` below `viewing_booked`
 * (treating it as "uncertainty" rather than "finality"), but the design decision here treats
 * `lost` as the definitive negative terminal — consistent with standard CRM funnel semantics
 * where "lost deal" is an explicit, intentional state that supersedes any open-funnel state.
 * If this becomes contentious, file a follow-up ADR.
 *
 * **Exported** (FOLLOW-182, Rule K.1 amendment): `@estalara/db/upsert-conversion-label`
 * derives the SQL CASE expression at runtime by iterating this map so rank literals never
 * appear in two places. Any new outcome class added here automatically propagates to the SQL.
 */
export const OUTCOME_CLASS_RANK: Readonly<Record<ConversionOutcomeClass, number>> = {
  no_response: 0,
  viewing_booked: 1,
  offer_made: 2,
  contract_signed: 3,
  lost: 4,
  purchased: 5,
};

/**
 * Source-level offset applied to `manual_admin` labels so that ANY manual label outranks
 * ANY system label, regardless of outcome class.
 *
 * A human reclassification is always more authoritative than an auto-mapped signal: it
 * incorporates information the system cannot observe (the agent's notes, CRM reconciliation,
 * manual verification). The offset is chosen to be larger than the maximum class rank so
 * that `manual_admin` + `no_response` (offset + 0 = 1000) still beats
 * `system` + `purchased`  (0 + 5 = 5).
 *
 * **Exported** (FOLLOW-182, Rule K.1 amendment): used alongside `OUTCOME_CLASS_RANK` when
 * building the SQL CASE expression at runtime in `@estalara/db/upsert-conversion-label`.
 */
export const MANUAL_ADMIN_OFFSET = 1000;

/**
 * Returns a comparable rank number for a (outcomeClass, labelSource) pair.
 * Used by the `upsertConversionLabel` helper to decide — purely in application logic via
 * `onConflictDoUpdate` — whether an incoming write should overwrite an existing row.
 *
 * Precedence rules (single source of truth, FOLLOW-179):
 *   1. `label_source` dominates: `manual_admin` always outranks `system`.
 *   2. Within the same `label_source`, rank by `outcome_class` using the funnel/finality
 *      order defined in `OUTCOME_CLASS_RANK`.
 *   3. Equal ranks → the newer `labeled_at` wins (handled in the SQL WHERE clause).
 *
 * @example
 * // manual_admin / no_response outranks system / purchased
 * conversionLabelRank({ outcomeClass: 'no_response', labelSource: 'manual_admin' }) // 1000
 * conversionLabelRank({ outcomeClass: 'purchased',   labelSource: 'system' })       // 5
 *
 * // Within the same source, funnel depth wins
 * conversionLabelRank({ outcomeClass: 'purchased',   labelSource: 'system' })       // 5
 * conversionLabelRank({ outcomeClass: 'no_response', labelSource: 'system' })       // 0
 */
export function conversionLabelRank(args: {
  outcomeClass: ConversionOutcomeClass;
  labelSource: ConversionLabelSource;
}): number {
  const classRank = OUTCOME_CLASS_RANK[args.outcomeClass];
  const sourceOffset = args.labelSource === 'manual_admin' ? MANUAL_ADMIN_OFFSET : 0;
  return sourceOffset + classRank;
}

// ─── SQL CASE builder — FOLLOW-182 (Rule K.1 amendment) ──────────────────────

/**
 * One entry in the flat rank table produced by `allRankEntries()`.
 *
 * Consumed by `@estalara/db/upsert-conversion-label` to build the SQL CASE expression
 * for the stored row's precedence rank entirely at runtime, so the query never encodes
 * rank literals independently of the TS map (Rule K.1 amendment, FOLLOW-182).
 */
export interface RankEntry {
  outcomeClass: ConversionOutcomeClass;
  labelSource: ConversionLabelSource;
  rank: number;
}

/**
 * Returns the complete, ordered list of (outcomeClass, labelSource, rank) triples derived
 * from `OUTCOME_CLASS_RANK` and `MANUAL_ADMIN_OFFSET`.
 *
 * **This is the single source of truth for all SQL CASE fragments** that compute the stored
 * row's precedence rank for upsert conflict resolution. The consumer (`upsertConversionLabel`
 * in `@estalara/db`) iterates this list and interpolates via the Drizzle `sql` tag so rank
 * literals never appear in two places (Rule K.1 amendment, FOLLOW-182).
 *
 * If a new `ConversionOutcomeClass` is added to `OUTCOME_CLASS_RANK`, the returned list
 * automatically grows — no SQL edit is required.
 *
 * @returns Array of 12 entries (6 classes × 2 sources), ordered system-first then
 *   manual_admin, each within funnel/finality order.
 */
export function allRankEntries(): RankEntry[] {
  const sources: ConversionLabelSource[] = ['system', 'manual_admin'];
  const classes = Object.keys(OUTCOME_CLASS_RANK) as ConversionOutcomeClass[];
  const entries: RankEntry[] = [];
  for (const labelSource of sources) {
    for (const outcomeClass of classes) {
      entries.push({
        outcomeClass,
        labelSource,
        rank: conversionLabelRank({ outcomeClass, labelSource }),
      });
    }
  }
  return entries;
}
