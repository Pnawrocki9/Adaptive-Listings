/**
 * The forms a place name of the listing may take in generated copy — FOLLOW-1395, FOLLOW-1396, and
 * since FOLLOW-1311 on both paths. T7 of the claim contract: a Polish case form, the same name
 * without its diacritics, or another name from a closed table. Nothing fuzzy. The name POLICIES stay
 * with their paths (`llm-gateway.ts` judges a flag, `grounding-check.ts` refuses one in a headline);
 * this module only answers "is this word the listing's own name?". Pure, no I/O.
 *
 * @module apps/control-plane/src/lib/name-forms
 */

import { isAddressField } from '@/lib/street-address';

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
