/**
 * The typed claim check — FOLLOW-1311 slice 3. A number in copy is read together with what it
 * counts, measures or costs, and compared with what the listing states for THAT key: a bounded,
 * enumerated set of transformations, each with its source field. It is not a parser of free text:
 * what no recogniser sees falls through to the rules around it, and that limit is on record.
 *
 * Exported for AC(1b) (FOLLOW-1345): {@link checkTypedClaims} returns every recognised claim of a
 * text with its verdict and the listing field that grounds it.
 *
 * The transformations, by code:
 *   - T1 same value and unit, reformatted ("$385,000" for "385000 USD"); another currency refused.
 *   - T2 an exact multiplier ("1,15 mln zł" for 1 150 000 PLN). Exact only: no rounding is admitted
 *     for money anywhere (CEO 2026-10-30).
 *   - T3 a number word and its digit, same key (`lib/count-claims.ts`).
 *   - T4 a year keeps its key: "renovated 2015" is refused for "built 2015".
 *   - T5 the same area-unit family, no conversion: "64 sq ft" is refused for "64 m²".
 *   - T6 translation, same key: "dwupokojowe" is a room count and is refused for "two-bedroom".
 *   - T9 negation kept: "no garage" is refused for a listing with a garage.
 *
 * Refused deliberately narrowly, so a subset is not a contradiction ("two bedrooms for the
 * children" of a three-bedroom home): a compound count must equal a stated value of its key; a
 * plain count must not exceed the largest. A street address is never read as a claim here.
 *
 * Pure, no I/O.
 *
 * @module apps/control-plane/src/lib/typed-claims
 */

import { AMENITY_RES, asserted, NEGATED_AFTER_RE } from '@/lib/amenity-lexicon';
import { readCounts, type CountKey } from '@/lib/count-claims';
import { MULTIPLIER_WORDS, normaliseNumberGroups, readMultiplied } from '@/lib/number-groups';

/** Why a typed claim was refused. */
export type TypedViolation =
  | 'count_mismatch'
  | 'money_mismatch'
  | 'unit_mismatch'
  | 'year_mismatch'
  | 'negation_contradiction';

/** One place the listing's words come from. */
export interface ListingSource {
  readonly field: string;
  readonly text: string;
}

/** One recognised claim of a text, with its verdict. */
interface TypedClaimCheck {
  readonly kind: 'count' | 'money' | 'area' | 'year' | 'negation';
  /** What the claim is about: `bedroom`, `EUR`, `m2`, `renovated`, or the denied words. */
  readonly key: string;
  readonly value: string;
  /** The listing field that grounds it; `null` when nothing does. */
  readonly source: string | null;
  readonly violation: TypedViolation | null;
}

// ─── Counts (T3, T6) ──────────────────────────────────────────────────────────

/** A spec line: the key first ("bedrooms: 3", "Sypialnie: 3"). */
const COUNT_FIELD_RE =
  /(?<![\p{L}\p{N}])(?:(bedrooms?|beds?|sypialni\p{L}*|dormitorios?)|(bathrooms?|baths?|łazien\p{L}*|baños?)|(rooms?|pokoje|pokoi|pok[oó]j))[ \t]*:[ \t]*([0-9]{1,2})(?![\p{L}\p{N}])/giu;

function checkCounts(text: string, sources: readonly ListingSource[]): TypedClaimCheck[] {
  const facts = new Map<CountKey, Map<number, string>>();
  const add = (key: CountKey, value: number, field: string): void => {
    const values = facts.get(key) ?? new Map<number, string>();
    if (!values.has(value)) values.set(value, field);
    facts.set(key, values);
  };
  for (const { field, text: value } of sources) {
    for (const c of readCounts(normaliseNumberGroups(value))) add(c.key, c.value, field);
    for (const m of value.matchAll(COUNT_FIELD_RE)) {
      add(m[1] ? 'bedroom' : m[2] ? 'bathroom' : 'room', Number(m[4]), field);
    }
  }
  return readCounts(text).map((c) => {
    const own = facts.get(c.key);
    const check = (violation: TypedViolation | null, source: string | null): TypedClaimCheck => ({
      kind: 'count',
      key: c.key,
      value: String(c.value),
      source,
      violation,
    });
    if (own?.has(c.value)) return check(null, own.get(c.value) ?? null);
    if (own !== undefined) {
      const largest = Math.max(...own.keys());
      // A plain count at or under the stated one may be a part of it.
      return c.compound || c.value > largest ? check('count_mismatch', null) : check(null, null);
    }
    // T6: the key is not stated, the other one is, with this very number.
    const other = c.key === 'room' ? 'bedroom' : c.key === 'bedroom' ? 'room' : null;
    const crossed = other !== null && facts.get(other)?.has(c.value) === true;
    const convention = c.key === 'room' ? c.compound : c.value >= 2;
    return crossed && convention ? check('count_mismatch', null) : check(null, null);
  });
}

// ─── Money (T1, T2) ───────────────────────────────────────────────────────────

const CURRENCY_NAMES: readonly (readonly [string, string])[] = [
  ['EUR', '€|eur|euros?'],
  ['USD', '\\$|usd|dolar\\p{L}*|dollars?'],
  ['PLN', 'zł|zl|pln|złot\\p{L}*'],
  ['GBP', '£|gbp|funt\\p{L}*|pounds?'],
];
const CURRENCY_OF = (token: string): string | null => {
  for (const [code, pattern] of CURRENCY_NAMES) {
    if (new RegExp(`^(?:${pattern})$`, 'iu').test(token)) return code;
  }
  return null;
};
const CURRENCY = CURRENCY_NAMES.map(([, p]) => p).join('|');
const NUMBER = '(\\p{Nd}+(?:\\.\\p{Nd}+)?)';
const MULTIPLIER = `(?:[ \\u00a0\\u202f\\u2009]?(${MULTIPLIER_WORDS}|k|K|M|m)(?![\\p{L}\\p{N}]))?`;
const NO_DIGIT_BEFORE = '(?<![\\p{L}\\p{N}.])';
/** "€385,000", "$ 1.15M". */
const MONEY_PREFIX_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${CURRENCY})[ \\u00a0]?${NUMBER}${MULTIPLIER}`,
  'giu',
);
/** "385000 USD", "949 tys. zł", "1,15 mln PLN". */
const MONEY_SUFFIX_RE = new RegExp(
  `${NO_DIGIT_BEFORE}${NUMBER}${MULTIPLIER}[ \\u00a0]?(${CURRENCY})(?![\\p{L}\\p{N}])`,
  'giu',
);
const PERIOD_AFTER_RE =
  /^[ \u00a0]*(?:\/|per|a|an|each|za|na|al|por)?[ \u00a0]*(?:month|mo|monthly|miesi[ąa]c\p{L}*|mies\.|mes|mensual\p{L}*|year|yearly|annually|rok|rocznie|a[nñ]o|anual\p{L}*)(?![\p{L}\p{N}])/iu;
/** A number the listing gives as money without naming a currency ("price: 400000", "rent 4,200"). */
const BARE_MONEY_RE = new RegExp(
  `(?:price|rent|fees?|charges?|tax|cost|cena|czynsz\\p{L}*|op[łl]at\\p{L}*|najem|koszt\\p{L}*|precio|alquiler|gastos|renta)` +
    `[^.;\\n\\p{Nd}]{0,20}${NUMBER}(?![\\p{L}\\p{N}])(?![ \\u00a0]?(?:${CURRENCY}))`,
  'giu',
);
const PRICE_FIELD_RE = /price|cena|precio/iu;

function moneyValue(number: string, multiplier: string | undefined): string {
  if (multiplier !== undefined) {
    const read = readMultiplied(number, multiplier);
    if (read !== null) return read.value.toString();
  }
  return number.includes('.') ? number.replace(/\.?0+$/u, '') : number;
}

interface MoneyMention {
  readonly currency: string | null;
  readonly value: string;
  readonly end: number;
}

function readMoney(text: string): MoneyMention[] {
  const out: MoneyMention[] = [];
  for (const m of text.matchAll(MONEY_PREFIX_RE)) {
    out.push({
      currency: CURRENCY_OF(m[1] ?? ''),
      value: moneyValue(m[2] ?? '', m[3]),
      end: m.index + m[0].length,
    });
  }
  for (const m of text.matchAll(MONEY_SUFFIX_RE)) {
    out.push({
      currency: CURRENCY_OF(m[3] ?? ''),
      value: moneyValue(m[1] ?? '', m[2]),
      end: m.index + m[0].length,
    });
  }
  return out;
}

function checkMoney(text: string, sources: readonly ListingSource[]): TypedClaimCheck[] {
  const facts: { currency: string | null; value: string; field: string }[] = [];
  for (const { field, text: raw } of sources) {
    const value = normaliseNumberGroups(raw);
    for (const m of readMoney(value)) facts.push({ ...m, field });
    for (const m of value.matchAll(BARE_MONEY_RE)) {
      facts.push({ currency: null, value: moneyValue(m[1] ?? '', undefined), field });
    }
  }
  return readMoney(text).map((c) => {
    const check = (violation: TypedViolation | null, source: string | null): TypedClaimCheck => ({
      kind: 'money',
      key: c.currency ?? 'unknown',
      value: c.value,
      source,
      violation,
    });
    const sameValue = facts.filter((f) => f.value === c.value);
    const own = sameValue.filter((f) => f.currency === c.currency || f.currency === null);
    if (own.length === 0) return check('money_mismatch', null);
    // The sale price written as a monthly or a yearly figure.
    const periodic = PERIOD_AFTER_RE.test(text.slice(c.end));
    if (periodic && own.every((f) => PRICE_FIELD_RE.test(f.field))) {
      return check('money_mismatch', null);
    }
    return check(null, own[0]?.field ?? null);
  });
}

// ─── Area (T5) ────────────────────────────────────────────────────────────────

const M2 =
  'm²|m2|sq\\.?\\s?m|sqm|square\\s+met(?:re|er)s?|mkw|m\\.?\\s?kw|metr\\p{L}*\\s+kwadratow\\p{L}*|metros?\\s+cuadrados?';
const FT2 =
  'sq\\.?\\s?ft|sqft|square\\s+f(?:ee|oo)t|st[oó]p\\p{L}*\\s+kwadratow\\p{L}*|pies\\s+cuadrados';
const AREA_RE = new RegExp(
  `(\\p{Nd}[\\p{Nd}.,]*)\\s*(?:(${M2})|(${FT2}))(?![\\p{L}\\p{N}])`,
  'giu',
);
const AREA_FIELD_RE = /area|size|sqm|sq_?ft|m2|surface|plot|floor_?space|footage/iu;

function canon(token: string): string {
  return token.replace(/[^0-9.]/gu, '').replace(/^\.+|\.+$/gu, '');
}

/**
 * The numbers `text` states with an area unit, the words only a Polish or Spanish text uses
 * included.
 *
 * @param text - A number-normalised text.
 * @returns Each number, canonical.
 */
export function readAreaNumbers(text: string): string[] {
  return Array.from(text.matchAll(AREA_RE), (m) => canon(m[1] ?? ''));
}

function checkAreas(text: string, sources: readonly ListingSource[]): TypedClaimCheck[] {
  const facts: { value: string; family: string | null; field: string }[] = [];
  for (const { field, text: raw } of sources) {
    const value = normaliseNumberGroups(raw);
    const found = Array.from(value.matchAll(AREA_RE));
    for (const m of found) {
      facts.push({ value: canon(m[1] ?? ''), family: m[2] ? 'm2' : 'ft2', field });
    }
    if (found.length === 0 && AREA_FIELD_RE.test(field)) {
      for (const m of value.matchAll(/\p{Nd}[\p{Nd}.,]*/gu)) {
        facts.push({ value: canon(m[0]), family: null, field });
      }
    }
  }
  return Array.from(text.matchAll(AREA_RE), (m) => {
    const value = canon(m[1] ?? '');
    const family = m[2] ? 'm2' : 'ft2';
    const same = facts.filter((f) => f.value === value);
    const own = same.find((f) => f.family === family || f.family === null);
    return {
      kind: 'area',
      key: family,
      value,
      source: own?.field ?? null,
      violation: own !== undefined ? null : ('unit_mismatch' as const),
    };
  });
}

// ─── Year (T4) ────────────────────────────────────────────────────────────────

const YEAR_RE = /(?<![\p{L}\p{N}.,])(1[5-9]\p{Nd}{2}|20\p{Nd}{2})(?![\p{L}\p{N}]|[.,]\p{Nd})/gu;
const BUILT =
  'built|construct\\p{L}*|rok budowy|wybudowan\\p{L}*|zbudowan\\p{L}*|oddan\\p{L}*|construi\\p{L}*|construcci[oó]n|building|kamienic\\p{L}*|budyn\\p{L}*|budowy';
const RENOVATED =
  'renovat\\p{L}*|refurbish\\p{L}*|restor\\p{L}*|remont\\p{L}*|wyremontowan\\p{L}*|odnowion\\p{L}*|reform\\p{L}*|rehabilit\\p{L}*';
const KEY_WORD_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:(${RENOVATED})|(${BUILT}))(?![\\p{L}\\p{N}])`,
  'giu',
);
const YEAR_REACH = 40;

/** The key of the year at `[start, end)`: the nearest key word before it, or directly after it. */
function yearKey(text: string, start: number, end: number): 'renovated' | 'built' | null {
  const before = text.slice(Math.max(0, start - YEAR_REACH), start);
  const clause = before.slice(before.search(/[^.;,\n]*$/u));
  const words = Array.from(clause.matchAll(KEY_WORD_RE));
  const last = words.at(-1);
  if (last !== undefined) return last[1] ? 'renovated' : 'built';
  const after = /^\s+(\p{L}+)/u.exec(text.slice(end, end + 30));
  if (after === null) return null;
  const next = new RegExp(`^(?:(${RENOVATED})|(${BUILT}))$`, 'iu').exec(after[1] ?? '');
  if (next === null) return null;
  return next[1] ? 'renovated' : 'built';
}

function checkYears(text: string, sources: readonly ListingSource[]): TypedClaimCheck[] {
  const facts: { year: string; key: string | null; field: string }[] = [];
  for (const { field, text: value } of sources) {
    for (const m of value.matchAll(YEAR_RE)) {
      facts.push({ year: m[1] ?? '', key: yearKey(value, m.index, m.index + m[0].length), field });
    }
  }
  const out: TypedClaimCheck[] = [];
  for (const m of text.matchAll(YEAR_RE)) {
    const key = yearKey(text, m.index, m.index + m[0].length);
    if (key === null) continue;
    const year = m[1] ?? '';
    const same = facts.filter((f) => f.year === year);
    const own = same.find((f) => f.key === key || f.key === null);
    const crossed = same.length > 0 && own === undefined;
    out.push({
      kind: 'year',
      key,
      value: year,
      source: own?.field ?? null,
      violation: crossed ? 'year_mismatch' : null,
    });
  }
  return out;
}

// ─── Negation (T9) ────────────────────────────────────────────────────────────

/** A negator DIRECTLY before the amenity: "no garage", "without a pool", "bez balkonu", "sin piscina". */
const DENIED_BEFORE_RE =
  /(?<![\p{L}\p{N}_])(?:no|without|lacks?|bez|brak|braku|nie ma|sin|carece de)(?:[ \t]+(?:a|an|any|the|żadnego|żadnej|żadnych|ningún|ninguna|un|una))?[ \t]+$/iu;
/** "no parking hassle", "bez problemów z parkingiem" is about the bother, not the amenity. */
const NOT_THE_AMENITY_AFTER_RE =
  /^[ \t]+(?:hassles?|problems?|issues?|worries|stress|fees?|charges?|kłopot\p{L}*|problem\p{L}*)(?![\p{L}\p{N}])/iu;

function checkNegations(text: string, sources: readonly ListingSource[]): TypedClaimCheck[] {
  const listing = sources.map((s) => s.text).join('\n');
  const out: TypedClaimCheck[] = [];
  for (const { claim, grounding } of AMENITY_RES) {
    for (const m of text.matchAll(claim)) {
      const rest = text.slice(m.index + m[0].length);
      const denied =
        (DENIED_BEFORE_RE.test(text.slice(0, m.index)) && !NOT_THE_AMENITY_AFTER_RE.test(rest)) ||
        NEGATED_AFTER_RE.test(rest);
      if (!denied) continue;
      const contradicted = asserted(grounding, listing);
      const source = contradicted
        ? (sources.find((s) => asserted(grounding, s.text))?.field ?? null)
        : null;
      out.push({
        kind: 'negation',
        key: m[0].toLowerCase(),
        value: 'none',
        source,
        violation: contradicted ? 'negation_contradiction' : null,
      });
    }
  }
  return out;
}

// ─── The check ────────────────────────────────────────────────────────────────

/**
 * Every typed claim of `text`, each with its verdict and the listing field that grounds it.
 *
 * @param text - Generated copy, as written.
 * @param sources - The listing's own words, by field, without the fields that say "no".
 * @returns The claims, counts first; an empty list when no recogniser saw anything.
 */
export function checkTypedClaims(
  text: string,
  sources: readonly ListingSource[],
): TypedClaimCheck[] {
  const normalised = normaliseNumberGroups(text);
  return [
    ...checkCounts(normalised, sources),
    ...checkMoney(normalised, sources),
    ...checkAreas(normalised, sources),
    ...checkYears(text, sources),
    ...checkNegations(text, sources),
  ];
}
