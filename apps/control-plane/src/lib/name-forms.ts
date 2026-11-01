/**
 * The forms a place name of the listing may take in generated copy — FOLLOW-1395, FOLLOW-1396, and
 * since FOLLOW-1311 on both paths. T7 of the claim contract: a Polish case form, the same name
 * without its diacritics, or another name from a closed table. Nothing fuzzy. The name POLICIES stay
 * with their paths (`llm-gateway.ts` judges a flag, `grounding-check.ts` refuses one in a headline);
 * this module only answers "is this word the listing's own name?". Pure, no I/O.
 *
 * @module apps/control-plane/src/lib/name-forms
 */

import {
  describesResidentsByProtectedGround,
  statesGroupComposition,
  STREET_PARTICLE,
  STREET_PREFIX,
  STREET_WORD,
} from '@estalara/shared/playbook-traits';
import { isAddressField, maskStreetAddresses } from '@/lib/street-address';

/** Python `\w` for a `str` pattern (`str.isalnum()` or `_`), as a character-class body. */
export const PY_WORD = '\\p{L}\\p{N}_';
/** Python `\b` before/after a word character, as lookarounds. */
const B_START = `(?<![${PY_WORD}])`;
const B_END = `(?![${PY_WORD}])`;
const PY_WORD_CHAR_RE = new RegExp(`^[${PY_WORD}]$`, 'u');

/**
 * Python `re.search(r"\b" + re.escape(needle) + r"\b", haystack, re.IGNORECASE)`. `\b` is a
 * boundary between a word and a non-word character, so when the needle itself starts (ends) with a
 * NON-word character the boundary demands a word character before (after) it.
 */
export function pyWordBoundarySearch(needle: string, haystack: string): boolean {
  const cps = Array.from(needle);
  if (cps.length === 0) return false;
  const first = cps[0] ?? '';
  const last = cps[cps.length - 1] ?? '';
  const prefix = PY_WORD_CHAR_RE.test(first) ? B_START : `(?<=[${PY_WORD}])`;
  const suffix = PY_WORD_CHAR_RE.test(last) ? B_END : `(?=[${PY_WORD}])`;
  const escaped = needle.replace(/[\\^$.*+?()[\]{}|/]/gu, '\\$&');
  return new RegExp(`${prefix}${escaped}${suffix}`, 'iu').test(haystack);
}

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
  // FOLLOW-1311 slice 5: `Wrocław` → `we Wrocławiu`, `Poznań` → `w Poznaniu`, `Łódź` → `w Łodzi`,
  // `Bydgoszcz` → `w Bydgoszczy`
  ['iu', ''],
  ['ia', ''],
  ['y', ''],
  ['niu', 'ń'],
  ['nia', 'ń'],
  ['niem', 'ń'],
  ['dzi', 'dź'],
  ['dzią', 'dź'],
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
  ['dzie', 'da'],
  ['i', 'ia'],
  // an adjective as a name, FOLLOW-1311 slice 5: `ul. Długa` → `przy ulicy Długiej`, `Dolny Sopot`
  // → `w Dolnym Sopocie`, `Stare Miasto` → `do Starego Miasta`, `Aleje Jerozolimskie` → `w Alejach
  // Jerozolimskich`
  ['ej', 'a'],
  ['iej', 'a'],
  ['ego', 'i'],
  ['m', 'i'],
  ['ego', 'y'],
  ['ym', 'y'],
  ['ego', 'e'],
  ['ym', 'e'],
  ['ich', 'ie'],
  // a plural place, FOLLOW-1311 slice 5: `Katowice` → `w Katowicach`; `Krzyki` → `na Krzykach`
  ['ach', 'e'],
  ['ach', 'y'],
  ['ach', 'i'],
  ['im', 'ie'],
  ['', 'e'],
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
  const fold = (s: string) => s.toLowerCase().replaceAll('ó', 'o').replaceAll('á', 'a');
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
export function isPolishCaseFormOfFact(
  word: string,
  original: string,
  ctx: Readonly<Record<string, string>>,
): boolean {
  const facts = [original, ...Object.values(ctx)].join(' ');
  for (const m of facts.matchAll(CAPITALISED_FACT_TOKEN_RE)) {
    if (polishCaseForms(word, m[0])) return true;
  }
  // An address field names in any case: `przy Piotrkowskiej` on `ul. piotrkowska 120`.
  return Object.entries(ctx).some(
    ([field, value]) =>
      isAddressField(field) && value.split(/[^\p{L}]+/u).some((w) => polishCaseForms(word, w)),
  );
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
  // Its stem is too short for the endings [FOLLOW-1311 slice 5].
  ['Łódź', 'Łodzi', 'Łodzią'],
  ['Poznań', 'Posnania'],
  ['Śląsk', 'Silesia'],
  ['Pomorze', 'Pomerania'],
  ['Mazury', 'Masuria'],
  ['Mazowsze', 'Masovia', 'Mazovia'],
  ['Kaszuby', 'Kashubia'],
  ['Tatry', 'Tatras'],
  ['Wisła', 'Vistula', 'Vístula'],
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
  // Regions and states a listing names short or in another language [FOLLOW-1311 slice 5]
  ['Valencian', 'Walencka', 'Valenciana'],
  ['FL', 'Florida', 'Floryda'],
];

/**
 * FOLLOW-1396: is a capitalised headline word the listing's own place under another name — the
 * same name with diacritics folded, or another name of the same `PLACE_EXONYMS` row (on a Polish
 * page, also an inflected form of one: "w Warszawie" for "Warsaw")?
 */
export function isOtherNameOfListingPlace(
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

/** A name as its words: no apostrophe, hyphens split ("Skłodowskiej-Curie", "O’Connell"). */
function nameWords(text: string): string[] {
  return text
    .replace(/['’]/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => Array.from(word).length >= 2);
}

/**
 * Does `listing` state what a word of a street's name names? Against its capitalised words and
 * `extra`: the same word in any case, without diacritics, a Polish case form, or the same first four
 * letters, folded ("Provenza" for "Provença"). No lower-case word of the listing otherwise, so
 * "Beach Road" takes no support from "close to the beach".
 *
 * @param word - A word of a street's name in generated copy.
 * @param listing - The listing's own words.
 * @param extra - Further names of the listing, whatever their case (an address field's words).
 * @returns `true` when the listing states that name.
 */
export function isStreetNameOfListing(
  word: string,
  listing: string,
  extra: readonly string[],
): boolean {
  const capitalised = nameWords(listing).filter((w) => /^\p{Lu}/u.test(w));
  const names = [...capitalised, ...extra.flatMap(nameWords)];
  return nameWords(word).some((part) => {
    const folded = foldDiacritics(part).toLowerCase();
    return names.some((name) => {
      const other = foldDiacritics(name).toLowerCase();
      return (
        other === folded ||
        (folded.length >= 4 && other.slice(0, 4) === folded.slice(0, 4)) ||
        polishCaseForms(part, name)
      );
    });
  });
}

// ─── The listing's own address, before the protected-ground guard [FOLLOW-1431] ───────────────────
//
// "Adres to adres" (CEO) is a real address of THIS listing, and a false refusal is safe: the seller's
// copy stays. So this spares one thing only, and refuses whenever it cannot tell. A street from
// the listing's structured location, stated with the listing's own house number, ending the phrase.
// Never the description, never an FAQ row, never a town.

/**
 * The fields that hold the listing's address, exact names. `listing_location` is the only one on
 * the grounding: `withListingFacts` and `fetchDescriptionGrounding` fill it from the backend's
 * `publicLocationLabel`. No substring match: FAQ rows are keyed by the question.
 */
const OWN_ADDRESS_FIELDS = ['listing_location'] as const;

const WORD = String.raw`\p{L}[\p{L}'’-]*`;
const PARTICLES = `(?:${STREET_PARTICLE}[ \\t]+){0,2}`;
const MARKER = String.raw`(?:(?:${STREET_PREFIX})[ \t]+|[Cc]/[ \t]*|[Cc]\.[ \t]+)`;
const HOUSE_NUMBER = String.raw`\p{Nd}{1,3}\p{L}?(?:/\p{Nd}+\p{L}?)?`;
/** A flat within the building: "ul. Długa 5 m. 12". */
const UNIT = String.raw`(?:m\.|lok\.|apt\.?|mieszk\.)[ \t]*\p{Nd}+\p{L}?`;
const NAME_TEXT = String.raw`${WORD}(?:[ \t]+${WORD}){0,6}`;
const MARKED_STREET_RE = new RegExp(
  `^${MARKER}(${NAME_TEXT})[ \\t]+(${HOUSE_NUMBER})(?:[ \\t]+(${UNIT}))?$`,
  'u',
);
const NUMBERED_AFTER_RE = new RegExp(
  `^(${NAME_TEXT})[ \\t]+(${HOUSE_NUMBER})(?:[ \\t]+(${UNIT}))?$`,
  'u',
);
/** "12 Elm Road". A street word is required: "08-140 Treblinka" and "1000 Lisboa" are no street. */
const NUMBERED_BEFORE_RE = new RegExp(
  String.raw`^(\p{Nd}{1,5}\p{L}?)[ \t]+(${NAME_TEXT}[ \t]+(?:${STREET_WORD}))$`,
  'u',
);
/** Words a name does not hold: "Near Treblinka 12", "The Ghetto 3" are no street. */
const NOT_IN_A_STREET_NAME: ReadonlySet<string> = new Set(
  (
    'the a an near from to at on by in of is are away obok blisko koło kolo od do przy na w we z ' +
    'cerca junto en el'
  ).split(' '),
);
const IS_PARTICLE_RE = new RegExp(`^${STREET_PARTICLE}$`, 'iu');
const WORD_RE = new RegExp(`(?<![\\p{L}\\p{N}])${WORD}`, 'gu');
const POSTCODE_RE = /^\p{Nd}{2}-\p{Nd}{3}(?![\p{L}\p{N}-])/u;
const ENDS_PHRASE_RE = /^[ \t]*(?:[.!?)\n]|$)/u;
const OPENS_PHRASE_RE = /(?:^|[.!?\n,:;(][ \t]*)$/u;
const MARKER_BEFORE_RE = new RegExp(`(?<![\\p{L}\\p{N}])${MARKER}${PARTICLES}$`, 'u');
const LOCATING_BEFORE_RE = /(?<![\p{L}\p{N}])(?:[Pp]rzy|[Nn]a|[Oo]n|[Aa]t|[Ee]n)[ \t]+$/u;
/** What a blank leaves: a word, so "Stara" and "old" reach nothing through it. No guard reads it. */
const INERT_WORD = 'ADRES';

/** The name's words: particles carry no name ("Calle del Gueto" is "Gueto"). */
const nameWordsOf = (text: string): string[] =>
  Array.from(text.matchAll(WORD_RE), (m) => m[0]).filter((w) => !IS_PARTICLE_RE.test(w));

interface OwnStreet {
  readonly words: readonly string[];
  readonly number: string;
  readonly unit: string | undefined;
  readonly numberFirst: boolean;
  /** The listing writes the name in lower case, so case says nothing. */
  readonly lowerCase: boolean;
}

/** One comma-separated segment of the address, if it is a street with a house number. */
function readOwnStreet(segment: string): OwnStreet | null {
  const before = NUMBERED_BEFORE_RE.exec(segment);
  const after = MARKED_STREET_RE.exec(segment) ?? NUMBERED_AFTER_RE.exec(segment);
  if (before === null && after === null) return null;
  const words = nameWordsOf((before ? before[2] : after?.[1]) ?? '');
  if (words.length === 0 || words.length > 5) return null;
  if (words.some((w) => NOT_IN_A_STREET_NAME.has(w.toLowerCase()))) return null;
  const capitals = words.filter((w) => /^\p{Lu}/u.test(w)).length;
  if (capitals !== 0 && capitals !== words.length) return null;
  return {
    words,
    number: (before ? before[1] : after?.[2]) ?? '',
    unit: after?.[3],
    numberFirst: before !== null,
    lowerCase: capitals === 0,
  };
}

const escapeForRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');

/** Form tolerance on the name only: diacritics folded, the T7 Polish case forms. */
function isSameName(copy: readonly string[], street: OwnStreet): boolean {
  if (copy.length !== street.words.length) return false;
  return copy.every((word, i) => {
    if (!street.lowerCase && !/^\p{Lu}/u.test(word)) return false;
    const a = foldDiacritics(word).toLowerCase();
    const b = foldDiacritics(street.words[i] ?? '').toLowerCase();
    return a === b || polishCaseForms(a, b);
  });
}

/** After the number: the flat, then `,` + a town or postcode of this address, then the end. */
function endsThePhrase(rest: string, street: OwnStreet, others: readonly string[]): boolean {
  let r = rest;
  if (street.unit !== undefined && r.startsWith(` ${street.unit}`)) {
    r = r.slice(street.unit.length + 1);
  }
  for (;;) {
    const comma = /^,?[ \t]*/u.exec(r)?.[0] ?? '';
    const next = r.slice(comma.length);
    const postcode = POSTCODE_RE.exec(next)?.[0];
    const town = comma.includes(',')
      ? others.find(
          (o) =>
            next.toLowerCase().startsWith(o.toLowerCase()) &&
            !/^[\p{L}\p{N}]/u.test(next.slice(o.length)),
        )
      : undefined;
    const part = postcode ?? town;
    if (part === undefined) return ENDS_PHRASE_RE.test(r);
    r = next.slice(part.length);
  }
}

/** Every statement of one street, with its number, replaced by {@link INERT_WORD}. */
function blankOneStreet(text: string, street: OwnStreet, others: readonly string[]): string {
  const number = `${escapeForRe(street.number)}(?![\\p{L}\\p{N}/-]|\\.\\p{Nd})`;
  const gap = `[ \\t]+${PARTICLES}`;
  const name = `${WORD}(?:${gap}${WORD}){${String(street.words.length - 1)}}`;
  const re = street.numberFirst
    ? new RegExp(`(?<![\\p{L}\\p{N}.,€$£-])${number}[ \\t]+(${name})(?![\\p{L}\\p{N}])`, 'gu')
    : new RegExp(`(?<![\\p{L}\\p{N}])(${name})[ \\t]+${number}`, 'gu');
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (!isSameName(nameWordsOf(m[1] ?? ''), street)) continue;
    const end = m.index + m[0].length;
    if (!endsThePhrase(text.slice(end), street, others)) continue;
    const before = text.slice(0, m.index);
    let start = m.index;
    if (!street.numberFirst) {
      const marker = MARKER_BEFORE_RE.exec(before);
      if (marker !== null) start = marker.index;
      else if (!LOCATING_BEFORE_RE.test(before) && !OPENS_PHRASE_RE.test(before)) continue;
    }
    if (start < last) continue;
    out += text.slice(last, start) + INERT_WORD;
    last = end;
  }
  return out + text.slice(last);
}

/** Blank what `text` states of the listing's own streets; nothing else. */
function blankOwnAddress(text: string, listing: Readonly<Record<string, string>>): string {
  let out = text;
  for (const field of OWN_ADDRESS_FIELDS) {
    const segments = (listing[field] ?? '')
      .split(',')
      .map((segment) => segment.trim())
      .filter(Boolean);
    for (const segment of segments) {
      const street = readOwnStreet(segment);
      if (street === null) continue;
      out = blankOneStreet(
        out,
        street,
        segments.filter((other) => other !== segment),
      );
    }
  }
  return out;
}

/** "C. Mayor 5" is an address to the composition check, as "ul. Długa 5" is by the mask. */
const ABBREVIATED_CALLE_RE =
  /(?<![\p{L}\p{N}])[Cc]\.[ \t]+\p{Lu}[\p{L}'’-]*(?:[ \t]+\p{Nd}+\p{L}?)?/gu;

/**
 * The protected-ground guard, on a listing. The listing's own street, with its number, is blanked
 * first; the rest of the text is still checked (PM on FOLLOW-1431). A statement of composition is
 * also read with every address out of the way, because an address breaks the phrase the guard
 * reads: "Most residents at ul. Długa 5 are Muslim" is refused on any listing.
 *
 * @param text - Copy as the model wrote it.
 * @param listing - The listing's own fields by name.
 * @returns `true` when the copy is refused.
 */
export function refusesOnProtectedGround(
  text: string,
  listing: Readonly<Record<string, string>>,
): boolean {
  const blanked = blankOwnAddress(text, listing);
  const noAddresses = maskStreetAddresses(blanked).replace(ABBREVIATED_CALLE_RE, INERT_WORD);
  if (statesGroupComposition(noAddresses)) return true;
  return describesResidentsByProtectedGround(text) && describesResidentsByProtectedGround(blanked);
}
