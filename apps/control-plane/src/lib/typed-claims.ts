/**
 * The typed claim check — FOLLOW-1311 slice 3. A number in copy is read together with what it
 * counts, measures or costs, and compared with what the listing states for THAT key: a bounded,
 * enumerated set of transformations, each with its source field. It is not a parser of free text:
 * what no recogniser sees falls through to the rules around it, and that limit is on record.
 *
 * THE PRINCIPLE: if the recogniser cannot tell, it passes. A false refusal costs real copy; a claim
 * this check cannot read is no worse off than before it.
 *
 * Exported for AC(1b) (FOLLOW-1345): {@link checkTypedClaims} returns every recognised claim of a
 * text with its verdict and the listing field that grounds it.
 *
 * The transformations, by code:
 *   - T1 same value and unit, reformatted ("$385,000" for "385000 USD"); another currency refused,
 *     a sale price as a rent refused, a rent as the price refused.
 *   - T2 an exact multiplier ("1,15 mln zł" for 1 150 000 PLN). Exact only: no rounding is admitted
 *     for money anywhere (CEO 2026-10-30).
 *   - T3 a number word and its digit, same key (`lib/count-claims.ts`).
 *   - T4 a year keeps its key: "renovated 2015" is refused for "built 2015".
 *   - T5 the same area-unit family, no conversion: "64 sq ft" is refused for "64 m²".
 *   - T6 translation, same key, and no derived count: the listing's stated count stands. On a
 *     listing that states only bedrooms any "N-room" is refused, the correct-looking +1 included,
 *     and the reverse; the prompt says the same (FOLLOW-1386).
 *   - T9 negation kept, narrowly: "no garage." is refused for a listing with a garage, only when
 *     nothing follows that changes the subject ("no garage included" passes).
 *   - T8 a closed entailment table for physical and tenure attributes (`lib/attribute-lexicon.ts`):
 *     "parterowy" for "ground-floor, one level" passes, "single-storey" for "single-family" is
 *     refused.
 *
 * A count is refused narrowly, so a part of the whole is no contradiction ("two bedrooms for the
 * children" of a three-bedroom home): a whole-property count must equal a stated value of its key;
 * a plain count must not exceed the largest. A key the listing mentions unreadably is unknown.
 *
 * A street address always passes (CEO 2026-10-30): it is masked in the copy and in the listing
 * before anything here reads either (`lib/street-address.ts`).
 *
 * Pure, no I/O.
 *
 * @module apps/control-plane/src/lib/typed-claims
 */

import { AMENITY_RES, asserted } from '@/lib/amenity-lexicon';
import { namesStudio, readCounts, unreadableCountKeys, type CountKey } from '@/lib/count-claims';
import { ATTRIBUTE_RES, assertedAttributes, groundsAttribute } from '@/lib/attribute-lexicon';
import { MULTIPLIER_WORDS, normaliseNumberGroups, readMultiplied } from '@/lib/number-groups';
import { isAddressField, maskListedAddressParts, maskStreetAddresses } from '@/lib/street-address';

/** Why a typed claim was refused. */
export type TypedViolation =
  | 'count_mismatch'
  | 'money_mismatch'
  | 'unit_mismatch'
  | 'year_mismatch'
  | 'negation_contradiction'
  | 'unsupported_attribute';

/** One place the listing's words come from. */
export interface ListingSource {
  readonly field: string;
  readonly text: string;
}

/** One recognised claim of a text, with its verdict. */
interface TypedClaimCheck {
  readonly kind: 'count' | 'money' | 'area' | 'year' | 'negation' | 'attribute';
  /** What the claim is about: `bedroom`, `EUR`, `m2`, `renovated`, `furnished`, the denied words. */
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
  const unknown = new Set<CountKey>();
  const add = (key: CountKey, value: number, field: string): void => {
    const values = facts.get(key) ?? new Map<number, string>();
    if (!values.has(value)) values.set(value, field);
    facts.set(key, values);
  };
  for (const { field, text: raw } of sources) {
    const value = normaliseNumberGroups(raw);
    for (const c of readCounts(value)) add(c.key, c.value, field);
    for (const key of unreadableCountKeys(value)) unknown.add(key);
    for (const m of value.matchAll(COUNT_FIELD_RE)) {
      add(m[1] ? 'bedroom' : m[2] ? 'bathroom' : 'room', Number(m[4]), field);
    }
    if (namesStudio(value)) {
      add('bedroom', 0, field);
      add('room', 1, field);
    }
  }
  return readCounts(text).map((c) => {
    const check = (violation: TypedViolation | null, source: string | null): TypedClaimCheck => ({
      kind: 'count',
      key: c.key,
      value: String(c.value),
      source,
      violation,
    });
    if (unknown.has(c.key)) return check(null, null);
    const own = facts.get(c.key);
    if (own?.has(c.value)) return check(null, own.get(c.value) ?? null);
    if (own !== undefined) {
      // "Room for two cars" on a one-car garage is no statement about the garage.
      if (c.key === 'car' && !c.compound) return check(null, null);
      // A plain count at or under the stated one may be a part of it.
      return c.compound || c.value > Math.max(...own.keys())
        ? check('count_mismatch', null)
        : check(null, null);
    }
    // T6: the key is not stated, the other one is: no derived count, in either direction.
    const other = c.key === 'room' ? 'bedroom' : c.key === 'bedroom' ? 'room' : null;
    if (other === null || unknown.has(other)) return check(null, null);
    const stated = facts.get(other);
    if (stated === undefined) return check(null, null);
    const crossedPlain = c.key === 'bedroom' && c.value >= 2 && stated.has(c.value);
    // "Eight rooms" on a two-bedroom: no reading of a part makes that many.
    const beyondAnyReading = c.key === 'room' && c.value > Math.max(...stated.keys()) + 3;
    return c.compound || crossedPlain || beyondAnyReading
      ? check('count_mismatch', null)
      : check(null, null);
  });
}

// ─── Money (T1, T2) ───────────────────────────────────────────────────────────

const CURRENCY_NAMES: readonly (readonly [string, string])[] = [
  ['EUR', '€|eur|euros?'],
  ['USD', 'us\\$|\\$|usd|d[oó]lar\\p{L}*|dollars?'],
  ['PLN', 'zł|zl|pln|złot\\p{L}*'],
  ['GBP', '£|gbp|funt\\p{L}*|pounds?|libras?'],
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
/** "€385,000", "US$ 1.15M", "USD 385000": symbols and upper-case codes only, never "zł 3". */
const MONEY_PREFIX_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${CURRENCY})[ \\u00a0]?${NUMBER}${MULTIPLIER}`,
  'giu',
);
const PREFIX_TOKEN_RE = /^(?:€|\$|£|US\$|EUR|USD|PLN|GBP)$/u;
/** "385000 USD", "949 tys. zł", "1,15 mln PLN". */
const MONEY_SUFFIX_RE = new RegExp(
  `${NO_DIGIT_BEFORE}${NUMBER}${MULTIPLIER}[ \\u00a0]?(${CURRENCY})(?![\\p{L}\\p{N}])`,
  'giu',
);
/**
 * A period that closes the money phrase. "/ year built 1998" and "/ rok budowy 2015" go on to say
 * something else, so they are no period, and if there is more after it the check cannot tell.
 */
const PERIOD_AFTER_RE =
  /^[ \u00a0]*(?:\/|per|a|an|each|za|na|al|por)?[ \u00a0]*(?:months?|mo|monthly|miesi[ąęa]\p{L}*|mies\.|mes|mensual\p{L}*|years?|yearly|annually|rok|rocznie|a[nñ]o|anual\p{L}*)(?=[ \u00a0]*(?:[.,;:!?)\n]|$))/iu;
/** The claim names the sale price right before its figure. */
const PRICE_WORD_BEFORE_RE =
  /(?<![\p{L}\p{N}])(?:prices?|priced at|listed at|asking|cena|precio)[ \u00a0:]*(?:of[ \u00a0]+|to[ \u00a0]+|wynosi[ \u00a0]+|de[ \u00a0]+)?$/iu;
const PRICE_FIELD_RE = /price|cena|precio/iu;
/** A number with no currency, the multiplier words included ("250", "1,15 mln"). */
/** A number that measures something, or names a place, is no sum of money. */
const MEASURED_NUMBER_RE =
  /(?<![\p{L}\p{N}.])\p{Nd}+(?:\.\p{Nd}+)?[ \u00a0]*(?:%|m|km|cm|ha|min|metr\p{L}*|meters?|metres?|kilomet\p{L}*|hectares?|hektar\p{L}*|minut\p{L}*|miles?|floors?|pi[eę]t\p{L}*|windows?|okn\p{L}*)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}.])\p{Nd}+[ \u00a0]+\p{Lu}\p{Ll}+/gu;
const YEAR_WORD_AFTER_RE = /^[ \u00a0]*(?:roku|rok|r\.)(?![\p{L}\p{N}])/iu;
const BARE_NUMBER_RE = new RegExp(
  `${NO_DIGIT_BEFORE}${NUMBER}(?:[ \\u00a0\\u202f\\u2009]?(${MULTIPLIER_WORDS})(?![\\p{L}\\p{N}]))?(?![\\p{L}\\p{N}%])`,
  'giu',
);

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
  readonly start: number;
  readonly end: number;
}

function readMoney(text: string): MoneyMention[] {
  const out: MoneyMention[] = [];
  for (const m of text.matchAll(MONEY_SUFFIX_RE)) {
    out.push({
      currency: CURRENCY_OF(m[3] ?? ''),
      value: moneyValue(m[1] ?? '', m[2]),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  for (const m of text.matchAll(MONEY_PREFIX_RE)) {
    if (!PREFIX_TOKEN_RE.test(m[1] ?? '')) continue;
    // "949 000 PLN 3 pokoje": that currency already closed a number.
    if (out.some((x) => m.index >= x.start && m.index < x.end)) continue;
    out.push({
      currency: CURRENCY_OF(m[1] ?? ''),
      value: moneyValue(m[2] ?? '', m[3]),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

function checkMoney(text: string, sources: readonly ListingSource[]): TypedClaimCheck[] {
  const facts: {
    currency: string | null;
    value: string;
    field: string;
    periodic: boolean;
    price: boolean;
  }[] = [];
  for (const { field, text: raw } of sources) {
    const value = normaliseNumberGroups(raw);
    const fieldIsPrice = PRICE_FIELD_RE.test(field);
    const money = readMoney(value);
    for (const m of money) {
      facts.push({
        currency: m.currency,
        value: m.value,
        field,
        periodic: PERIOD_AFTER_RE.test(value.slice(m.end)),
        price: fieldIsPrice || PRICE_WORD_BEFORE_RE.test(value.slice(0, m.start)),
      });
    }
    // Numbers with no currency: the listing states the number, not its unit, so a copy that adds
    // one cannot be told wrong ("250 a month", "Cena 1,15 mln."). Areas are not sums of money.
    const blank = (s: string): string => ' '.repeat(s.length);
    let bare = value.replace(AREA_RE, blank).replace(MEASURED_NUMBER_RE, blank);
    for (const c of readCounts(bare)) {
      if (c.digit)
        bare = bare.slice(0, c.start) + blank(bare.slice(c.start, c.end)) + bare.slice(c.end);
    }
    bare = bare.replace(YEAR_RE, (y: string, _g: string, at: number, whole: string) =>
      yearKey(whole, at, at + y.length) !== null ||
      YEAR_WORD_AFTER_RE.test(whole.slice(at + y.length))
        ? blank(y)
        : y,
    );
    for (const m of [...money].sort((a, b) => b.start - a.start)) {
      bare = bare.slice(0, m.start) + ' '.repeat(m.end - m.start) + bare.slice(m.end);
    }
    for (const m of bare.matchAll(BARE_NUMBER_RE)) {
      const end = m.index + m[0].length;
      facts.push({
        currency: null,
        value: moneyValue(m[1] ?? '', m[2]),
        field,
        periodic: PERIOD_AFTER_RE.test(bare.slice(end)),
        price: fieldIsPrice || PRICE_WORD_BEFORE_RE.test(bare.slice(0, m.index)),
      });
    }
  }
  // A number the listing gives a currency elsewhere has that currency: "cena 385 000" and
  // "385000 EUR" are one sum, and neither says dollars.
  const withCurrency = new Set(facts.filter((f) => f.currency !== null).map((f) => f.value));
  for (let i = facts.length - 1; i >= 0; i -= 1) {
    const fact = facts[i];
    if (fact?.currency === null && withCurrency.has(fact.value)) facts.splice(i, 1);
  }
  const prices = new Set(facts.filter((f) => f.price).map((f) => f.value));
  return readMoney(text).map((c) => {
    const check = (violation: TypedViolation | null, source: string | null): TypedClaimCheck => ({
      kind: 'money',
      key: c.currency ?? 'unknown',
      value: c.value,
      source,
      violation,
    });
    const own = facts.filter(
      (f) => f.value === c.value && (f.currency === c.currency || f.currency === null),
    );
    if (own.length === 0) return check('money_mismatch', null);
    // The sale price written as a monthly or a yearly figure.
    const periodic = PERIOD_AFTER_RE.test(text.slice(c.end));
    if (periodic && own.some((f) => f.price) && !own.some((f) => f.periodic)) {
      return check('money_mismatch', null);
    }
    // A rent or a fee written as the sale price.
    const namedPrice = PRICE_WORD_BEFORE_RE.test(text.slice(0, c.start));
    if (namedPrice && prices.size > 0 && !prices.has(c.value)) return check('money_mismatch', null);
    return check(null, own[0]?.field ?? null);
  });
}

// ─── Area (T5) ────────────────────────────────────────────────────────────────

const M2 =
  'm²|m2|sq\\.?\\s?m|sqm|square\\s+met(?:re|er)s?|mkw|m\\.?\\s?kw|metr\\p{L}*\\s+kwadratow\\p{L}*|metros?\\s+cuadrados?';
const FT2 =
  'sq\\.?\\s?ft|sqft|square\\s+f(?:ee|oo)t|st[oó]p\\p{L}*\\s+kwadratow\\p{L}*|pies\\s+cuadrados';
/** The lookbehind keeps a long digit run from being retried at every position. */
const AREA_RE = new RegExp(
  `(?<![\\p{Nd}.,])(\\p{Nd}[\\p{Nd}.,]*)\\s*(?:(${M2})|(${FT2}))(?![\\p{L}\\p{N}])`,
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
    const own = facts.find((f) => f.value === value && (f.family === family || f.family === null));
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
/** An act: the nearest one says what the year is. */
const RENOVATED =
  'renovat\\p{L}*|refurbish\\p{L}*|restor\\p{L}*|remont\\p{L}*|wyremontowan\\p{L}*|odnowion\\p{L}*|reform\\p{L}*|rehabilit\\p{L}*';
const BUILT_ACT =
  'built|construct\\p{L}*|rok budowy|budowy|wybudowan\\p{L}*|zbudowan\\p{L}*|oddan\\p{L}*|construi\\p{L}*|construcci[oó]n';
/** A building noun: only says "built" when no act does ("budynek z 2019", "a 2019 building"). */
const BUILDING_NOUN = 'building|kamienic\\p{L}*|budyn\\p{L}*|edificio';
const ACT_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:(${RENOVATED})|(${BUILT_ACT}))(?![\\p{L}\\p{N}])`,
  'giu',
);
const BUILDING_NOUN_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${BUILDING_NOUN})(?![\\p{L}\\p{N}])`,
  'iu',
);
const WORD_AFTER_RE = new RegExp(
  `^\\s+(?:(${RENOVATED})|(${BUILT_ACT}|${BUILDING_NOUN}))(?![\\p{L}\\p{N}])`,
  'iu',
);
const YEAR_REACH = 40;

/** The key of the year at `[start, end)`: right after it, else the nearest act, else a noun. */
function yearKey(text: string, start: number, end: number): 'renovated' | 'built' | null {
  const next = WORD_AFTER_RE.exec(text.slice(end, end + 30));
  if (next !== null) return next[1] ? 'renovated' : 'built';
  const before = text.slice(Math.max(0, start - YEAR_REACH), start);
  const clause = before.slice(before.search(/[^.;,\n]*$/u));
  const act = Array.from(clause.matchAll(ACT_RE)).at(-1);
  if (act !== undefined) return act[1] ? 'renovated' : 'built';
  return BUILDING_NOUN_RE.test(clause) ? 'built' : null;
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
    out.push({
      kind: 'year',
      key,
      value: year,
      source: own?.field ?? null,
      violation: same.length > 0 && own === undefined ? 'year_mismatch' : null,
    });
  }
  return out;
}

// ─── Negation (T9) ────────────────────────────────────────────────────────────

/** A negator DIRECTLY before the amenity, with at most an article between them. */
const DENIED_BEFORE_RE =
  /(?<![\p{L}\p{N}_])(?:no|without|lacks?|has no|there is no|there['’]s no|does not have|doesn['’]t have|bez|brak|braku|nie ma|nie posiada|sin|no hay|no tiene|carece de)(?:[ \t]+(?:a|an|any|the|żadnego|żadnej|żadnych|ningún|ninguna|un|una))?[ \t]+$/iu;
/**
 * Nothing that changes the subject follows: "no garage." denies the garage; "no garage included",
 * "no pool to maintain", "no parking permit needed" and "no school commute" do not. A closed
 * location phrase and one more item keep the denial ("no lift in the building", "no balcony or
 * terrace"). "No garage? No problem." and "no pool, no problem" are a shrug, not a denial.
 */
const CLAUSE_ENDS_RE =
  /^(?:[ \t]+(?:or|ani|ni|o)[ \t]+[\p{L}-]+)?(?:[ \t]+(?:here|tu|aquí|in the building|on the property|in this building|w budynku|na terenie|en el edificio))?[ \t]*(?:[.,;:)–—\n!]|$)/iu;
const NO_PROBLEM_AFTER_RE =
  /^[ \t]*[?,.!–—:-]*[ \t]*(?:no problem|bez problemu|sin problema|no worries)/iu;
/** "Garage not included in the price" asserts no garage. */
const NOT_INCLUDED_RE =
  /[\p{L}-]+[ \t]+(?:(?:is[ \t]+)?not included|nie wchodzi\p{L}*|nie jest w cenie|no incluid\p{L}*|no está incluid\p{L}*)/giu;
/** A spec line with nothing after the negator: "Pool: no.". "Parking: no permit needed" is not. */
const SPEC_DENIED_AFTER_RE =
  /^(?:[ \t]*[:–—-][ \t]*(?:brak|nie|no|none|sin|ninguno|ninguna)|[ \t]+brak)[ \t]*(?:[.,;!?\n]|$)/iu;

function checkNegations(text: string, sources: readonly ListingSource[]): TypedClaimCheck[] {
  const withoutExcluded = (t: string): string =>
    t.replace(NOT_INCLUDED_RE, (x) => ' '.repeat(x.length));
  const listing = withoutExcluded(sources.map((s) => s.text).join('\n'));
  const out: TypedClaimCheck[] = [];
  for (const { claim, grounding } of AMENITY_RES) {
    for (const m of text.matchAll(claim)) {
      const rest = text.slice(m.index + m[0].length);
      const denied =
        (DENIED_BEFORE_RE.test(text.slice(0, m.index)) &&
          CLAUSE_ENDS_RE.test(rest) &&
          !NO_PROBLEM_AFTER_RE.test(rest)) ||
        SPEC_DENIED_AFTER_RE.test(rest);
      if (!denied) continue;
      const contradicted = asserted(grounding, listing);
      out.push({
        kind: 'negation',
        key: m[0].toLowerCase(),
        value: 'none',
        source: contradicted
          ? (sources.find((s) => asserted(grounding, withoutExcluded(s.text)))?.field ?? null)
          : null,
        violation: contradicted ? 'negation_contradiction' : null,
      });
    }
  }
  return out;
}

// ─── Attributes (T8) ──────────────────────────────────────────────────────────

function checkAttributes(text: string, sources: readonly ListingSource[]): TypedClaimCheck[] {
  const listing = sources.map((s) => s.text).join('\n');
  return ATTRIBUTE_RES.flatMap((attribute) => {
    const claims = assertedAttributes(attribute.claim, text);
    if (claims.length === 0) return [];
    const grounded = groundsAttribute(attribute, listing);
    const source = grounded
      ? (sources.find((s) => groundsAttribute(attribute, s.text))?.field ?? null)
      : null;
    return claims.map(
      (value): TypedClaimCheck => ({
        kind: 'attribute',
        key: attribute.key,
        value,
        source,
        violation: grounded ? null : 'unsupported_attribute',
      }),
    );
  });
}

// ─── The check ────────────────────────────────────────────────────────────────

/**
 * Every typed claim of `text`, each with its verdict and the listing field that grounds it. Street
 * addresses are masked on both sides first, and an address field is no source of typed facts.
 *
 * @param text - Generated copy, as written.
 * @param sources - The listing's own words, by field, without the fields that say "no".
 * @returns The claims, counts first; an empty list when no recogniser saw anything.
 */
export function checkTypedClaims(
  text: string,
  sources: readonly ListingSource[],
): TypedClaimCheck[] {
  const addresses = sources
    .filter((s) => isAddressField(s.field))
    .map((s) => s.text.slice(s.text.indexOf(':') + 1));
  const masked = sources
    .filter((s) => !isAddressField(s.field))
    .map((s) => ({ field: s.field, text: maskStreetAddresses(s.text) }));
  const copy = maskStreetAddresses(maskListedAddressParts(text, addresses));
  const normalised = normaliseNumberGroups(copy);
  return [
    ...checkCounts(normalised, masked),
    ...checkMoney(normalised, masked),
    ...checkAreas(normalised, masked),
    ...checkYears(copy, masked),
    ...checkNegations(copy, masked),
    ...checkAttributes(copy, masked),
  ];
}
