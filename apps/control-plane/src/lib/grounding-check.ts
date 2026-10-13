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
 *   - the grounding text for the digit rule here is Python `json.dumps` with `ensure_ascii=True`,
 *     so a non-ASCII context value contributes the hex digits of its `\uXXXX` escape to the
 *     grounded digit set (an `é` in a context value grounds a `9`), and a non-ASCII proper name
 *     present only in `listing_context` is never found. Latent fail-open, inert while production
 *     sends `listing_context = {}`; carried to FOLLOW-1311.
 *
 * Python-semantics helpers (exported for the generator): Python's `str.strip()` / `str.split()` /
 * `str.splitlines()` whitespace sets differ from ECMAScript's; `len()` and slicing count code
 * points; `\b` and `\w` are Unicode-aware; `str.isupper()` is the Unicode `Uppercase` property.
 * Each helper names the Python call it stands in for.
 *
 * @module apps/control-plane/src/lib/grounding-check
 */

// ─── Violation codes (ADR-0023 §3) ────────────────────────────────────────────

export type NumberViolation = 'hallucinated_number';
export type FactViolation = NumberViolation | 'hallucinated_proper_name';
/** = `claim-containment.ts` `ClaimViolation`; restated here so this module has no adapt import. */
export type ClaimViolation = 'unsupported_amenity' | 'unsupported_guarantee' | 'unit_mismatch';
export type ContractViolation = 'residual_tag' | 'formatted_body' | 'leak_marker';

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
 */
export function pythonJsonDumps(obj: Readonly<Record<string, string>>, indent?: 2): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return '{}';
  const pairs = entries.map(([k, v]) => `${pyJsonString(k)}: ${pyJsonString(v)}`);
  if (indent === undefined) return `{${pairs.join(', ')}}`;
  return `{\n  ${pairs.join(',\n  ')}\n}`;
}

function pyJsonString(s: string): string {
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
    else if (unit < 0x20 || unit > 0x7e) out += `\\u${unit.toString(16).padStart(4, '0')}`;
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
 */
function checkNumbers(text: string, grounding: string): NumberViolation | null {
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

/** `(original_description + " " + json.dumps(listing_context)).lower()` — the digit-rule grounding. */
function factGrounding(original: string, ctx: Readonly<Record<string, string>>): string {
  return `${original} ${pythonJsonDumps(ctx)}`.toLowerCase();
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
/** `(?<![\w-])(?:…)(?![\w-])`, `re.IGNORECASE`. */
const AMENITY_RES: readonly RegExp[] = AMENITY_PATTERNS.map(
  (p) => new RegExp(`(?<![${PY_WORD}-])(?:${p})(?![${PY_WORD}-])`, 'giu'),
);
const NEGATOR_RE = new RegExp(`${B_START}(?:no|not|without|lacks?|lacking|nor)${B_END}`, 'iu');
const CLAUSE_BREAK_RE = /[.;:!?\n,]/gu;
const NEGATION_WINDOW = 30;

const GUARANTEE_RE = new RegExp(
  `${B_START}guarantee(?:d|s)?${B_END}|${B_START}risk[- ]free${B_END}|` +
    `${B_START}(?:no|zero)[- ]risk${B_END}|` +
    `${B_START}assured (?:income|returns?|yields?|rent)${B_END}`,
  'iu',
);
const NO_WORK_CLAIM_RE = new RegExp(
  `${B_START}(?:no|zero) (?:work|works|renovation|repairs?|refurbishment)${B_END}|` +
    `${B_START}(?:needs?|requires?) no (?:work|works|renovation|repairs?)${B_END}|` +
    `${B_START}nothing (?:here )?(?:needs|requires) (?:work|doing|fixing|renovat[${PY_WORD}]*)${B_END}|` +
    `${B_START}turn-?key${B_END}|${B_START}move[- ]in[- ]ready${B_END}|${B_START}ready to move in${B_END}`,
  'iu',
);
const CONDITION_FACT_RE = new RegExp(
  `${B_START}(?:fully|newly|recently|completely) (?:renovated|refurbished|restored)${B_END}|` +
    `${B_START}new[- ]build${B_END}|${B_START}newly built${B_END}|${B_START}turn-?key${B_END}|` +
    `${B_START}move[- ]in[- ]ready${B_END}|${B_START}ready to move in${B_END}|` +
    `${B_START}no work needed${B_END}`,
  'iu',
);

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

/** `_asserted`: at least one NON-negated match. */
function asserted(pattern: RegExp, text: string): boolean {
  for (const m of text.matchAll(pattern)) if (!isNegated(text, m.index)) return true;
  return false;
}

/** `_grounded_area_numbers`: numbers the listing states AS an area. */
function groundedAreaNumbers(
  grounding: string,
  ctx: Readonly<Record<string, string>>,
): Set<string> {
  const numbers = new Set<string>();
  for (const m of grounding.matchAll(AREA_NUMBER_RE)) numbers.add(canonNumber(m[1] ?? ''));
  for (const [key, value] of Object.entries(ctx)) {
    if (AREA_KEY_RE.test(key)) {
      for (const m of value.matchAll(FACT_CHECK_DIGIT_RE)) numbers.add(canonNumber(m[0]));
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

  for (const pattern of AMENITY_RES) {
    if (asserted(pattern, text) && !asserted(pattern, grounding)) return 'unsupported_amenity';
  }
  if (GUARANTEE_RE.test(text) && !GUARANTEE_RE.test(grounding)) return 'unsupported_guarantee';
  if (
    NO_WORK_CLAIM_RE.test(text) &&
    !(NO_WORK_CLAIM_RE.test(grounding) || CONDITION_FACT_RE.test(grounding))
  ) {
    return 'unsupported_guarantee';
  }
  const areaNumbers = groundedAreaNumbers(grounding, ctx);
  for (const m of text.matchAll(AREA_NUMBER_RE)) {
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
 * `_check_headline_facts`: digits, then the claim classes, then every capitalised word (first word
 * included) that is not a stop-cap must appear in the grounding whole (Unicode `\b`) or by loose
 * stem.
 */
export function checkHeadlineFacts(
  headline: string,
  original: string,
  ctx: Readonly<Record<string, string>>,
): FactViolation | ClaimViolation | null {
  const grounding = factGrounding(original, ctx);

  const numberViolation = checkNumbers(headline, grounding);
  if (numberViolation !== null) return numberViolation;

  const claimViolation = checkUnsupportedClaimsPy(headline, original, ctx);
  if (claimViolation !== null) return claimViolation;

  const groundingStems = new Set<string>();
  for (const m of grounding.matchAll(GROUNDING_WORD_RE)) groundingStems.add(stemLoose(m[0]));
  for (const word of pySplit(headline)) {
    const clean = pyRstripChars(word, '.,;:!?"\')');
    if (!clean) continue;
    const cps = Array.from(clean);
    if (cps.length >= 2 && PY_UPPER_RE.test(cps[0] ?? '') && !HEADLINE_STOP_CAPS.has(clean)) {
      if (!pyWordBoundarySearch(clean, grounding) && !groundingStems.has(stemLoose(clean))) {
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
 * `_body_violates_contract`: residual control tags (case-insensitive), then markdown (`**` or a
 * `#`-opened line), then the English leak markers. Note that a dangling `<verified_facts_used`
 * opening tag is caught HERE as `residual_tag`, before the generator's truncation tell can see it.
 */
export function bodyViolatesContract(body: string): ContractViolation | null {
  const bodyLower = body.toLowerCase();
  for (const tag of RESIDUAL_TAGS) if (bodyLower.includes(tag)) return 'residual_tag';
  if (body.includes('**')) return 'formatted_body';
  for (const line of pySplitlines(body))
    if (pyLstrip(line).startsWith('#')) return 'formatted_body';
  for (const marker of BODY_LEAK_MARKERS) if (bodyLower.includes(marker)) return 'leak_marker';
  return null;
}
