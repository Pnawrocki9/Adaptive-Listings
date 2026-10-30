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
 * The description path's copy of the unit pattern lives in `lib/grounding-check.ts`
 * (the port of the deleted Modal job's `_check_unsupported_claims`, pinned by the frozen parity
 * corpus — FOLLOW-1297, ADR-0023): same patterns, same codes. The amenity vocabulary (FOLLOW-1383),
 * the number normaliser (FOLLOW-1388) and the guarantee / condition vocabulary (FOLLOW-1393) are
 * already one module each. Unifying the rest is
 * FOLLOW-1311.
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
  AMENITY_RES,
  NEGATED_AFTER_RE,
  NEGATOR_RE,
  negatedThroughList,
} from '@/lib/amenity-lexicon';
import { CONDITION_FACT_RE, GUARANTEE_RE, assertsNoWorkClaim } from '@/lib/condition-lexicon';
import { normaliseNumberGroups } from '@/lib/number-groups';

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
export type ClaimViolation = 'unsupported_amenity' | 'unsupported_guarantee' | 'unit_mismatch';

const CLAUSE_BREAK_RE = /[.;:!?\n,]/g;
const NEGATION_WINDOW = 30;

const AREA_UNIT =
  '(?:m²|m2|sq\\.?\\s?m|sqm|square\\s+met(?:re|er)s?|sq\\.?\\s?ft|sqft|square\\s+f(?:ee|oo)t)';
const AREA_NUMBER_RE = new RegExp(`(\\d[\\d.,]*)\\s*${AREA_UNIT}(?![a-z])`, 'gi');
const AREA_KEY_RE = /area|size|sqm|sq_?ft|m2|surface|plot|floor_?space|footage/i;
const DIGIT_RE = /\d[\d.,/%m²sqft-]*/g;
const NEGATIVE_FIELD_VALUES: ReadonlySet<string> = new Set([
  '',
  'no',
  'false',
  '0',
  'none',
  'n/a',
  'null',
  // The Polish "no" values of a spec field [FOLLOW-1383].
  'nie',
  'brak',
]);

/** Digits and the decimal point — the same canonicalisation `checkDirectiveFacts` uses. */
function canonNumber(token: string): string {
  return token.replace(/[^0-9.]/g, '').replace(/^\.+|\.+$/g, '');
}

/** What a value's claims are checked against: the listing's own words, prepared once. */
interface ClaimGrounding {
  /** Every positive listing field as `key: value`, newline-joined. */
  readonly text: string;
  /** Canonical numbers the listing states AS an area (an area field, or a number + area unit). */
  readonly areaNumbers: ReadonlySet<string>;
}

/**
 * Build the claim grounding from the listing context.
 *
 * A field whose value says "no" (`pool: 'false'`) is skipped so its key cannot ground the amenity
 * it denies.
 *
 * @param listingContext - The listing's own fields (`listing_description`, `listing_price`, …).
 * @returns The grounding every directive of this request is checked against.
 */
export function buildClaimGrounding(listingContext?: Record<string, string>): ClaimGrounding {
  const lines: string[] = [];
  const areaNumbers = new Set<string>();
  for (const [key, value] of Object.entries(listingContext ?? {})) {
    if (NEGATIVE_FIELD_VALUES.has(value.trim().toLowerCase())) continue;
    lines.push(`${key.replace(/_/g, ' ')}: ${value}`);
    if (AREA_KEY_RE.test(key)) {
      for (const m of normaliseNumberGroups(value).matchAll(DIGIT_RE)) {
        areaNumbers.add(canonNumber(m[0]));
      }
    }
  }
  const text = lines.join('\n');
  // "1 200 m²" is one number, as in the digit rule [FOLLOW-1388].
  for (const m of normaliseNumberGroups(text).matchAll(AREA_NUMBER_RE)) {
    areaNumbers.add(canonNumber(m[1] ?? ''));
  }
  areaNumbers.delete('');
  return { text, areaNumbers };
}

function isNegated(text: string, start: number): boolean {
  let window = text.slice(Math.max(0, start - NEGATION_WINDOW), start);
  const breaks = Array.from(window.matchAll(CLAUSE_BREAK_RE));
  const last = breaks.at(-1);
  if (last?.index !== undefined) window = window.slice(last.index + 1);
  return NEGATOR_RE.test(window);
}

/** A non-negated match; an item of a negated list is negated too [FOLLOW-1413]. */
function asserted(pattern: RegExp, text: string): boolean {
  return Array.from(text.matchAll(pattern)).some(
    (m) =>
      !isNegated(text, m.index) &&
      !negatedThroughList(text, m.index, isNegated) &&
      !NEGATED_AFTER_RE.test(text.slice(m.index + m[0].length)),
  );
}

/**
 * The first amenity / guarantee / unit claim in `value` the listing does not support.
 *
 * Deterministic and final: no judge round trip can overrule it (unlike a proper-name flag).
 *
 * @param value - A directive value as the model wrote it.
 * @param grounding - From `buildClaimGrounding` for this request's listing.
 * @returns The violation code, or `null` when every claim in `value` is supported.
 */
export function checkUnsupportedClaims(
  value: string,
  grounding: ClaimGrounding,
): ClaimViolation | null {
  // One group per amenity across en / pl / es (`lib/amenity-lexicon.ts`) [FOLLOW-1383].
  for (const { claim, grounding: grounds } of AMENITY_RES) {
    if (asserted(claim, value) && !asserted(grounds, grounding.text)) {
      return 'unsupported_amenity';
    }
  }
  if (GUARANTEE_RE.test(value) && !GUARANTEE_RE.test(grounding.text)) {
    return 'unsupported_guarantee';
  }
  // en / pl / es, one list with the description path; a negated condition fact grounds nothing
  // [FOLLOW-1393].
  if (
    assertsNoWorkClaim(value) &&
    !(assertsNoWorkClaim(grounding.text) || asserted(CONDITION_FACT_RE, grounding.text))
  ) {
    return 'unsupported_guarantee';
  }
  for (const m of normaliseNumberGroups(value).matchAll(AREA_NUMBER_RE)) {
    if (!grounding.areaNumbers.has(canonNumber(m[1] ?? ''))) return 'unit_mismatch';
  }
  return null;
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
