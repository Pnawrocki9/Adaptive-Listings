/**
 * Counts with their key: "three-bedroom", "3 bed", "dwie sypialnie", "trzypokojowe", "two-car" —
 * FOLLOW-1311.
 *
 * A digit alone says nothing about what it counts, so the digit rule could not tell "3 bedrooms"
 * from "3 bathrooms", and refused "3 bedrooms" on a listing that spells it "three-bedroom". This
 * module reads a count together with its key, in en / pl / es, in digits or words, and is used by
 * both paths through `checkNumbers` (`lib/claim-rules.ts`) and `lib/typed-claims.ts`.
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
  /**
   * A statement about the whole property: one word ("three-bedroom", "trzypokojowe"), a singular
   * noun ("two bedroom home"), or a spec list ("3 bedrooms and 2 bathrooms"). A plain phrase ("two
   * bedrooms") may be a part of the whole.
   */
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
  nine: 9,
  ten: 10,
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
  sześcioma: 6,
  siedem: 7,
  osiem: 8,
  dziewięć: 9,
  dziesięć: 10,
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
  nueve: 9,
  diez: 10,
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
  ['bedroom', 'bed(?:s|rooms?|roomed)?|br|bd|sypial\\p{L}*|dormitorios?|habitaci(?:ón|on|ones)'],
  ['bathroom', 'bath(?:s|rooms?)?|ba|łazien\\p{L}*|baños?|banos?'],
  ['room', 'rooms?|pok[oó]j\\p{L}*|pokoi\\p{L}*'],
  ['car', 'cars?|samoch[oó]d\\p{L}*|aut(?:a|o)?|stanowisk\\p{L}*|coches?|veh[ií]culos?'],
];
const KEY_ALTERNATION = KEY_PATTERNS.map(([key, p]) => `(?<${key}>${p})`).join('|');

const SPACE = '[ \\u00a0]';
const NUMBER_WORDS = Object.keys(WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const NUMBER_TOKEN = `(?:[0-9]{1,2}|${NUMBER_WORDS})`;

/**
 * Up to two adjectives between the number and the noun ("Four spacious bedrooms", "Pięć dużych
 * sypialni"), never a word that opens another phrase.
 */
const NOT_AN_ADJECTIVE =
  'the|and|for|from|with|per|about|near|that|which|are|has|have|was|were|floors?|minutes?|years?|' +
  'lub|albo|oraz|dla|przy|jest|są|con|para|por|desde|los|las|del|una|uno';
const ADJECTIVE = `(?!(?:${NOT_AN_ADJECTIVE})${SPACE})[\\p{L}-]{3,}`;

const PHRASE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}.,])(?:(?<digits>[0-9]{1,2})[- \\u00a0]?|(?<word>${NUMBER_WORDS})[- \\u00a0]+)` +
    `(?<filler>(?:${ADJECTIVE}${SPACE}+){0,2})(?:${KEY_ALTERNATION})(?![\\p{L}\\p{N}])`,
  'giu',
);
/** A range: "2-3 bedroom apartments", "two to three bedrooms", "dwa lub trzy pokoje". */
const RANGE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}.,])${NUMBER_TOKEN}${SPACE}*(?:-|–|—|to|or|lub|albo|do|o)${SPACE}*${NUMBER_TOKEN}[- \\u00a0]*` +
    `(?:[\\p{L}-]+${SPACE}+)?(?:${KEY_ALTERNATION})(?![\\p{L}\\p{N}])`,
  'giu',
);
/** No number at all: "several bedrooms", "kilka pokoi". */
const VAGUE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:several|multiple|many|various|kilka|kilku|wiele|varios|varias)${SPACE}+` +
    `(?:[\\p{L}-]+${SPACE}+)?(?:${KEY_ALTERNATION})(?![\\p{L}\\p{N}])`,
  'giu',
);
/**
 * A part named without a count of the whole ("one of the bedrooms", "jedna z sypialni", "una de las
 * habitaciones"), or a number and its noun with too many adjectives to read ("Three very large
 * sunny bedrooms"). A clause that goes on to something else ("two floors with bedrooms") is neither.
 */
const PART_OF_RE = new RegExp(
  `(?<![\\p{L}\\p{N}.,])${NUMBER_TOKEN}${SPACE}+(?:of${SPACE}+(?:the|these|its)|z|de${SPACE}+(?:las|los))${SPACE}+(?:KEYSLOT)`.replace(
    'KEYSLOT',
    KEY_ALTERNATION,
  ) + `(?![\\p{L}\\p{N}])`,
  'giu',
);
const MANY_ADJECTIVES_RE = new RegExp(
  `(?<![\\p{L}\\p{N}.,])${NUMBER_TOKEN}${SPACE}+(?:${ADJECTIVE}${SPACE}+){3,4}(?:${KEY_ALTERNATION})(?![\\p{L}\\p{N}])`,
  'giu',
);
const POLISH_COMPOUND_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?<prefix>${Object.keys(POLISH_PREFIX).join('|')})` +
    `(?:(?<room>pokojow\\p{L}*)|(?<car>stanowiskow\\p{L}*))(?![\\p{L}\\p{N}])`,
  'giu',
);
const KAWALERKA_RE = /(?<![\p{L}\p{N}])kawaler(?:k\p{L}*|ek)(?![\p{L}\p{N}])/giu;
/**
 * The property noun: "Studio apartment", "Studio, Albufeira", "kawalerka". Never a room of a bigger
 * home ("yoga studio", "a garden studio").
 */
const STUDIO_RE =
  /(?<![\p{L}\p{N}])kawaler(?:k\p{L}*|ek)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:studio|estudio)[ \u00a0]+(?:apartment|flat|apartamento|piso)(?![\p{L}\p{N}])|(?:^|[.;:!?\n][ \u00a0]*)(?:(?:a|an|el|un)[ \u00a0]+)?(?:studio|estudio)(?=[ \u00a0]*(?:$|[.,;:—–-]|(?:in|w|en|de|of|o|na|przy)[ \u00a0]))/iu;
const SPEC_JOIN_RE = /^[ \u00a0]*(?:,|\/|\+|&|and|oraz|i|y|·|\|)[ \u00a0]*$/iu;
const SINGULAR_KEY_RE = /^(?:bed|bedroom|bath|bathroom|room)$/iu;
/** Only a spec attached to a digit: "3BR/2BA". */
const ABBREVIATED_KEY_RE = /^(?:br|bd|ba)$/iu;

function keyOf(groups: Record<string, string | undefined>): CountKey | undefined {
  return KEY_PATTERNS.find(([k]) => groups[k] !== undefined)?.[0];
}

/**
 * Every count of `text`.
 *
 * @param text - A number-normalised text.
 * @returns Every count with its key, in text order. A range is no count.
 */
export function readCounts(text: string): CountMention[] {
  const counts: (CountMention & { nounEnd: number })[] = [];
  const ranges = Array.from(text.matchAll(RANGE_RE), (m) => [m.index, m.index + m[0].length]);
  for (const m of text.matchAll(PHRASE_RE)) {
    if (ranges.some(([s = 0, e = 0]) => m.index >= s && m.index < e)) continue;
    const groups = m.groups ?? {};
    const key = keyOf(groups);
    if (key === undefined) continue;
    const digits = groups.digits;
    const number = digits ?? groups.word ?? '';
    const value = digits !== undefined ? Number(digits) : WORDS[number.toLowerCase()];
    if (value === undefined) continue;
    const noun = groups[key] ?? '';
    // "Two beds in the guest room" is furniture; "2 beds" is a spec.
    if (digits === undefined && (/^beds$/iu.test(noun) || ABBREVIATED_KEY_RE.test(noun))) continue;
    counts.push({
      key,
      value,
      digit: digits !== undefined,
      start: m.index,
      end: m.index + number.length,
      compound:
        text.charAt(m.index + number.length) === '-' ||
        (value >= 2 && (groups.filler ?? '') === '' && SINGULAR_KEY_RE.test(noun)),
      nounEnd: m.index + m[0].length,
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
      nounEnd: m.index + m[0].length,
    });
  }
  for (const m of text.matchAll(KAWALERKA_RE)) {
    const end = m.index + m[0].length;
    counts.push({
      key: 'room',
      value: 1,
      digit: false,
      start: m.index,
      end,
      compound: true,
      nounEnd: end,
    });
  }
  counts.sort((x, y) => x.start - y.start);
  // A spec list states the whole property: "3 bedrooms and 3 bathrooms".
  return counts.map((c, i) => {
    const next = counts[i + 1];
    const prev = counts[i - 1];
    const listed =
      (next !== undefined && SPEC_JOIN_RE.test(text.slice(c.nounEnd, next.start))) ||
      (prev !== undefined && SPEC_JOIN_RE.test(text.slice(prev.nounEnd, c.start)));
    // "una habitación y un baño" of one floor: a 1 in a list may still be a part.
    return { ...c, compound: c.compound || (listed && c.value >= 2) };
  });
}

/**
 * The keys a text mentions in a way no count can be read from: a range, a vague quantity, a part
 * ("one of the bedrooms"), or too many adjectives. Such a key is unknown: if the recogniser cannot tell, it passes.
 *
 * @param text - A number-normalised listing text.
 * @returns The unreadable keys.
 */
export function unreadableCountKeys(text: string): Set<CountKey> {
  const keys = new Set<CountKey>();
  for (const re of [RANGE_RE, VAGUE_RE, PART_OF_RE, MANY_ADJECTIVES_RE]) {
    for (const m of text.matchAll(re)) {
      const key = keyOf(m.groups ?? {});
      if (key !== undefined) keys.add(key);
    }
  }
  return keys;
}

/**
 * Does a listing call itself a studio ("Studio apartment", "estudio", "kawalerka")? It then states
 * one room and no bedroom, whichever of those words the copy uses.
 *
 * @param text - A listing's words.
 * @returns `true` when it does.
 */
export function namesStudio(text: string): boolean {
  return STUDIO_RE.test(text);
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
