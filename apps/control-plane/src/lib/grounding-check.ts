/**
 * The description-path grounding check — a faithful port of the Python job's checker
 * (`apps/llm-gateway/src/jobs/generate_description.py`, deleted by FOLLOW-1297 PR B: `_check_numbers`, `_check_body_facts`,
 * `_check_body_claims`, `_check_headline_facts`, `_check_unsupported_claims`, `_canon_number`,
 * `_stem_loose`, `_body_violates_contract`) — FOLLOW-1297, ADR-0023 §2–§4.
 *
 * Pure: no I/O. Its behaviour IS the Python behaviour, proven case by case by the frozen parity
 * corpus (`__fixtures__/description-parity/corpus.v1.jsonl`, `__tests__/description-parity.test.ts`).
 * Python defects are ported as they are and listed in the PR; fixing one is a later change that
 * re-freezes the corpus (ADR-0023 §4, no divergence allowance).
 *
 * This is NOT the `/api/adapt` checker (`checkDirectiveFacts` in `llm-gateway.ts`,
 * `claim-containment.ts`): those keep their own semantics (ADR-0023 §2 scope boundary). The two
 * differ in ways the corpus pins, e.g.:
 *   - the digit regex here is case-insensitive (Python `re.IGNORECASE`), the adapt one is not;
 *   - the claim grounding here is `original_description` + the positive fields, the adapt one is
 *     the fields only;
 *   - the grounding text for the digit and proper-name rules here is `json.dumps(listing_context)`
 *     WITHOUT ASCII escaping (FOLLOW-1314, corpus v2). The Python used `ensure_ascii=True`, so a
 *     non-ASCII context value contributed the hex digits of its `\uXXXX` escape to the grounded
 *     digit set (an `é` grounded a `9`) and a non-ASCII proper name present only in
 *     `listing_context` ("Jávea") was never found. Inert while production sent
 *     `listing_context = {}`; FOLLOW-1314 makes the route send the listing's own fields, so the
 *     latent fail-open is closed here in the same change. The PROMPT still renders the context with
 *     `ensure_ascii=True` (its bytes are pinned by the corpus prompt digests).
 *   - the digit and area-unit rules here read a thousands-grouped number ("949 000", "949,000",
 *     "949.000") as one number and a decimal comma as a decimal point, on BOTH sides (FOLLOW-1381,
 *     corpus v4, `normaliseNumberGroups`). Since FOLLOW-1388 the adapt checker reads them the same
 *     way, through the same function (`lib/number-groups.ts`).
 *   - the amenity vocabulary, its negators and its spec-line negation ("Basen: brak") are ONE list
 *     shared with the adapt checker (`lib/amenity-lexicon.ts`, FOLLOW-1383): en / pl / es, Polish
 *     inflection as explicit endings. Python's list was English only. So, since FOLLOW-1393, are the
 *     guarantee, no-work and condition-fact patterns (`lib/condition-lexicon.ts`); a condition fact
 *     grounds a no-work claim only when it is not negated.
 *
 * Python-semantics helpers (exported for the generator): Python's `str.strip()` / `str.split()` /
 * `str.splitlines()` whitespace sets differ from ECMAScript's; `len()` and slicing count code
 * points; `\b` and `\w` are Unicode-aware; `str.isupper()` is the Unicode `Uppercase` property.
 * Each helper names the Python call it stands in for.
 *
 * @module apps/control-plane/src/lib/grounding-check
 */

import {
  AMENITY_RES,
  NEGATED_AFTER_RE,
  NEGATOR_RE,
  negatedThroughList,
} from '@/lib/amenity-lexicon';
import { CONDITION_FACT_RE, assertsGuarantee, assertsNoWorkClaim } from '@/lib/condition-lexicon';
import { hasMetaCommentary } from '@/lib/meta-commentary';
import { hasModelControlTag } from '@/lib/model-control-tags';
import { normaliseNumberGroups } from '@/lib/number-groups';
import { stripGroundedDecades } from '@/lib/decade-expressions';

// ─── Violation codes (ADR-0023 §3) ────────────────────────────────────────────

export type NumberViolation = 'hallucinated_number';
export type FactViolation = NumberViolation | 'hallucinated_proper_name';
/** = `claim-containment.ts` `ClaimViolation`; restated here so this module has no adapt import. */
export type ClaimViolation = 'unsupported_amenity' | 'unsupported_guarantee' | 'unit_mismatch';
export type ContractViolation =
  | 'residual_tag'
  | 'formatted_body'
  | 'leak_marker'
  | 'meta_commentary';

// ─── Python string semantics ──────────────────────────────────────────────────

/**
 * Python `str.isspace()` set (3.12): the characters `str.strip()`, `str.split()` and the `\s` class
 * of a `str` pattern treat as whitespace. Differs from ECMAScript (`\x1c`–`\x1f` and `\x85` are
 * whitespace here, U+FEFF is not).
 */
const PY_WS_CHARS =
  '\\t\\n\\u000b\\u000c\\r\\u001c-\\u001f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
/** Python `\s` for a `str` pattern. */
export const PY_WS = `[${PY_WS_CHARS}]`;
const PY_WS_LEADING_RE = new RegExp(`^${PY_WS}+`, 'u');
const PY_WS_TRAILING_RE = new RegExp(`${PY_WS}+$`, 'u');
const PY_WS_RUN_RE = new RegExp(`${PY_WS}+`, 'gu');
/** Python `str.splitlines()` separators. */
// eslint-disable-next-line no-control-regex -- Python's str.splitlines() separators include \v \f \x1c-\x1e
const PY_LINE_BREAK_RE = /\r\n|[\n\r\u000b\u000c\u001c\u001d\u001e\u0085\u2028\u2029]/u;

/** Python `s.strip()`. */
export function pyStrip(s: string): string {
  return s.replace(PY_WS_LEADING_RE, '').replace(PY_WS_TRAILING_RE, '');
}

/** Python `s.lstrip()`. */
function pyLstrip(s: string): string {
  return s.replace(PY_WS_LEADING_RE, '');
}

/** Python `s.strip(chars)` / `s.rstrip(chars)`: strip any run of the given characters. */
function stripChars(s: string, chars: string, sides: 'both' | 'right'): string {
  const set = new Set(Array.from(chars));
  const cps = Array.from(s);
  let end = cps.length;
  while (end > 0 && set.has(cps[end - 1] ?? '')) end -= 1;
  let start = 0;
  if (sides === 'both') while (start < end && set.has(cps[start] ?? '')) start += 1;
  return cps.slice(start, end).join('');
}

/** Python `s.strip(chars)`. */
export function pyStripChars(s: string, chars: string): string {
  return stripChars(s, chars, 'both');
}

/** Python `s.rstrip(chars)`. */
function pyRstripChars(s: string, chars: string): string {
  return stripChars(s, chars, 'right');
}

/** Python `s.split()` (no separator): runs of whitespace, no empty fields. */
export function pySplit(s: string): string[] {
  const stripped = pyStrip(s);
  return stripped === '' ? [] : stripped.split(PY_WS_RUN_RE);
}

/** Python `s.splitlines()` (no `keepends`). */
function pySplitlines(s: string): string[] {
  if (s === '') return [];
  const parts = s.split(PY_LINE_BREAK_RE);
  // ECMAScript yields a trailing '' when the string ends with a separator; Python does not.
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** Python `s[:n]` on a `str`: the first `n` CODE POINTS. */
export function pySliceCodePoints(s: string, n: number): string {
  return Array.from(s).slice(0, n).join('');
}

/** Python `len(s)` on a `str`: code points. */
function pyLen(s: string): number {
  return Array.from(s).length;
}

/**
 * Python `json.dumps(obj)` / `json.dumps(obj, indent=2)` for a `dict[str, str]` with the default
 * `ensure_ascii=True`: every character outside `0x20..0x7e` is written as a lowercase `\uXXXX`
 * escape (astral characters as a surrogate pair); `"` and `\` are backslash-escaped; `\b \f \n \r
 * \t` keep their short forms. Separators are `', '` / `': '` without indent and `','` + newline +
 * `': '` with it; an empty dict is `{}` either way. Key order is the object's own (one divergence,
 * stated: ECMAScript orders integer-like keys first, Python keeps insertion order — no production
 * context key is integer-like, and the corpus carries none).
 *
 * `ensureAscii = false` is Python's `json.dumps(obj, ensure_ascii=False)`: characters above `0x7e`
 * are written as themselves (control characters, `"` and `\` are still escaped). The grounding
 * text uses that form (FOLLOW-1314); the prompt keeps the default.
 */
export function pythonJsonDumps(
  obj: Readonly<Record<string, string>>,
  indent?: 2,
  ensureAscii = true,
): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return '{}';
  const pairs = entries.map(
    ([k, v]) => `${pyJsonString(k, ensureAscii)}: ${pyJsonString(v, ensureAscii)}`,
  );
  if (indent === undefined) return `{${pairs.join(', ')}}`;
  return `{\n  ${pairs.join(',\n  ')}\n}`;
}

function pyJsonString(s: string, ensureAscii: boolean): string {
  let out = '"';
  for (let i = 0; i < s.length; i += 1) {
    const unit = s.charCodeAt(i);
    const ch = s.charAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (unit === 0x08) out += '\\b';
    else if (unit === 0x0c) out += '\\f';
    else if (unit < 0x20 || (ensureAscii && unit > 0x7e))
      out += `\\u${unit.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

/** Python `\w` for a `str` pattern (`str.isalnum()` or `_`), as a character-class body. */
const PY_WORD = '\\p{L}\\p{N}_';
/** Python `\b` before/after a word character, as lookarounds. */
const B_START = `(?<![${PY_WORD}])`;
const B_END = `(?![${PY_WORD}])`;
const PY_WORD_CHAR_RE = new RegExp(`^[${PY_WORD}]$`, 'u');

/**
 * Python `re.search(r"\b" + re.escape(needle) + r"\b", haystack, re.IGNORECASE)`. `\b` is a
 * boundary between a word and a non-word character, so when the needle itself starts (ends) with a
 * NON-word character the boundary demands a word character before (after) it.
 */
function pyWordBoundarySearch(needle: string, haystack: string): boolean {
  const cps = Array.from(needle);
  if (cps.length === 0) return false;
  const first = cps[0] ?? '';
  const last = cps[cps.length - 1] ?? '';
  const prefix = PY_WORD_CHAR_RE.test(first) ? B_START : `(?<=[${PY_WORD}])`;
  const suffix = PY_WORD_CHAR_RE.test(last) ? B_END : `(?=[${PY_WORD}])`;
  const escaped = needle.replace(/[\\^$.*+?()[\]{}|/]/gu, '\\$&');
  return new RegExp(`${prefix}${escaped}${suffix}`, 'iu').test(haystack);
}

/** Python `ch.isupper()` for one character: the Unicode `Uppercase` property. */
const PY_UPPER_RE = /^\p{Uppercase}$/u;

// ─── Digit rule (`_check_numbers`, `_canon_number`) ──────────────────────────

/** `_FACT_CHECK_DIGIT_RE`: `\d[\d.,/%m²sqftftm-]*` with `re.IGNORECASE`; Python `\d` is `\p{Nd}`. */
const FACT_CHECK_DIGIT_RE = /\p{Nd}[\p{Nd}.,/%m²sqftftm-]*/giu;
/** `_GROUNDING_WORD_RE`: `[\w-]+`. */
const GROUNDING_WORD_RE = new RegExp(`[${PY_WORD}-]+`, 'gu');
/** `_STEM_SUFFIXES`, longest first. */
const STEM_SUFFIXES = ['ing', 'ed', 'es', 's', 'e'] as const;

/**
 * `_canon_number`: what a digit token asserts — its digits and decimal point, outer dots stripped.
 * `[^0-9.]` is ASCII in Python too, so a non-ASCII decimal digit (matched by `\p{Nd}` above)
 * canonicalises to '' and is skipped by the callers, exactly as in Python.
 */
export function canonNumber(token: string): string {
  return token
    .replace(/[^0-9.]/gu, '')
    .replace(/^\.+/u, '')
    .replace(/\.+$/u, '');
}

/** `_stem_loose`: lowercase, then strip ONE English suffix when the word is long enough. */
export function stemLoose(word: string): string {
  const w = word.toLowerCase();
  const len = pyLen(w);
  for (const suffix of STEM_SUFFIXES) {
    if (len > suffix.length + 2 && w.endsWith(suffix)) return w.slice(0, -suffix.length);
  }
  return w;
}

/**
 * `_check_numbers`: every digit token of `text` must canonicalise to a digit token of `grounding`.
 * The grounding is tokenised with the SAME regex, so "425000" enters whole and never verifies "5".
 * Both sides are number-normalised first (FOLLOW-1381, `lib/number-groups.ts`), so a grouped
 * number is one token. A decade expression ("lat 30.", "1930s") is checked as a decade first
 * (FOLLOW-1405, `lib/decade-expressions.ts`).
 */
function checkNumbers(rawText: string, rawGrounding: string): NumberViolation | null {
  const grounding = normaliseNumberGroups(rawGrounding);
  // A decade is checked as a decade, then kept out of the digit rule [FOLLOW-1405].
  const withoutDecades = stripGroundedDecades(normaliseNumberGroups(rawText), grounding);
  if (withoutDecades === null) return 'hallucinated_number';
  const text = withoutDecades;
  const grounded = new Set<string>();
  for (const m of grounding.matchAll(FACT_CHECK_DIGIT_RE)) {
    const canon = canonNumber(m[0]);
    if (canon) grounded.add(canon);
  }
  for (const m of text.matchAll(FACT_CHECK_DIGIT_RE)) {
    const canon = canonNumber(m[0]);
    if (canon && !grounded.has(canon)) return 'hallucinated_number';
  }
  return null;
}

/**
 * `(original_description + " " + json.dumps(listing_context, ensure_ascii=False)).lower()` — the
 * grounding of the digit rule and the headline's proper-name rule. FOLLOW-1314 (corpus v2): the
 * listing's own field values enter as written, so "Jávea" grounds "Jávea" and an `é` no longer
 * grounds a `9` through its `é` escape. Every other byte is the v1 grounding's.
 */
function factGrounding(original: string, ctx: Readonly<Record<string, string>>): string {
  return `${original} ${pythonJsonDumps(ctx, undefined, false)}`.toLowerCase();
}

/** `_check_body_facts`: the digit rule over the description body. */
function checkBodyFacts(
  body: string,
  original: string,
  ctx: Readonly<Record<string, string>>,
): NumberViolation | null {
  return checkNumbers(body, factGrounding(original, ctx));
}

// ─── Claim containment (`_check_unsupported_claims`, FOLLOW-1305) ────────────

const CLAUSE_BREAK_RE = /[.;:!?\n,]/gu;
const NEGATION_WINDOW = 30;

const AREA_UNIT =
  `(?:m²|m2|sq\\.?${PY_WS}?m|sqm|square${PY_WS}+met(?:re|er)s?|sq\\.?${PY_WS}?ft|sqft|` +
  `square${PY_WS}+f(?:ee|oo)t)`;
/** `(\d[\d.,]*)\s*UNIT(?![a-z])`, `re.IGNORECASE` (so the lookahead also rejects `A-Z`). */
const AREA_NUMBER_RE = new RegExp(`(\\p{Nd}[\\p{Nd}.,]*)${PY_WS}*${AREA_UNIT}(?![a-z])`, 'giu');
const AREA_KEY_RE = /area|size|sqm|sq_?ft|m2|surface|plot|floor_?space|footage/iu;
const NEGATIVE_FIELD_VALUES: ReadonlySet<string> = new Set([
  '',
  'no',
  'false',
  '0',
  'none',
  'n/a',
  'null',
  // FOLLOW-1383: the Polish "no" values of a spec field.
  'nie',
  'brak',
]);

/**
 * `_claim_grounding`: the listing's own words — `original_description` plus every POSITIVE field
 * as `key: value` (underscores in the key become spaces), newline-joined. A field whose value says
 * "no" is skipped so its key cannot ground the amenity it denies.
 */
function claimGrounding(original: string, ctx: Readonly<Record<string, string>>): string {
  const parts = [original];
  for (const [key, value] of Object.entries(ctx)) {
    if (NEGATIVE_FIELD_VALUES.has(pyStrip(value).toLowerCase())) continue;
    parts.push(`${key.replaceAll('_', ' ')}: ${value}`);
  }
  return parts.join('\n');
}

/** `_is_negated`: a negator in the same clause within the 30 CODE POINTS before `start`. */
function isNegated(text: string, startUtf16: number): boolean {
  const before = Array.from(text.slice(0, startUtf16));
  let window = before.slice(Math.max(0, before.length - NEGATION_WINDOW)).join('');
  let lastBreak: RegExpExecArray | null = null;
  for (const m of window.matchAll(CLAUSE_BREAK_RE)) lastBreak = m;
  if (lastBreak) window = window.slice(lastBreak.index + lastBreak[0].length);
  return NEGATOR_RE.test(window);
}

/**
 * `_asserted`: at least one NON-negated match. FOLLOW-1383: a match followed by a spec-line
 * negation ("Basen: brak") is negated too. FOLLOW-1413: so is an item of a negated list ("no
 * schools, nurseries or playgrounds").
 */
function asserted(pattern: RegExp, text: string): boolean {
  for (const m of text.matchAll(pattern)) {
    if (isNegated(text, m.index) || negatedThroughList(text, m.index, isNegated)) continue;
    if (NEGATED_AFTER_RE.test(text.slice(m.index + m[0].length))) continue;
    return true;
  }
  return false;
}

/** `_grounded_area_numbers`: numbers the listing states AS an area. */
function groundedAreaNumbers(
  grounding: string,
  ctx: Readonly<Record<string, string>>,
): Set<string> {
  const numbers = new Set<string>();
  for (const m of normaliseNumberGroups(grounding).matchAll(AREA_NUMBER_RE)) {
    numbers.add(canonNumber(m[1] ?? ''));
  }
  for (const [key, value] of Object.entries(ctx)) {
    if (AREA_KEY_RE.test(key)) {
      for (const m of normaliseNumberGroups(value).matchAll(FACT_CHECK_DIGIT_RE)) {
        numbers.add(canonNumber(m[0]));
      }
    }
  }
  numbers.delete('');
  return numbers;
}

/** `_check_unsupported_claims`: the first amenity / guarantee / unit claim the listing does not make. */
function checkUnsupportedClaimsPy(
  text: string,
  original: string,
  ctx: Readonly<Record<string, string>>,
): ClaimViolation | null {
  const grounding = claimGrounding(original, ctx);

  // FOLLOW-1383: one group per amenity across en / pl / es (`lib/amenity-lexicon.ts`).
  for (const { claim, grounding: grounds } of AMENITY_RES) {
    if (asserted(claim, text) && !asserted(grounds, grounding)) return 'unsupported_amenity';
  }
  // FOLLOW-1393: one guarantee / no-work / condition list across en / pl / es
  // (`lib/condition-lexicon.ts`); a condition fact counts only when it is not negated.
  // FOLLOW-1408: a negated guarantee ("no guarantee of income") is a disclaimer, on both sides.
  if (assertsGuarantee(text) && !assertsGuarantee(grounding)) return 'unsupported_guarantee';
  if (
    assertsNoWorkClaim(text) &&
    !(assertsNoWorkClaim(grounding) || asserted(CONDITION_FACT_RE, grounding))
  ) {
    return 'unsupported_guarantee';
  }
  const areaNumbers = groundedAreaNumbers(grounding, ctx);
  for (const m of normaliseNumberGroups(text).matchAll(AREA_NUMBER_RE)) {
    if (!areaNumbers.has(canonNumber(m[1] ?? ''))) return 'unit_mismatch';
  }
  return null;
}

/** `_check_body_claims`: the digit rule, then the claim classes. Non-null ⇒ REFUSED. */
export function checkBodyClaims(
  body: string,
  original: string,
  ctx: Readonly<Record<string, string>>,
): NumberViolation | ClaimViolation | null {
  return checkBodyFacts(body, original, ctx) ?? checkUnsupportedClaimsPy(body, original, ctx);
}

// ─── Headline fact check (`_check_headline_facts`) ───────────────────────────

/** `_HEADLINE_STOP_CAPS`: capitalised words that are not proper names. */
const HEADLINE_STOP_CAPS: ReadonlySet<string> = new Set([
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
  'Investor',
  'Family',
  'Investment',
  'Lifestyle',
  'Portfolio',
]);

/**
 * FOLLOW-1389: per page language, the closed list of ordinary words a headline opens with —
 * property types, room counts, descriptive adjectives. Matched case-insensitively against the
 * FIRST word only. Its sentence-initial capital is not a name; the same word anywhere else is
 * checked as before, and another language's list never applies.
 */
const HEADLINE_OPENING_WORDS: Readonly<Record<'en' | 'pl' | 'es', RegExp>> = {
  en: new RegExp(
    '^(?:(?:one|two|three|four|five|six|single|double)-(?:bed|bedroom|bedroomed|room|storey|story|level|family)|' +
      'detached|semi-detached|terraced|end-terrace|end-of-terrace|furnished|unfurnished|renovated|' +
      'refurbished|sunny|corner|ground-floor|top-floor|first-floor|house|home|flat|apartment|villa|' +
      'studio|penthouse|cottage|bungalow|townhouse|duplex|loft|maisonette|plot|land|freehold|' +
      'leasehold|large|compact|light-filled|quiet|new|new-build|seafront|waterfront|south-facing)$',
    'iu',
  ),
  pl: new RegExp(
    '^(?:(?:jedno|dwu|trzy|cztero|pięcio|sześcio|wielo)pokojow[eya]|dom|domek|mieszkanie|' +
      'apartament|kawalerka|willa|studio|działka|lokal|segment|bliźniak|szeregowiec|penthouse|loft|' +
      '(?:wolnostojąc|narożn|parterow|piętrow|przestronn|słoneczn|jasn|nowoczesn|komfortow|' +
      'umeblowan|wykończon|przytuln|rodzinn|now|duż|cich|odnowion|wyremontowan)(?:y|a|e|ą))$',
    'iu',
  ),
  es: new RegExp(
    '^(?:casa|piso|apartamento|ático|chalet|villa|estudio|dúplex|bungalow|finca|parcela|solar|' +
      'local|adosad[oa]|(?:luminos|ampli|modern|espacios|precios|bonit|reformad|amueblad|nuev)[oa]|' +
      'acogedora?|independiente)$',
    'iu',
  ),
};

/**
 * FOLLOW-1395: the closed set of Polish case endings a place name takes in a headline, as
 * `[ending in the headline, ending in the facts]` — locative, genitive, instrumental, dative of a
 * masculine (`Kraków` → `Krakowie`, `Gdańsk` → `Gdańsku`, `Straszyn` → `Straszynie`), feminine
 * (`Warszawa` → `Warszawie`, `Albufeira` → `Albufeirze`, `Praga` → `Pradze`) or neuter
 * (`Podgórze` → `Podgórzu`) noun. Stems are compared with `ó` read as `o` (`Kraków` /
 * `Krakowie`; a listing written without diacritics, `Podgorze`, also grounds `Podgórze`). Nothing else: no fuzzy match, no other language.
 */
const POLISH_CASE_ENDINGS: readonly (readonly [string, string])[] = [
  // the nominative itself, `ó` read as `o` (`Podgórze` / `Podgorze`)
  ['', ''],
  // masculine, consonant-final nominative
  ['u', ''],
  ['a', ''],
  ['em', ''],
  ['iem', ''],
  ['ie', ''],
  ['owi', ''],
  ['rze', 'r'],
  ['cie', 't'],
  ['dzie', 'd'],
  ['le', 'ł'],
  // feminine, -a nominative
  ['y', 'a'],
  ['i', 'a'],
  ['ę', 'a'],
  ['ą', 'a'],
  ['ie', 'a'],
  ['rze', 'ra'],
  ['ce', 'ka'],
  ['dze', 'ga'],
  ['le', 'ła'],
  // neuter, -e / -o nominative
  ['u', 'e'],
  ['a', 'e'],
  ['em', 'e'],
  ['u', 'o'],
  ['a', 'o'],
  ['em', 'o'],
  ['ie', 'o'],
];
const POLISH_MIN_STEM = 3;
const CAPITALISED_FACT_TOKEN_RE = /\p{Uppercase}\p{L}{2,}/gu;

/** One word is the other under one `POLISH_CASE_ENDINGS` rule (either word may be the inflected one). */
function polishCaseForms(a: string, b: string): boolean {
  const fold = (s: string) => s.toLowerCase().replaceAll('ó', 'o');
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  for (const [inflected, nominative] of POLISH_CASE_ENDINGS) {
    for (const [t, f] of [
      [x, y],
      [y, x],
    ] as const) {
      if (!t.endsWith(inflected) || !f.endsWith(nominative)) continue;
      const tStem = t.slice(0, t.length - inflected.length);
      const fStem = f.slice(0, f.length - nominative.length);
      if (Array.from(tStem).length < POLISH_MIN_STEM) continue;
      if (fold(tStem) === fold(fStem)) return true;
    }
  }
  return false;
}

/**
 * FOLLOW-1395: is a capitalised headline word a Polish case form of a capitalised word of the
 * listing's own text or fields ("Krakowie" of "Kraków", "Albufeirze" of "Albufeira")?
 */
function isPolishCaseFormOfFact(
  word: string,
  original: string,
  ctx: Readonly<Record<string, string>>,
): boolean {
  const facts = [original, ...Object.values(ctx)].join(' ');
  for (const m of facts.matchAll(CAPITALISED_FACT_TOKEN_RE)) {
    if (polishCaseForms(word, m[0])) return true;
  }
  return false;
}

/** FOLLOW-1396: a name with its diacritics folded ("Kraków" → "Krakow", "Łódź" → "Lodz"). */
function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replaceAll('ł', 'l').replaceAll('Ł', 'L');
}

/**
 * FOLLOW-1396: the CLOSED table of places with more than one name across en / pl / es (and the
 * local form): each row is one place. A headline may use any name of a row when the listing uses
 * another name of the SAME row ("Warsaw" for "Warszawa", "Sewilla" for "Sevilla"). Single words
 * only (the rule checks word by word); no names that are also another place or a common word
 * ("Praga" is a Warsaw district, "Galicja" another region), and no historical German names. A
 * name differing only by diacritics needs no row (`foldDiacritics`).
 */
const PLACE_EXONYMS: readonly (readonly string[])[] = [
  // Poland
  ['Warszawa', 'Warsaw', 'Varsovia'],
  ['Kraków', 'Cracow', 'Cracovia'],
  ['Wrocław', 'Breslavia'],
  ['Poznań', 'Posnania'],
  ['Śląsk', 'Silesia'],
  ['Pomorze', 'Pomerania'],
  ['Mazury', 'Masuria'],
  ['Mazowsze', 'Masovia', 'Mazovia'],
  ['Kaszuby', 'Kashubia'],
  ['Tatry', 'Tatras'],
  // Spain
  ['Sevilla', 'Seville', 'Sewilla'],
  ['Zaragoza', 'Saragossa'],
  ['Madrid', 'Madryt'],
  ['Valencia', 'València', 'Walencja'],
  ['Córdoba', 'Cordova', 'Kordoba'],
  ['Cádiz', 'Kadyks'],
  ['Mallorca', 'Majorca', 'Majorka'],
  ['Menorca', 'Minorca', 'Minorka'],
  ['Ibiza', 'Eivissa'],
  ['Tenerife', 'Teneryfa'],
  ['Andalucía', 'Andalusia', 'Andaluzja'],
  ['Cataluña', 'Catalunya', 'Catalonia', 'Katalonia'],
  ['Alicante', 'Alacant'],
  ['Jávea', 'Xàbia'],
  ['Castellón', 'Castelló'],
  ['Gerona', 'Girona'],
  ['Lérida', 'Lleida'],
  ['Navarra', 'Navarre'],
  ['Vizcaya', 'Biscay', 'Bizkaia'],
  // Portugal
  ['Lisboa', 'Lisbon', 'Lizbona'],
  ['Porto', 'Oporto'],
];

/**
 * FOLLOW-1396: is a capitalised headline word the listing's own place under another name — the
 * same name with diacritics folded, or another name of the same `PLACE_EXONYMS` row (on a Polish
 * page, also an inflected form of one: "w Warszawie" for "Warsaw")?
 */
function isOtherNameOfListingPlace(
  word: string,
  grounding: string,
  locale: 'en' | 'pl' | 'es' | undefined,
): boolean {
  const foldedGrounding = foldDiacritics(grounding);
  if (pyWordBoundarySearch(foldDiacritics(word), foldedGrounding)) return true;
  const folded = foldDiacritics(word).toLowerCase();
  for (const row of PLACE_EXONYMS) {
    const names =
      row.some((n) => foldDiacritics(n).toLowerCase() === folded) ||
      (locale === 'pl' && row.some((n) => polishCaseForms(word, n)));
    if (names && row.some((n) => pyWordBoundarySearch(foldDiacritics(n), foldedGrounding))) {
      return true;
    }
  }
  return false;
}

/**
 * `_check_headline_facts`: digits, then the claim classes, then every capitalised word (first word
 * included) that is not a stop-cap must appear in the grounding whole (Unicode `\b`) or by loose
 * stem. FOLLOW-1389: with the page's `locale`, a first word in that language's
 * `HEADLINE_OPENING_WORDS` is not checked (without one, nothing is exempt — the Python behaviour).
 * FOLLOW-1395: on a Polish page, a word that is a Polish case form of a capitalised word of the
 * listing (`POLISH_CASE_ENDINGS`) is the listing's own name. FOLLOW-1396: so is the listing's own
 * place name without its diacritics, or under another name from the closed `PLACE_EXONYMS` table.
 */
export function checkHeadlineFacts(
  headline: string,
  original: string,
  ctx: Readonly<Record<string, string>>,
  locale?: 'en' | 'pl' | 'es',
): FactViolation | ClaimViolation | null {
  const grounding = factGrounding(original, ctx);

  const numberViolation = checkNumbers(headline, grounding);
  if (numberViolation !== null) return numberViolation;

  const claimViolation = checkUnsupportedClaimsPy(headline, original, ctx);
  if (claimViolation !== null) return claimViolation;

  const groundingStems = new Set<string>();
  for (const m of grounding.matchAll(GROUNDING_WORD_RE)) groundingStems.add(stemLoose(m[0]));
  for (const [i, word] of pySplit(headline).entries()) {
    const clean = pyRstripChars(word, '.,;:!?"\')');
    if (!clean) continue;
    if (i === 0 && locale !== undefined && HEADLINE_OPENING_WORDS[locale].test(clean)) continue;
    const cps = Array.from(clean);
    if (cps.length >= 2 && PY_UPPER_RE.test(cps[0] ?? '') && !HEADLINE_STOP_CAPS.has(clean)) {
      if (
        !pyWordBoundarySearch(clean, grounding) &&
        !groundingStems.has(stemLoose(clean)) &&
        !(locale === 'pl' && isPolishCaseFormOfFact(clean, original, ctx)) &&
        !isOtherNameOfListingPlace(clean, grounding, locale)
      ) {
        return 'hallucinated_proper_name';
      }
    }
  }
  return null;
}

// ─── Output-contract check (`_body_violates_contract`, FOLLOW-188) ───────────

const BODY_LEAK_MARKERS: readonly string[] = [
  'my approach',
  'as an ai',
  'i cannot',
  'i will not',
  'i will write',
  'misalign',
  'ethically',
  'the facts do not support',
  'archetype',
];
const RESIDUAL_TAGS: readonly string[] = [
  '<adaptation_verdict',
  '<verified_facts_used',
  '<neutral_reason',
];

/**
 * `_body_violates_contract`: residual control tags (case-insensitive; FOLLOW-1390 adds the model's
 * own `reasoning*` / `thinking*` / `effort*` tags, `lib/model-control-tags.ts`), then markdown (`**`
 * or a `#`-opened line), then the English leak markers, then (FOLLOW-1392, not in the Python) model
 * meta-commentary in en / pl / es (`lib/meta-commentary.ts`) as `meta_commentary`. Note that a
 * dangling `<verified_facts_used` opening tag is caught HERE as `residual_tag`, before the
 * generator's truncation tell can see it.
 */
export function bodyViolatesContract(body: string): ContractViolation | null {
  const bodyLower = body.toLowerCase();
  for (const tag of RESIDUAL_TAGS) if (bodyLower.includes(tag)) return 'residual_tag';
  // FOLLOW-1390: a leaked model-control tag (`<reasoning_effort>`, `<thinking>`, …).
  if (hasModelControlTag(body)) return 'residual_tag';
  if (body.includes('**')) return 'formatted_body';
  for (const line of pySplitlines(body))
    if (pyLstrip(line).startsWith('#')) return 'formatted_body';
  for (const marker of BODY_LEAK_MARKERS) if (bodyLower.includes(marker)) return 'leak_marker';
  // FOLLOW-1392: a note to the operator ("Correction: the first sentence above …"), en/pl/es.
  if (hasMetaCommentary(body)) return 'meta_commentary';
  return null;
}
