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
