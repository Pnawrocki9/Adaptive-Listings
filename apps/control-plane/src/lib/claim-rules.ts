/**
 * The one implementation of the claim rules both paths run — FOLLOW-1311 slice 1.
 *
 * `/api/adapt` (`llm-gateway.ts`, `claim-containment.ts`) and the description path
 * (`grounding-check.ts`) used to carry this logic twice. They now share it here, and what still
 * differs between them is stated in one place: a {@link ClaimDialect}. Each path owns its dialect,
 * so a difference can only be read off that object, and removing one is a measured change of its
 * own (a verdict may move). This slice moves no verdict.
 *
 * Names are not here: the three name policies (adapt judges, the headline refuses, the body has no
 * rule) stay with their paths, sharing only {@link STOP_CAPS} and {@link stemLoose}.
 *
 * Pure, no I/O.
 *
 * @module apps/control-plane/src/lib/claim-rules
 */

import { stripGroundedDecades } from '@/lib/decade-expressions';
import { AMENITY_RES, asserted } from '@/lib/amenity-lexicon';
import { CONDITION_FACT_RE, assertsGuarantee, assertsNoWorkClaim } from '@/lib/condition-lexicon';
import {
  normaliseNumberGroups,
  stripGroundedMultipliedNumbers,
  withMultipliedNumbers,
} from '@/lib/number-groups';

export type NumberViolation = 'hallucinated_number';
export type ClaimViolation = 'unsupported_amenity' | 'unsupported_guarantee' | 'unit_mismatch';

/** What still differs between the two paths. Every field is a real difference, pinned by tests. */
export interface ClaimDialect {
  /** A digit token. Global. */
  readonly digit: RegExp;
  /** A number followed by an area unit, from {@link areaNumberPattern}. Global. */
  readonly areaNumber: RegExp;
  /** How a field's value is trimmed before it is compared with the "no" values. */
  readonly strip: (value: string) => string;
  /** Does an area field whose value says "no" ("0") still state an area number? */
  readonly areaFromNegativeFields: boolean;
}

/**
 * `(digits)` + optional space + an area unit, in a dialect's digit class and whitespace class.
 *
 * @param digit - A regex class for one digit.
 * @param space - A regex class for one whitespace character.
 * @param flags - The regex flags; `g` is required.
 * @returns The pattern; group 1 is the number.
 */
export function areaNumberPattern(digit: string, space: string, flags: string): RegExp {
  const unit =
    `(?:m²|m2|sq\\.?${space}?m|sqm|square${space}+met(?:re|er)s?|sq\\.?${space}?ft|sqft|` +
    `square${space}+f(?:ee|oo)t)`;
  return new RegExp(`(${digit}[${digit}.,]*)${space}*${unit}(?![a-z])`, flags);
}

const AREA_KEY_RE = /area|size|sqm|sq_?ft|m2|surface|plot|floor_?space|footage/i;

/** A field with one of these values says "no", so its key cannot ground what it denies. */
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

/** What a digit token asserts: its digits and decimal point, outer dots stripped. */
export function canonNumber(token: string): string {
  return token.replace(/[^0-9.]/gu, '').replace(/^\.+|\.+$/gu, '');
}

const STEM_SUFFIXES = ['ing', 'ed', 'es', 's', 'e'] as const;

/** Lowercase, then strip ONE English suffix when the word is long enough (in code points). */
export function stemLoose(word: string): string {
  const w = word.toLowerCase();
  const length = Array.from(w).length;
  for (const suffix of STEM_SUFFIXES) {
    if (length > suffix.length + 2 && w.endsWith(suffix)) return w.slice(0, -suffix.length);
  }
  return w;
}

/** Capitalised words that are not proper names, on every path. */
export const STOP_CAPS: readonly string[] = [
  // Articles, prepositions, conjunctions
  'A',
  'An',
  'The',
  'In',
  'On',
  'At',
  'Of',
  'For',
  'To',
  'And',
  'Or',
  'But',
  'With',
  'From',
  'By',
  'As',
  'Its',
  'Is',
  'Are',
  'Was',
  'Be',
  'Has',
  'Have',
  'This',
  'That',
  'These',
  'Those',
  'Your',
  'Our',
  'Their',
  // Common real-estate descriptive adjectives / openers (not proper names)
  'Ideal',
  'Prime',
  'Strong',
  'Stunning',
  'Spacious',
  'Modern',
  'Elegant',
  'Bright',
  'Charming',
  'Impressive',
  'Exceptional',
  'Superb',
  'Excellent',
  'Beautiful',
  'Luxury',
  'Luxurious',
  'Attractive',
  'Unique',
  'Rare',
  'Perfect',
  'Classic',
  'Contemporary',
  'Traditional',
  'Cosy',
  'Cozy',
  'Quiet',
  'Peaceful',
  'Vibrant',
  'Sought',
  'Desirable',
  'Prestigious',
  'Newly',
  'Well',
  'Fully',
  'Tastefully',
  'Beautifully',
  'Recently',
  'Lovingly',
  'Generously',
  'Conveniently',
  // Archetype framing words that open adapted directives
  'Investor',
  'Family',
  'Investment',
  'Lifestyle',
  'Portfolio',
];

/**
 * The digit rule: every digit token of `rawText` must canonicalise to a digit token of
 * `rawGrounding`, tokenised by the same regex, so "425000" enters whole and never verifies "5".
 * Both sides are number-normalised first [FOLLOW-1381, FOLLOW-1388]. A decade is checked as a decade
 * first [FOLLOW-1405]. A grounded "1,15 mln" is the number it names, and the listing's "1,15 mln"
 * also grounds "1150000" [FOLLOW-1397].
 *
 * @param rawText - The generated copy.
 * @param rawGrounding - The path's grounding text.
 * @param dialect - The path's dialect.
 * @returns The violation, or `null` when every number is grounded.
 */
export function checkNumbers(
  rawText: string,
  rawGrounding: string,
  dialect: ClaimDialect,
): NumberViolation | null {
  const normalised = normaliseNumberGroups(rawGrounding);
  const grounding = withMultipliedNumbers(normalised);
  const withoutDecades = stripGroundedDecades(normaliseNumberGroups(rawText), normalised);
  if (withoutDecades === null) return 'hallucinated_number';
  const text = stripGroundedMultipliedNumbers(withoutDecades, grounding);
  const grounded = new Set<string>();
  for (const m of grounding.matchAll(dialect.digit)) {
    const canon = canonNumber(m[0]);
    if (canon) grounded.add(canon);
  }
  for (const m of text.matchAll(dialect.digit)) {
    const canon = canonNumber(m[0]);
    if (canon && !grounded.has(canon)) return 'hallucinated_number';
  }
  return null;
}

/** What a text's claims are checked against: the listing's own words, prepared once. */
export interface ClaimGrounding {
  /** The original description, if the path has one apart, then every positive field. */
  readonly text: string;
  /** Canonical numbers the listing states AS an area (an area field, or a number + area unit). */
  readonly areaNumbers: ReadonlySet<string>;
}

/**
 * Grounding is the listing's OWN words only (§E.7.0, ESC-076): every positive field as
 * `key: value`. A field whose value says "no" (`pool: 'false'`) is skipped so its key cannot ground
 * the amenity it denies.
 *
 * @param leading - Text placed before the fields (the description path's original description).
 * @param ctx - The listing's own fields.
 * @param dialect - The path's dialect.
 * @returns The grounding the path's texts are checked against.
 */
export function buildGrounding(
  leading: readonly string[],
  ctx: Readonly<Record<string, string>>,
  dialect: ClaimDialect,
): ClaimGrounding {
  const parts = [...leading];
  const areaNumbers = new Set<string>();
  for (const [key, value] of Object.entries(ctx)) {
    const negative = NEGATIVE_FIELD_VALUES.has(dialect.strip(value).toLowerCase());
    if (!negative) parts.push(`${key.replaceAll('_', ' ')}: ${value}`);
    if (AREA_KEY_RE.test(key) && (!negative || dialect.areaFromNegativeFields)) {
      for (const m of normaliseNumberGroups(value).matchAll(dialect.digit)) {
        areaNumbers.add(canonNumber(m[0]));
      }
    }
  }
  const text = parts.join('\n');
  // "1 200 m²" is one number, as in the digit rule [FOLLOW-1388].
  for (const m of normaliseNumberGroups(text).matchAll(dialect.areaNumber)) {
    areaNumbers.add(canonNumber(m[1] ?? ''));
  }
  areaNumbers.delete('');
  return { text, areaNumbers };
}

/**
 * The first amenity / guarantee / unit claim in `value` the listing does not support. Deterministic
 * and final: no judge round trip can overrule it.
 *
 * @param value - The generated copy.
 * @param grounding - From {@link buildGrounding}.
 * @param dialect - The path's dialect.
 * @returns The violation code, or `null` when every claim in `value` is supported.
 */
export function checkClaimClasses(
  value: string,
  grounding: ClaimGrounding,
  dialect: ClaimDialect,
): ClaimViolation | null {
  // One group per amenity across en / pl / es [FOLLOW-1383].
  for (const { claim, grounding: grounds } of AMENITY_RES) {
    if (asserted(claim, value) && !asserted(grounds, grounding.text)) {
      return 'unsupported_amenity';
    }
  }
  // A negated guarantee ("no guarantee of income") is a disclaimer, on both sides [FOLLOW-1408].
  if (assertsGuarantee(value) && !assertsGuarantee(grounding.text)) {
    return 'unsupported_guarantee';
  }
  // A negated condition fact grounds nothing [FOLLOW-1393].
  if (
    assertsNoWorkClaim(value) &&
    !(assertsNoWorkClaim(grounding.text) || asserted(CONDITION_FACT_RE, grounding.text))
  ) {
    return 'unsupported_guarantee';
  }
  for (const m of normaliseNumberGroups(value).matchAll(dialect.areaNumber)) {
    if (!grounding.areaNumbers.has(canonNumber(m[1] ?? ''))) return 'unit_mismatch';
  }
  return null;
}
