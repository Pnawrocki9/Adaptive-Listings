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
