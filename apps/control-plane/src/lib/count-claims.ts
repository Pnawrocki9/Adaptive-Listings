/**
 * Counts with their key: "three-bedroom", "3 bed", "dwie sypialnie", "trzypokojowe", "two-car" —
 * FOLLOW-1311.
 *
 * A digit alone says nothing about what it counts, so the digit rule could not tell "3 bedrooms"
 * from "3 bathrooms", and refused "3 bedrooms" on a listing that spells it "three-bedroom". This
 * module reads a count together with its key, in en / pl / es, in digits or words, and is used by
 * both paths through `checkNumbers` (`lib/claim-rules.ts`).
 *
 * The keys are never interchanged: a Polish room count includes the living room, so "dwupokojowe"
 * is not "two-bedroom". Pure, no I/O.
 *
 * @module apps/control-plane/src/lib/count-claims
 */

/** What a count counts. */
export type CountKey = 'bedroom' | 'bathroom' | 'room' | 'car';

/** One count read from a text. */
interface CountMention {
  readonly key: CountKey;
  readonly value: number;
  /** `true` for a digit ("3 bedrooms"), `false` for a word or a compound ("three-bedroom"). */
  readonly digit: boolean;
  /** The number's own span, UTF-16. */
  readonly start: number;
  readonly end: number;
  /** One word for the property ("three-bedroom", "trzypokojowe"), not a phrase ("three bedrooms"). */
  readonly compound: boolean;
}

const WORDS: Readonly<Record<string, number>> = {
  // en
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  // pl
  jeden: 1,
  jedna: 1,
  jedno: 1,
  jedną: 1,
  dwa: 2,
  dwie: 2,
  dwóch: 2,
  dwoma: 2,
  dwiema: 2,
  trzy: 3,
  trzech: 3,
  trzema: 3,
  cztery: 4,
  czterech: 4,
  czterema: 4,
  pięć: 5,
  pięciu: 5,
  pięcioma: 5,
  sześć: 6,
  sześciu: 6,
  siedem: 7,
  osiem: 8,
  // es
  uno: 1,
  una: 1,
  un: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
};

/** A Polish compound's prefix: "dwupokojowe", "trzystanowiskowy". */
const POLISH_PREFIX: Readonly<Record<string, number>> = {
  jedno: 1,
  dwu: 2,
  trzy: 3,
  cztero: 4,
  pięcio: 5,
  sześcio: 6,
  siedmio: 7,
  ośmio: 8,
};

/** Each key across en / pl / es. "habitaciones" is the Spanish bedroom count of a listing. */
const KEY_PATTERNS: readonly (readonly [CountKey, string])[] = [
  ['bedroom', 'bed(?:s|rooms?|roomed)?|sypial\\p{L}*|dormitorios?|habitaci(?:ón|on|ones)'],
  ['bathroom', 'bath(?:s|rooms?)?|łazien\\p{L}*|baños?|banos?'],
  ['room', 'rooms?|pok[oó]j\\p{L}*|pokoi\\p{L}*'],
  ['car', 'cars?|samoch[oó]d\\p{L}*|aut(?:a|o)?|stanowisk\\p{L}*|coches?|veh[ií]culos?'],
];
const KEY_ALTERNATION = KEY_PATTERNS.map(([key, p]) => `(?<${key}>${p})`).join('|');

/** Adjectives that keep a count whole ("two separate bedrooms", "dwie osobne sypialnie"). */
const FILLER = '(?:(?:separate|osobn\\p{L}*|oddzieln\\p{L}*)[ \\u00a0]+)?';

const NUMBER_WORDS = Object.keys(WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|');

const PHRASE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}.,])(?:(?<digits>[0-9]{1,2})[- \\u00a0]?|(?<word>${NUMBER_WORDS})[- \\u00a0]+)` +
    `${FILLER}(?:${KEY_ALTERNATION})(?![\\p{L}\\p{N}])`,
  'giu',
);

const POLISH_COMPOUND_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?<prefix>${Object.keys(POLISH_PREFIX).join('|')})` +
    `(?:(?<room>pokojow\\p{L}*)|(?<car>stanowiskow\\p{L}*))(?![\\p{L}\\p{N}])`,
  'giu',
);

const KAWALERKA_RE = /(?<![\p{L}\p{N}])kawaler(?:k\p{L}*|ek)(?![\p{L}\p{N}])/giu;

/**
 * Every count of `text`, in the order found per pattern.
 *
 * @param text - A number-normalised text (`normaliseNumberGroups`).
 * @returns Every count with its key.
 */
export function readCounts(text: string): CountMention[] {
  const counts: CountMention[] = [];
  for (const m of text.matchAll(PHRASE_RE)) {
    const groups = m.groups ?? {};
    const key = KEY_PATTERNS.find(([k]) => groups[k] !== undefined)?.[0];
    if (key === undefined) continue;
    const digits = groups.digits;
    const number = digits ?? groups.word ?? '';
    const value = digits !== undefined ? Number(digits) : WORDS[number.toLowerCase()];
    if (value === undefined) continue;
    counts.push({
      key,
      value,
      digit: digits !== undefined,
      start: m.index,
      end: m.index + number.length,
      compound: text.charAt(m.index + number.length) === '-',
    });
  }
  for (const m of text.matchAll(POLISH_COMPOUND_RE)) {
    const groups = m.groups ?? {};
    const value = POLISH_PREFIX[(groups.prefix ?? '').toLowerCase()];
    if (value === undefined) continue;
    counts.push({
      key: groups.room !== undefined ? 'room' : 'car',
      value,
      digit: false,
      start: m.index,
      end: m.index + (groups.prefix ?? '').length,
      compound: true,
    });
  }
  for (const m of text.matchAll(KAWALERKA_RE)) {
    counts.push({
      key: 'room',
      value: 1,
      digit: false,
      start: m.index,
      end: m.index + m[0].length,
      compound: true,
    });
  }
  return counts;
}

/**
 * T3: blank out every DIGIT count of `text` the grounding states with the same key and value, in
 * digits or in words, so "3 bedrooms" passes on "three-bedroom" and "A 2-car garage" on "two-car".
 * The key must match: "3 sypialnie" on "trzypokojowe" stays for the digit rule to read.
 *
 * @param text - A number-normalised text.
 * @param grounding - A number-normalised grounding.
 * @returns `text` with each grounded digit count replaced by spaces of the same length.
 */
export function stripGroundedCounts(text: string, grounding: string): string {
  const grounded = new Set(readCounts(grounding).map((c) => `${c.key}:${String(c.value)}`));
  let out = text;
  for (const c of readCounts(text)) {
    if (!c.digit || !grounded.has(`${c.key}:${String(c.value)}`)) continue;
    out = out.slice(0, c.start) + ' '.repeat(c.end - c.start) + out.slice(c.end);
  }
  return out;
}
