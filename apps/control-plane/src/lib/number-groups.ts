/**
 * The one number normaliser of the claim checks — FOLLOW-1381 (description path), FOLLOW-1388
 * (`/api/adapt`).
 *
 * Both digit rules (`checkNumbers` in `grounding-check.ts`, `checkDirectiveFacts` in
 * `llm-gateway.ts`) and both area-unit rules (`grounding-check.ts`, `claim-containment.ts`) run
 * their text AND their grounding through this function before tokenising, so a number is compared
 * the same way on both paths. Pure, no I/O.
 *
 * @module apps/control-plane/src/lib/number-groups
 */

/**
 * A thousands-grouped number: one to three digits, then groups of exactly three, each after the
 * SAME separator — a space, a no-break space (U+00A0), a narrow no-break space (U+202F), a thin
 * space (U+2009), a dot or a comma. It must not start or end inside a longer digit run, and it
 * must not stop in front of a separator and another group of three ("1 150,000" mixes separators,
 * so it is not read as one number); a decimal tail ("1 150 000,50") may follow.
 */
const DIGIT_GROUPS_RE =
  /(?<![\p{Nd}.,])\p{Nd}{1,3}([ \u00a0\u202f\u2009.,])\p{Nd}{3}(?:\1\p{Nd}{3})*(?!\p{Nd}|\1\p{Nd}|[ \u00a0\u202f\u2009.,]\p{Nd}{3}(?!\p{Nd}))/gu;
const GROUP_SEPARATOR_RE = /[ \u00a0\u202f\u2009.,]/gu;
/** A comma between digits that is not followed by exactly three digits: a decimal comma ("3,5"). */
const DECIMAL_COMMA_RE = /(?<=\p{Nd}),(?=\p{Nd}{1,2}(?!\p{Nd})|\p{Nd}{4,})/gu;

/**
 * Write every number the way the digit rules compare it. A thousands-grouped number becomes its
 * digits ("949 000", "949,000", "949.000" → "949000"), so it is checked whole: "949 000" is
 * grounded by "949000" and "949" is not. A remaining decimal comma becomes a point ("3,5" → "3.5"),
 * so a Polish decimal equals an English one and no longer equals "35". A comma before exactly three
 * digits stays a thousands separator.
 *
 * @param s - A text or a grounding, before its digit tokens are read.
 * @returns `s` with every grouped number joined and every decimal comma made a point.
 */
export function normaliseNumberGroups(s: string): string {
  return s
    .replace(DIGIT_GROUPS_RE, (m) => m.replace(GROUP_SEPARATOR_RE, ''))
    .replace(DECIMAL_COMMA_RE, '.');
}

/**
 * FOLLOW-1397: a number followed by a multiplier word, on a number-normalised text (decimal point,
 * groups joined). Group 1 is the number; group 2 a spaced or attached multiplier WORD; group 3 an
 * attached one-letter multiplier ("850k", "1.15M", "1.15m" — attached only, so "64 m" stays
 * metres). "mil" followed by "millones" is the Spanish billion and is not read.
 */
const MULTIPLIED_NUMBER_RE =
  /(?<![\p{Nd}.])(\p{Nd}+(?:\.\p{Nd}+)?)(?:[ \u00a0\u202f\u2009]?(tys\.?|tysi[ąę]c\p{L}*|thousands?|mil(?![ \t]+millones)|mln\.?|millions?|millones|mill[oó]n|milion\p{L}*|mld\.?|miliard\p{L}*|billions?|bn)|(k|K|M|m))(?![\p{L}\p{N}_])/gu;

/** The power of ten of a multiplier (group 2 or 3 of `MULTIPLIED_NUMBER_RE`). */
function multiplierExponent(word: string): number {
  const w = word.toLowerCase();
  if (/^(?:tys|tysi|thousand|mil$|k$)/u.test(w)) return 3;
  if (/^(?:mld|miliard|billion|bn)/u.test(w)) return 9;
  return 6;
}

/** A multiplied number: its exact value, the unit of its last written digit, its significant digits. */
interface MultipliedNumber {
  readonly value: bigint;
  readonly unit: bigint;
  readonly significant: number;
}

function readMultiplied(number: string, multiplier: string): MultipliedNumber | null {
  const [whole = '', fraction = ''] = number.split('.');
  const exponent = multiplierExponent(multiplier);
  if (fraction.length > exponent) return null;
  const digits = `${whole}${fraction}`;
  const unit = 10n ** BigInt(exponent - fraction.length);
  return {
    value: BigInt(digits) * unit,
    unit,
    significant: digits.replace(/^0+/u, '').length,
  };
}

/** The integers a number-normalised grounding states, plus its multiplied numbers (exact). */
function groundedIntegers(grounding: string): Set<bigint> {
  const integers = new Set<bigint>();
  for (const m of grounding.matchAll(/(?<![\p{Nd}.])\p{Nd}+(?![\p{Nd}]|\.\p{Nd})/gu)) {
    if (/^[0-9]+$/u.test(m[0])) integers.add(BigInt(m[0]));
  }
  for (const m of grounding.matchAll(MULTIPLIED_NUMBER_RE)) {
    // "m" / "M" in the listing may be metres: only the unambiguous words ground a value.
    if (m[2] === undefined) continue;
    const read = readMultiplied(m[1] ?? '', m[2]);
    if (read) integers.add(read.value);
  }
  return integers;
}

/**
 * FOLLOW-1397: the listing's multiplied numbers ("1,15 mln zł", "850 tys.") written out as plain
 * digits after `grounding`, so the digit rules ground "1 150 000" by them. Exact values only; a
 * one-letter "m" / "M" is never read here (it may be metres).
 *
 * @param grounding - A number-normalised grounding (`normaliseNumberGroups`).
 * @returns `grounding` plus one plain integer per multiplied number it states.
 */
export function withMultipliedNumbers(grounding: string): string {
  const extra: string[] = [];
  for (const m of grounding.matchAll(MULTIPLIED_NUMBER_RE)) {
    if (m[2] === undefined) continue;
    const read = readMultiplied(m[1] ?? '', m[2]);
    if (read) extra.push(read.value.toString());
  }
  return extra.length === 0 ? grounding : `${grounding} ${extra.join(' ')}`;
}

/**
 * FOLLOW-1397: blank out every multiplied number of `text` ("1,15 mln PLN", "1.15M", "850 tys.",
 * "850k") that the grounding states, so the digit rule does not read "1.15" as a number of its
 * own. Grounded means: the multiplied value EQUALS an integer of the grounding, or — when the
 * written number has three or more significant digits — differs from one by at most half the unit
 * of its last written digit (the listing value rounded to the precision written). A multiplied
 * number that is not grounded is left in place, and the digit rule refuses it as before.
 *
 * @param text - A number-normalised text (`normaliseNumberGroups`).
 * @param grounding - A number-normalised grounding.
 * @returns `text` with each grounded multiplied number replaced by spaces of the same length.
 */
export function stripGroundedMultipliedNumbers(text: string, grounding: string): string {
  const integers = groundedIntegers(grounding);
  return text.replace(
    MULTIPLIED_NUMBER_RE,
    (match, number: string, word?: string, letter?: string) => {
      const read = readMultiplied(number, word ?? letter ?? '');
      if (read === null) return match;
      const grounded = [...integers].some((g) => {
        if (g === read.value) return true;
        if (read.significant < 3) return false;
        const diff = g > read.value ? g - read.value : read.value - g;
        return diff * 2n <= read.unit;
      });
      return grounded ? ' '.repeat(match.length) : match;
    },
  );
}
