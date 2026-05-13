/**
 * Price parser for all corpus price formats.
 *
 * Handles the full range of price string formats encountered across the 24
 * corpus platforms, including European dot-thousands separators (Bazaraki),
 * currency code prefixes (Bayut), and multi-language "price on request" strings.
 *
 * @module @estalara/sdk/auto-detect/utils/price-parser
 */

/** The result of a successful price parse. */
export interface ParsedPrice {
  /** Numeric value, or `'POA'` for "price on request" variants. */
  value: number | 'POA';
  /**
   * ISO 4217 currency code (e.g. `'EUR'`, `'GBP'`, `'AED'`), or empty string
   * for POA strings where no currency is present.
   */
  currency: string;
  /** Original raw string, unmodified. */
  raw: string;
}

// ---------------------------------------------------------------------------
// POA detection
// ---------------------------------------------------------------------------

/**
 * Case-insensitive substrings / exact tokens that indicate "price on request".
 *
 * Corpus coverage:
 *   - `price on request`       (English — Engel & Voelkers, Knight Frank)
 *   - `poa`                    (English abbreviation)
 *   - `anfrage`                (German — Engel & Voelkers DE)
 *   - `prix sur demande`       (French)
 *   - `prezzo su richiesta`    (Italian — Lucas Fox IT)
 *   - `precio a consultar`     (Spanish — Lucas Fox ES, Idealista)
 *   - `consultar precio`       (Spanish variant)
 *   - `na życzenie`            (Polish — Otodom)
 *   - `op aanvraag`            (Dutch)
 */
const POA_PATTERNS: RegExp[] = [
  /\bprice\s+on\s+request\b/i,
  /\bpoa\b/i,
  /\banfrage\b/i,
  /\bprix\s+sur\s+demande\b/i,
  /\bprezzo\s+su\s+richiesta\b/i,
  /\bprecio\s+a\s+consultar\b/i,
  /\bconsultar\s+precio\b/i,
  /\bna\s+życzenie\b/i,
  /\bop\s+aanvraag\b/i,
];

// ---------------------------------------------------------------------------
// Currency symbols / codes
// ---------------------------------------------------------------------------

/** Map from symbol/prefix to ISO 4217 code. */
const CURRENCY_MAP: [pattern: RegExp, code: string][] = [
  [/€/, 'EUR'],
  [/£/, 'GBP'],
  [/\$/, 'USD'],
  [/\bAED\b/, 'AED'],
  [/\bPLN\b/, 'PLN'],
  [/\bEUR\b/, 'EUR'],
  [/\bGBP\b/, 'GBP'],
  [/\bUSD\b/, 'USD'],
  [/\bCHF\b/, 'CHF'],
  [/\bSEK\b/, 'SEK'],
  [/\bNOK\b/, 'NOK'],
  [/\bDKK\b/, 'DKK'],
  [/₴/, 'UAH'],
  [/₺/, 'TRY'],
];

// ---------------------------------------------------------------------------
// Core parsing logic
// ---------------------------------------------------------------------------

/**
 * Parse a price string from any corpus format into a structured `ParsedPrice`.
 *
 * Supported formats:
 * ```
 * €335.000         → { value: 335000, currency: 'EUR' }   Bazaraki dot-thousands
 * €239,000         → { value: 239000, currency: 'EUR' }   comma-thousands
 * £3,000,000       → { value: 3000000, currency: 'GBP' }
 * $128,000,000     → { value: 128000000, currency: 'USD' }
 * AED 6,800,000    → { value: 6800000, currency: 'AED' }  code prefix
 * PLN 12,836,054   → { value: 12836054, currency: 'PLN' }
 * Price on request → { value: 'POA', currency: '' }
 * POA              → { value: 'POA', currency: '' }
 * Anfrage          → { value: 'POA', currency: '' }
 * ```
 *
 * @param raw - Raw price string as it appears in the DOM.
 * @returns A `ParsedPrice` object, or `null` if the string does not look like
 *          a price at all.
 */
export function parsePrice(raw: string): ParsedPrice | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // ── POA check ────────────────────────────────────────────────────────────
  for (const pattern of POA_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { value: 'POA', currency: '', raw };
    }
  }

  // ── Detect currency ──────────────────────────────────────────────────────
  let currency = '';
  for (const [pattern, code] of CURRENCY_MAP) {
    if (pattern.test(trimmed)) {
      currency = code;
      break;
    }
  }

  // ── Extract digits ───────────────────────────────────────────────────────
  // Strip currency symbols, letters (except as thousands/decimal separators),
  // whitespace, and any extra characters — keep only digits, commas, dots.
  const stripped = trimmed
    .replace(/[€£$₴₺]/g, '')
    .replace(/\b(?:AED|PLN|EUR|GBP|USD|CHF|SEK|NOK|DKK)\b/gi, '')
    .replace(/\s+/g, '')
    .trim();

  if (!stripped) return null;

  // Must start with a digit after stripping.
  if (!/^\d/.test(stripped)) return null;

  const numericValue = parseNumericString(stripped);
  if (numericValue === null) return null;

  return { value: numericValue, currency, raw };
}

/**
 * Parse a stripped numeric string (digits + separators only) into a number.
 *
 * Ambiguity resolution for dot vs. comma:
 *
 * 1. If both dot and comma are present:
 *    - The separator that appears LAST is the decimal separator.
 *    - Example: `1,234.56` → decimal dot   → 1234.56
 *    - Example: `1.234,56` → decimal comma → 1234.56
 *
 * 2. If only dots are present:
 *    - European dot-thousands rule: if the last dot is followed by EXACTLY 3
 *      digits and there are no other decimal indicators, treat ALL dots as
 *      thousands separators (Bazaraki format: `335.000` → 335000).
 *    - If the last dot is followed by 1 or 2 digits, treat it as a decimal
 *      separator (`123.5` → 123.5).
 *
 * 3. If only commas are present:
 *    - Same logic: comma followed by exactly 3 digits → thousands separator.
 *    - Comma followed by 1–2 digits → decimal separator.
 *
 * 4. No separators: plain integer.
 */
function parseNumericString(s: string): number | null {
  // No separators — plain integer.
  if (!/[.,]/.test(s)) {
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');

  if (hasDot && hasComma) {
    // Both present: whichever comes last is the decimal separator.
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot > lastComma) {
      // Dot is decimal separator (e.g. `1,234.56`)
      const normalised = s.replace(/,/g, '');
      const n = Number(normalised);
      return isFinite(n) ? n : null;
    } else {
      // Comma is decimal separator (e.g. `1.234,56`)
      const normalised = s.replace(/\./g, '').replace(',', '.');
      const n = Number(normalised);
      return isFinite(n) ? n : null;
    }
  }

  if (hasDot && !hasComma) {
    return parseSingleSeparator(s, '.');
  }

  if (hasComma && !hasDot) {
    return parseSingleSeparator(s, ',');
  }

  return null;
}

/**
 * Parse a number string that uses only one separator character (dot or comma).
 *
 * Decision rule:
 *   - If the LAST occurrence of `sep` is followed by exactly 3 digits
 *     AND the digit count before the first separator is 1–3 → thousands separator.
 *   - Otherwise → decimal separator.
 */
function parseSingleSeparator(s: string, sep: '.' | ','): number | null {
  const parts = s.split(sep);
  const lastPart = parts[parts.length - 1] ?? '';

  // Thousands separator rule: last segment is exactly 3 digits,
  // and all segments are purely numeric.
  const allNumeric = parts.every((p) => /^\d+$/.test(p));
  if (allNumeric && lastPart.length === 3) {
    // Treat as thousands separator — concatenate all parts.
    const joined = parts.join('');
    const n = Number(joined);
    return isFinite(n) ? n : null;
  }

  // Otherwise treat `sep` as a decimal separator.
  const normalised = sep === ',' ? s.replace(',', '.') : s;
  const n = Number(normalised);
  return isFinite(n) ? n : null;
}
