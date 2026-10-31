/**
 * Unsupported-claim containment — FOLLOW-1305 (Codex WP01, FOLLOW-820 condition 1c).
 *
 * The digit rule in `llm-gateway.ts` (`checkDirectiveFacts`) cannot see three claim classes the
 * Codex review reproduced against the real gateway (F-02): an amenity the listing does not have
 * (pool, sea view), a guarantee the listing does not make ("nothing needs work", "guaranteed
 * income"), and a grounded number re-read under the wrong unit (the listing price written as an
 * area). This module is the deterministic, BOUNDED check for those classes: closed lexicons,
 * stated as such. The amenity vocabulary covers en / pl / es (FOLLOW-1383, `lib/amenity-lexicon.ts`,
 * shared with the description path), so "kominek" grounds "fireplace" and a Polish text is checked
 * like an English one; since FOLLOW-1393 so are the guarantee, no-work and condition-fact patterns
 * (`lib/condition-lexicon.ts`, also shared). The general
 * typed claim contract is FOLLOW-1311, and this module does not pretend to be it.
 *
 * The rules themselves live in `lib/claim-rules.ts`, shared with the description path
 * (`lib/grounding-check.ts`); this module holds `/api/adapt`'s dialect, the refusal policy and the
 * read path's legacy admission (FOLLOW-1311 slice 1).
 *
 * Grounding is the listing's OWN words only (§E.7.0, ESC-076): every positive field of the
 * listing context as `key: value`. Not the session's events (a buyer asking "is there a pool?"
 * is not evidence of a pool), not a template, not the model's self-report. Verifying that the
 * seller's claim is TRUE is not this module's job — only that the listing makes it.
 *
 * @module apps/control-plane/src/lib/claim-containment
 */

import { CLAIMS_VALIDATION_VERSION } from '@/lib/description-generator';
import {
  areaNumberPattern,
  buildGrounding,
  checkClaimClasses,
  type ClaimDialect,
  type ClaimGrounding,
  type ClaimViolation,
} from '@/lib/claim-rules';

/**
 * The version stamped on every description cache row whose text passed the description-path
 * claim check. Defined once, in `description-generator.ts` (the writer of every stamp since
 * FOLLOW-1297 / ADR-0023); re-exported here for the read path's legacy admission
 * (`isTrustedDescriptionHit`). A FIT cache hit without this exact value is legacy and is served as
 * a miss. `__tests__/claim-containment.test.ts` checks it equals the generator's definition and
 * the value recorded in the frozen parity manifest.
 */
export { CLAIMS_VALIDATION_VERSION };

/** Why a value was refused by this module. */
export type { ClaimViolation };

/**
 * `/api/adapt`'s side of what still differs between the two paths (`lib/claim-rules.ts`): ASCII
 * digits, a case-sensitive digit token, ECMAScript whitespace, and an area field that says "no"
 * states no area number.
 */
export const ADAPT_CLAIM_DIALECT: ClaimDialect = {
  digit: /\d[\d.,/%m²sqft-]*/g,
  areaNumber: areaNumberPattern('\\d', '\\s', 'gi'),
  strip: (value) => value.trim(),
  areaFromNegativeFields: false,
};

/**
 * Build the claim grounding from the listing context.
 *
 * @param listingContext - The listing's own fields (`listing_description`, `listing_price`, …).
 * @returns The grounding every directive of this request is checked against.
 */
export function buildClaimGrounding(listingContext?: Record<string, string>): ClaimGrounding {
  return buildGrounding([], listingContext ?? {}, ADAPT_CLAIM_DIALECT);
}

/**
 * The first amenity / guarantee / unit claim in `value` the listing does not support.
 *
 * @param value - A directive value as the model wrote it.
 * @param grounding - From `buildClaimGrounding` for this request's listing.
 * @returns The violation code, or `null` when every claim in `value` is supported.
 */
export function checkUnsupportedClaims(
  value: string,
  grounding: ClaimGrounding,
): ClaimViolation | null {
  return checkClaimClasses(value, grounding, ADAPT_CLAIM_DIALECT);
}

/** One slot's FINAL verdict — the unit the refusal policy acts on. */
interface SlotVerdict<V extends string = string> {
  readonly slot: string;
  readonly value: string;
  /** `null` when the slot passed every check (deterministic, and the judge where one ran). */
  readonly violation: V | null;
}

/** What `slotRefusal` decided: the slots served and the slots refused, each in directive order. */
interface SlotRefusalDecision<T> {
  readonly served: readonly T[];
  readonly refused: readonly T[];
}

/**
 * The refusal POLICY: the SLOT is the unit of refusal [FOLLOW-1312, CEO ruling 2026-10-11].
 *
 * §E.7.0 / ESC-076: "a directive is generated FROM the listing's own text, or it is not
 * generated". A slot with a violation is refused, and for THAT slot the seller's copy stands; the
 * other, grounded slots of the same batch are served. Until FOLLOW-1312 this was whole-batch
 * (since FOLLOW-457): one refused slot took every grounded slot down with it.
 *
 * The whole REQUEST stays the unit only where grounding is impossible for all of it (no listing
 * fetched, no model) — those exits never reach this function. When every slot is refused, the
 * caller refuses the request exactly as before (`fact_check_refused`).
 *
 * @param verdicts - Every slot's final verdict, in directive order.
 * @returns The served and refused partitions; `served` empty ⇒ refuse the request.
 */
export function slotRefusal<T extends SlotVerdict>(verdicts: readonly T[]): SlotRefusalDecision<T> {
  return {
    served: verdicts.filter((v) => v.violation === null),
    refused: verdicts.filter((v) => v.violation !== null),
  };
}

/**
 * Legacy admission for a description cache hit (FOLLOW-1305).
 *
 * A FIT hit is trusted only when it carries the CURRENT `CLAIMS_VALIDATION_VERSION` — proof its
 * text passed the claim check before it was written. A hit without it was produced before the
 * check existed and is served as a MISS (re-generated once under the check) rather than re-checked
 * on read: re-checking needs the listing's text, which this hot path does not have without a
 * backend fetch on every hit. A NEUTRAL marker carries no buyer-visible text and stays trusted.
 *
 * @param verdict - The hit's archetype-fit verdict (absent ⇒ FIT).
 * @param claimsValidation - The hit's stamped version, if any.
 * @returns `true` when the hit may be served.
 */
export function isTrustedDescriptionHit(
  verdict: 'FIT' | 'NEUTRAL' | undefined,
  claimsValidation: string | null | undefined,
): boolean {
  return verdict === 'NEUTRAL' || claimsValidation === CLAIMS_VALIDATION_VERSION;
}
