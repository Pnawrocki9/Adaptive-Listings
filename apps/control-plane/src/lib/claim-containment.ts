/**
 * Unsupported-claim containment — FOLLOW-1305 (Codex WP01, FOLLOW-820 condition 1c).
 *
 * The digit rule in `llm-gateway.ts` (`checkDirectiveFacts`) cannot see three claim classes the
 * Codex review reproduced against the real gateway (F-02): an amenity the listing does not have
 * (pool, sea view), a guarantee the listing does not make ("nothing needs work", "guaranteed
 * income"), and a grounded number re-read under the wrong unit (the listing price written as an
 * area). This module is the deterministic, BOUNDED check for those classes: an English lexicon,
 * stated as such. A non-English listing whose copy names an amenity in another language is not
 * caught here — the general typed claim contract is FOLLOW-1311 (built once, in TypeScript, after
 * FOLLOW-1297), and this module does not pretend to be it.
 *
 * MIRRORED in `apps/llm-gateway/src/jobs/generate_description.py` (`_check_unsupported_claims`):
 * same patterns, same codes, same corpus in both test suites. A change to one is a change to both.
 *
 * Grounding is the listing's OWN words only (§E.7.0, ESC-076): every positive field of the
 * listing context as `key: value`. Not the session's events (a buyer asking "is there a pool?"
 * is not evidence of a pool), not a template, not the model's self-report. Verifying that the
 * seller's claim is TRUE is not this module's job — only that the listing makes it.
 *
 * @module apps/control-plane/src/lib/claim-containment
 */

/**
 * The version stamped on every description cache row whose text passed this check (the Python
 * job writes it). A FIT cache hit without this exact value is legacy and is served as a miss —
 * see `isTrustedDescriptionHit`. MUST equal `CLAIMS_VALIDATION_VERSION` in
 * `generate_description.py`; `__tests__/claim-containment.test.ts` reads that line.
 */
export const CLAIMS_VALIDATION_VERSION = 'claims-v1';

/** Why a value was refused by this module. */
export type ClaimViolation = 'unsupported_amenity' | 'unsupported_guarantee' | 'unit_mismatch';

/** Amenity groups. Grounded only by a NON-NEGATED occurrence of the same group in the listing. */
const AMENITY_PATTERNS: readonly string[] = [
  '(?:swimming[- ])?pools?',
  '(?:sea|ocean|water|beach|bay)[- ]?views?|(?:sea|ocean)[- ]facing',
  'gardens?',
  'garages?',
  'balcon(?:y|ies)',
  '(?:roof[- ]?)?terraces?',
  'elevators?',
  'gyms?|fitness (?:room|centre|center)',
  'saunas?',
  'jacuzzis?|hot[- ]tubs?',
  'tennis courts?',
  'fireplaces?',
  'air[- ]condition(?:ing|ed)',
  'concierge',
  'planning (?:permission|consent)|building permits?',
];
const AMENITY_RES: readonly RegExp[] = AMENITY_PATTERNS.map(
  (p) => new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${p})(?![\\p{L}\\p{N}_-])`, 'giu'),
);

const NEGATOR_RE = /\b(?:no|not|without|lacks?|lacking|nor)\b/i;
const CLAUSE_BREAK_RE = /[.;:!?\n,]/g;
const NEGATION_WINDOW = 30;

const GUARANTEE_RE =
  /\bguarantee(?:d|s)?\b|\brisk[- ]free\b|\b(?:no|zero)[- ]risk\b|\bassured (?:income|returns?|yields?|rent)\b/i;
const NO_WORK_CLAIM_RE =
  /\b(?:no|zero) (?:work|works|renovation|repairs?|refurbishment)\b|\b(?:needs?|requires?) no (?:work|works|renovation|repairs?)\b|\bnothing (?:here )?(?:needs|requires) (?:work|doing|fixing|renovat\w*)\b|\bturn-?key\b|\bmove[- ]in[- ]ready\b|\bready to move in\b/i;
const CONDITION_FACT_RE =
  /\b(?:fully|newly|recently|completely) (?:renovated|refurbished|restored)\b|\bnew[- ]build\b|\bnewly built\b|\bturn-?key\b|\bmove[- ]in[- ]ready\b|\bready to move in\b|\bno work needed\b/i;

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
      for (const m of value.matchAll(DIGIT_RE)) areaNumbers.add(canonNumber(m[0]));
    }
  }
  const text = lines.join('\n');
  for (const m of text.matchAll(AREA_NUMBER_RE)) areaNumbers.add(canonNumber(m[1] ?? ''));
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

function asserted(pattern: RegExp, text: string): boolean {
  return Array.from(text.matchAll(pattern)).some((m) => !isNegated(text, m.index));
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
  for (const pattern of AMENITY_RES) {
    if (asserted(pattern, value) && !asserted(pattern, grounding.text)) {
      return 'unsupported_amenity';
    }
  }
  if (GUARANTEE_RE.test(value) && !GUARANTEE_RE.test(grounding.text)) {
    return 'unsupported_guarantee';
  }
  if (
    NO_WORK_CLAIM_RE.test(value) &&
    !(NO_WORK_CLAIM_RE.test(grounding.text) || CONDITION_FACT_RE.test(grounding.text))
  ) {
    return 'unsupported_guarantee';
  }
  for (const m of value.matchAll(AREA_NUMBER_RE)) {
    if (!grounding.areaNumbers.has(canonNumber(m[1] ?? ''))) return 'unit_mismatch';
  }
  return null;
}

/** One slot's deterministic verdict — the unit a per-slot policy would act on. */
interface SlotVerdict<V extends string = string> {
  readonly slot: string;
  readonly value: string;
  /** `null` when the slot passed every deterministic check. */
  readonly violation: V | null;
}

/**
 * The refusal POLICY: collapse per-slot verdicts into the batch decision.
 *
 * Today this is WHOLE-BATCH (unchanged since FOLLOW-457): the first refused slot refuses the
 * batch, and the returned verdict is the one that is logged. The checks produce per-slot verdicts
 * and only this function decides what a refusal costs, so a per-slot policy (serve the grounded
 * slots, drop the refused ones — the CEO is deciding it separately) is a change HERE, not a
 * rewrite of the checks.
 *
 * @param verdicts - Every slot's verdict, in directive order.
 * @returns The slot that refuses the batch, or `null` when the batch may be served.
 */
export function batchRefusal<T extends SlotVerdict>(verdicts: readonly T[]): T | null {
  return verdicts.find((v) => v.violation !== null) ?? null;
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
