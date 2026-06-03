/**
 * upsertConversionLabel — validated upsert helper for the `conversion_labels` table.
 *
 * Implements the one-row-per-(tenant_id, prediction_id) invariant required by
 * MASTER_DESIGN §T.2 ("one row per labeled outcome"). A conflicting write UPDATES the
 * existing row only when the incoming label is more authoritative, using the precedence
 * policy defined in `@estalara/shared/schemas/conversion-label` (FOLLOW-179).
 *
 * Precedence policy (single source of truth: `conversionLabelRank` in shared):
 *   1. `label_source` dominates: `manual_admin` always outranks `system`.
 *      A human reclassification wins regardless of class — it incorporates information
 *      (agent notes, CRM reconciliation) the system cannot observe.
 *   2. Within the same source, rank by `outcome_class` using the funnel/finality order:
 *      no_response(0) < viewing_booked(1) < offer_made(2) < contract_signed(3) < lost(4) < purchased(5)
 *      `lost` outranks in-funnel classes because a closed/lost deal is a definitive terminal
 *      state. `purchased` outranks `lost` from the same source because a confirmed purchase
 *      should not be overridden by a later erroneous system `lost` signal.
 *   3. Equal rank → the newer `labeled_at` wins (the WHERE clause selects for recency).
 *
 * Confidence convention (CB-2 fix, FOLLOW-179):
 *   `system`-source labels MUST supply a non-null `confidence`. This helper defaults to 1.0
 *   for system labels (they represent observed events — hard facts). `manual_admin` labels
 *   may supply their own confidence; if omitted it also defaults to 1.0.
 *   This eliminates the NULL-vs-1.0 inconsistency identified in RETRO-029 CB-2.
 *
 * RLS context:
 *   The caller must still be using an admin-scoped client (createAdminClient) and must have
 *   set `app.current_tenant_id` for the session if RLS policies require it. The admin client
 *   bypasses RLS by design (service role key); this helper does not change that behaviour.
 *   This matches the pattern used in the feedback route today.
 *
 * @module @estalara/db/upsert-conversion-label
 */

import { sql } from 'drizzle-orm';

import {
  ConversionLabelSourceSchema,
  ConversionOutcomeClassSchema,
  conversionLabelRank,
  type ConversionLabelSource,
  type ConversionOutcomeClass,
} from '@estalara/shared';

import type { Database } from './client.js';
import { conversionLabels } from './schema/conversion_labels.js';

/**
 * Input shape for `upsertConversionLabel`.
 * All string fields are Zod-validated before the DB write.
 */
export interface UpsertConversionLabelInput {
  /** Must be a valid UUID string matching a row in `tenants`. */
  tenantId: string;
  /**
   * The stable per-decision UUID minted on `/api/adapt`
   * (`adaptation_decisions.adapt_decision_id`). Used as the upsert conflict key.
   */
  predictionId: string;
  /** Durable pseudonymous lead key (§T.6). Pass '' when unknown. */
  leadId?: string;
  /** Must be a member of `ConversionOutcomeClass` — validated via Zod parse. */
  outcomeClass: string;
  /** Raw inbound payload before mapping (retained for source fidelity). */
  outcomeRaw?: unknown;
  /** The timestamp of the observed outcome. Defaults to now(). */
  labeledAt?: Date;
  /** Must be a member of `ConversionLabelSource` — validated via Zod parse. */
  labelSource: string;
  /**
   * Labeler confidence. Defaults to 1.0 for all labels (both `system` and `manual_admin`)
   * when not supplied. System labels represent observed events (hard facts); manual_admin
   * labels represent human-verified truth — both warrant 1.0 as the default.
   * Pass a lower value explicitly when confidence is genuinely partial.
   */
  confidence?: number;
  /** Free text for manual reclassification rationale. */
  notes?: string;
}

/**
 * Upsert a `conversion_labels` row, applying the class-precedence policy on conflict.
 *
 * Validates `outcomeClass` and `labelSource` with Zod before touching the DB (fixes
 * RETRO-029 LG-3: raw strings were written without enum validation). Throws a `ZodError`
 * for invalid inputs so callers can distinguish validation failures from DB errors.
 *
 * On conflict on `(tenant_id, prediction_id)`:
 *   - Updates the row only if the incoming rank is STRICTLY GREATER than the stored rank,
 *     OR if the ranks are equal and the incoming `labeled_at` is more recent.
 *   - When the WHERE clause does not match (existing is more authoritative), the UPDATE is
 *     a no-op (Postgres `DO UPDATE … WHERE false` skips the write silently).
 *   - Always updates `updated_at` to now() so the row's last-touched timestamp is current.
 *
 * @param db    A Drizzle `Database` instance (typically the admin client).
 * @param input The label to persist.
 * @throws `ZodError` if `outcomeClass` or `labelSource` are not valid enum members.
 */
export async function upsertConversionLabel(
  db: Database,
  input: UpsertConversionLabelInput,
): Promise<void> {
  // ── Validate enum fields before touching the DB (fixes LG-3) ─────────────
  const outcomeClass: ConversionOutcomeClass = ConversionOutcomeClassSchema.parse(
    input.outcomeClass,
  );
  const labelSource: ConversionLabelSource = ConversionLabelSourceSchema.parse(input.labelSource);

  const incomingRank = conversionLabelRank({ outcomeClass, labelSource });
  const labeledAt = input.labeledAt ?? new Date();
  const confidence = input.confidence ?? 1.0;

  // ── Upsert with precedence WHERE clause ───────────────────────────────────
  //
  // The SQL approach: INSERT … ON CONFLICT DO UPDATE … WHERE <condition>.
  // The WHERE clause encodes the full precedence policy using a CASE expression that
  // maps the EXISTING row's (label_source, outcome_class) to a rank number, then
  // compares that to the incoming rank. The UPDATE fires only when:
  //   incoming_rank > existing_rank
  //   OR (incoming_rank = existing_rank AND incoming labeled_at > existing labeled_at)
  //
  // Using `sql` template from Drizzle for the CASE expression inside the WHERE clause.
  // The CASE maps stored (text, text) → integer rank at query time, mirroring
  // conversionLabelRank() in application code — both derive from the same constants
  // (MANUAL_ADMIN_OFFSET=1000, class ranks 0-5 as documented in shared).
  //
  // Rank mapping (must stay in sync with OUTCOME_CLASS_RANK + MANUAL_ADMIN_OFFSET in
  // packages/shared/src/schemas/conversion-label.ts):
  //   system / no_response      →    0
  //   system / viewing_booked   →    1
  //   system / offer_made       →    2
  //   system / contract_signed  →    3
  //   system / lost             →    4
  //   system / purchased        →    5
  //   manual_admin / no_response      → 1000
  //   manual_admin / viewing_booked   → 1001
  //   manual_admin / offer_made       → 1002
  //   manual_admin / contract_signed  → 1003
  //   manual_admin / lost             → 1004
  //   manual_admin / purchased        → 1005

  await db
    .insert(conversionLabels)
    .values({
      tenantId: input.tenantId,
      predictionId: input.predictionId,
      leadId: input.leadId ?? '',
      outcomeClass,
      outcomeRaw: input.outcomeRaw ?? null,
      labeledAt,
      labelSource,
      confidence,
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [conversionLabels.tenantId, conversionLabels.predictionId],
      set: {
        outcomeClass,
        outcomeRaw: input.outcomeRaw ?? null,
        labelSource,
        confidence,
        // Only overwrite lead_id when the caller provides a non-empty value.
        // An empty '' lead_id on the incoming write should not erase a previously
        // recorded lead_id (which would discard a join key wired at a later stage).
        leadId: sql`CASE WHEN ${input.leadId ?? ''} <> '' THEN ${input.leadId ?? ''} ELSE ${conversionLabels.leadId} END`,
        labeledAt,
        updatedAt: new Date(),
      },
      // WHERE clause: only execute the UPDATE when incoming is more authoritative.
      // Drizzle's onConflictDoUpdate accepts a `where` option for the conflict target WHERE.
      where: sql`
        CASE
          WHEN ${conversionLabels.labelSource} = 'manual_admin'
            THEN CASE
              WHEN ${conversionLabels.outcomeClass} = 'no_response'      THEN 1000
              WHEN ${conversionLabels.outcomeClass} = 'viewing_booked'   THEN 1001
              WHEN ${conversionLabels.outcomeClass} = 'offer_made'       THEN 1002
              WHEN ${conversionLabels.outcomeClass} = 'contract_signed'  THEN 1003
              WHEN ${conversionLabels.outcomeClass} = 'lost'             THEN 1004
              WHEN ${conversionLabels.outcomeClass} = 'purchased'        THEN 1005
              ELSE 1000
            END
          ELSE CASE
            WHEN ${conversionLabels.outcomeClass} = 'no_response'      THEN 0
            WHEN ${conversionLabels.outcomeClass} = 'viewing_booked'   THEN 1
            WHEN ${conversionLabels.outcomeClass} = 'offer_made'       THEN 2
            WHEN ${conversionLabels.outcomeClass} = 'contract_signed'  THEN 3
            WHEN ${conversionLabels.outcomeClass} = 'lost'             THEN 4
            WHEN ${conversionLabels.outcomeClass} = 'purchased'        THEN 5
            ELSE 0
          END
        END < ${incomingRank}
        OR (
          CASE
            WHEN ${conversionLabels.labelSource} = 'manual_admin'
              THEN CASE
                WHEN ${conversionLabels.outcomeClass} = 'no_response'      THEN 1000
                WHEN ${conversionLabels.outcomeClass} = 'viewing_booked'   THEN 1001
                WHEN ${conversionLabels.outcomeClass} = 'offer_made'       THEN 1002
                WHEN ${conversionLabels.outcomeClass} = 'contract_signed'  THEN 1003
                WHEN ${conversionLabels.outcomeClass} = 'lost'             THEN 1004
                WHEN ${conversionLabels.outcomeClass} = 'purchased'        THEN 1005
                ELSE 1000
              END
            ELSE CASE
              WHEN ${conversionLabels.outcomeClass} = 'no_response'      THEN 0
              WHEN ${conversionLabels.outcomeClass} = 'viewing_booked'   THEN 1
              WHEN ${conversionLabels.outcomeClass} = 'offer_made'       THEN 2
              WHEN ${conversionLabels.outcomeClass} = 'contract_signed'  THEN 3
              WHEN ${conversionLabels.outcomeClass} = 'lost'             THEN 4
              WHEN ${conversionLabels.outcomeClass} = 'purchased'        THEN 5
              ELSE 0
            END
          END = ${incomingRank}
          AND ${conversionLabels.labeledAt} < ${labeledAt}
        )
      `,
    });
}
