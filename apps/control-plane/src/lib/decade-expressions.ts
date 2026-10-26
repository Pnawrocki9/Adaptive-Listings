/**
 * Decades in the digit rules — FOLLOW-1405.
 *
 * "Kamienica z lat 30." for a listing that says "a 1930s building" was refused as
 * `hallucinated_number` (FOLLOW-1399: 4 refusals): the digit rule read "30" as a number and the
 * listing has no "30". A decade is not a count, a price or an area; it is a claim about WHEN, and
 * it is grounded by the same claim in the listing:
 *
 *   - a four-digit decade ("1930s", "1930's", "lat 1930.", "1930-tych", "años 1930") is grounded
 *     by a year of that decade in the listing ("1934", "1930s", "built in 1938");
 *   - a two-digit decade ("lata 30.", "lata 30-te", "w latach 30-tych", "'30s", "the 30s",
 *     "años 30", "década de los 30"; a bare "30s" is read as a decade too) is read as the 1900s:
 *     it is grounded by a year 1930–1939 in the listing, or by the same two-digit decade ("z lat
 *     30.").
 *
 * A decade the listing does not support is refused OUTRIGHT, even where its digits happen to
 * appear elsewhere in the listing ("lata 50." against "50 m²"): before FOLLOW-1405 that case
 * passed, because the digit rule only asked whether "50" occurs. Only the expressions below are
 * decades; a bare "30" or "1930" is still a number or a year for the digit rule.
 *
 * Used by both digit rules (`checkNumbers` in `grounding-check.ts`, `checkDirectiveFacts` in
 * `llm-gateway.ts`). Pure, no I/O.
 *
 * @module apps/control-plane/src/lib/decade-expressions
 */

const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])';
/** A four-digit decade: 1000s–2090s. */
const D4 = '(?:1\\p{Nd}|20)\\p{Nd}0';
/** A two-digit decade: 10s–90s. */
const D2 = '[1-9]0';
/** What may follow a decade: "1930s", "1930's", "30-te", "30-tych", "1930-ych", "30ties". */
const SUFFIX = "(?:s|['’]s|-?(?:te|tych|ych|ties))";
/** The words that make a number after them a decade (pl / es). */
const LEAD = '(?:lat|lata|latach|latami|latom|años|anos|década de(?: los)?|decada de(?: los)?)';

/** Every decade expression; group 1 or 2 is the decade, as written. */
const DECADE_RE = new RegExp(
  NOT_WORD_BEFORE +
    '(?:' +
    // "lata 30.", "latach 30-tych", "años 30", "década de los 30", "lat 1930."
    `${LEAD}\\s+(${D4}|${D2})(?:${SUFFIX})?` +
    '|' +
    // "1930s", "1930's", "1930-tych", "'30s", "’30s", "the 30s"
    `['’]?(${D4}|${D2})${SUFFIX}` +
    ')' +
    NOT_WORD_AFTER,
  'giu',
);

/** A four-digit year anywhere in the listing ("1934", the "1930" of "1930s"). */
const YEAR_RE = new RegExp(`(?<!\\p{Nd})(?:1\\p{Nd}|20)\\p{Nd}{2}(?!\\p{Nd})`, 'gu');

/**
 * The decade digit and, when written, the century of each decade the listing states: "193" for a
 * year 1934 or a "1930s", "*3" for a two-digit "lat 30.".
 */
function groundedDecades(grounding: string): Set<string> {
  const keys = new Set<string>();
  for (const m of grounding.matchAll(YEAR_RE)) keys.add(m[0].slice(0, 3));
  for (const m of grounding.matchAll(DECADE_RE)) {
    const d = m[1] ?? m[2] ?? '';
    keys.add(d.length === 4 ? d.slice(0, 3) : `*${d.charAt(0)}`);
  }
  return keys;
}

/**
 * A four-digit decade needs a year of that decade. A two-digit decade is read as the 1900s — the
 * way "lata 30.", "the '30s" and "años 30" are written in listings — so it needs a year 19x0–19x9
 * or the same two-digit decade; a 2020s claim must be written "2020s" / "lat 2020." to be grounded
 * by 2021. Without this, a listing renovated in 2021 grounded "kamienica z lat 20.".
 */
function isGrounded(decade: string, keys: ReadonlySet<string>): boolean {
  if (decade.length === 4) return keys.has(decade.slice(0, 3));
  const digit = decade.charAt(0);
  return keys.has(`19${digit}`) || keys.has(`*${digit}`);
}

/**
 * Check every decade expression in `text` against the listing, and take the grounded ones out of
 * the digit rule's way.
 *
 * @param text - A generated text (body, headline or directive value).
 * @param grounding - The digit rule's grounding for the same request.
 * @returns `text` with each grounded decade expression blanked (so its digits are not read as a
 *          number), or `null` when a decade expression is NOT grounded — the caller refuses it as
 *          `hallucinated_number`.
 */
export function stripGroundedDecades(text: string, grounding: string): string | null {
  const keys = groundedDecades(grounding);
  let stripped = '';
  let last = 0;
  for (const m of text.matchAll(DECADE_RE)) {
    if (!isGrounded(m[1] ?? m[2] ?? '', keys)) return null;
    stripped += text.slice(last, m.index) + ' '.repeat(m[0].length);
    last = m.index + m[0].length;
  }
  return stripped + text.slice(last);
}
