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
  STREET_PARTICLE,
  STREET_PREFIX,
  STREET_WORD,
} from '@estalara/shared/playbook-traits';
import { isAddressField, isListedStreet, maskListedAddressParts } from '@/lib/street-address';

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

const WORD = String.raw`\p{L}[\p{L}'’-]*`;
const CAPITAL_WORD = String.raw`\p{Lu}[\p{L}'’-]*`;
const LOCATING = '[Pp]rzy|[Nn]a|[Oo]n|[Aa]t|[Ee]n';
const PARTICLES = `(?:${STREET_PARTICLE}[ \\t]+){0,2}`;
/** What makes a number a distance, a time or an age, not a house number. */
const NOT_A_HOUSE_NUMBER_UNIT = String.raw`km|m|m²|min|mins?|minut\p{L}*|minutes?|metr\p{L}*|meters?|metres?|mil|miles?|lat|years?|a[nñ]os|godzin\p{L}*|hours?|horas?`;
/** At most three digits, because four read as a year ("Majdanek 1944"). */
const HOUSE_NUMBER = String.raw`\p{Nd}{1,3}(?![ \t]*(?:${NOT_A_HOUSE_NUMBER_UNIT})(?![\p{L}\p{N}]))\p{L}?(?:/\p{Nd}+\p{L}?)?(?![\p{L}\p{N}])`;
/** Nothing that goes on naming something else follows: "na Katyńskiej zbrodni" is no address. */
const NAME_ENDS = String.raw`(?=[ \t]*(?:[,.;:!?)\n]|$)|[ \t]+(?:w|we|i|z|ze|in|and|with|en|y|con)[ \t])`;

/** Copy: up to three words, then a house number ("Bohaterów Getta 5", "przy Katyńskiej 5"). */
const NUMBERED_NAME_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])((?:${WORD}[ \t]+){1,3})${HOUSE_NUMBER}`,
  'gu',
);
/** Copy: a street's marker, then its name: "alei Katyńskiej". */
const MARKED_NAME_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${STREET_PREFIX})[ \\t]+${PARTICLES}((?:${WORD}[ \\t]+){0,2}${WORD})${NAME_ENDS}`,
  'gu',
);
/** Copy: a locating word, then the name, capitalised: no noun ("przy getcie") is a street. */
const LOCATED_NAME_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${LOCATING})[ \\t]+(${CAPITAL_WORD}(?:[ \\t]+${CAPITAL_WORD}){0,2})${NAME_ENDS}`,
  'gu',
);
/**
 * A listing's free text states its address with a signal: a house number after "przy" / "na" or a
 * street's marker, or after a street word. A capital and a number are not enough: "5 min from
 * Treblinka 12" and "Obok Pomnika 5" mention a place and own nothing, whoever wrote them.
 */
const NUMBER_ENDS = String.raw`(?=[ \t]*(?:[,.;:!?)\n]|$)|[ \t]+(?:w|we|in|en)[ \t])`;
const STATED_STREET_RES: readonly RegExp[] = [
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:[Pp]rzy|[Nn]a|${STREET_PREFIX})[ \\t]+${PARTICLES}((?:${CAPITAL_WORD}[ \\t]+){1,3})${HOUSE_NUMBER}${NUMBER_ENDS}`,
    'gu',
  ),
  new RegExp(
    `(?<![\\p{L}\\p{N}])((?:${CAPITAL_WORD}[ \\t]+){1,3}(?:${STREET_WORD}))[ \\t]+${HOUSE_NUMBER}${NUMBER_ENDS}`,
    'gu',
  ),
];
const MARKER_AT_START_RE = new RegExp(`^(?:${STREET_PREFIX})\\s+${PARTICLES}`, 'iu');
const NUMBER_AT_END_RE = /\s+\p{Nd}+\p{L}?(?:\/\p{Nd}+\p{L}?)?$/u;
const NUMBER_AT_START_RE = /^\p{Nd}+\p{L}?\s+/u;

const wordsOf = (text: string): string[] =>
  Array.from(text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${WORD}`, 'gu')), (m) => m[0]).filter(
    (w) => !new RegExp(`^${STREET_PARTICLE}$`, 'iu').test(w),
  );

/** The streets this listing states, each as written, its number off. */
function ownStreets(listing: Readonly<Record<string, string>>): string[] {
  return Object.entries(listing).flatMap(([field, value]) => {
    const listed = isAddressField(field)
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter(isListedStreet)
      : [];
    const stated = STATED_STREET_RES.flatMap((re) =>
      Array.from(value.matchAll(re), (m) => (m[1] ?? '').trim()),
    );
    return [...listed, ...stated].map((street) =>
      street.replace(NUMBER_AT_END_RE, '').replace(NUMBER_AT_START_RE, ''),
    );
  });
}

/**
 * Blank what `text` repeats of the listing's own address, the forms no marker shows included:
 * "przy Katyńskiej 5" and "przy alei Katyńskiej" on a listing at "al. Katyńska 5". The whole name
 * has to match, in the same word or a Polish case form, so "Pomnik Zbrodni Katyńskiej", "Obok Getta"
 * and "na Katyńskiej zbrodni" stay what they say. A town is no street (`isListedStreet`): the listing
 * in Treblinka does not make "Dom w Treblince" an address.
 */
function blankOwnAddress(text: string, listing: Readonly<Record<string, string>>): string {
  const streets = ownStreets(listing);
  const names = streets.map((street) => wordsOf(street.replace(MARKER_AT_START_RE, '')));
  const isOwn = (words: readonly string[]): boolean =>
    names.some(
      (name) =>
        name.length === words.length &&
        words.every((word, i) => {
          const other = name[i] ?? '';
          return (
            foldDiacritics(word).toLowerCase() === foldDiacritics(other).toLowerCase() ||
            polishCaseForms(word, other)
          );
        }),
    );
  const blank = (match: string): string => ' '.repeat(match.length);
  const blankIfOwn = (match: string, name: string): string =>
    isOwn(wordsOf(name)) ? blank(match) : match;
  const addresses = Object.entries(listing)
    .filter(([field]) => isAddressField(field))
    .map(([, value]) => value);
  return maskListedAddressParts(text, [...addresses, ...streets])
    .replace(NUMBERED_NAME_RE, (match: string, name: string) => {
      const words = wordsOf(name);
      for (let i = 0; i < words.length; i += 1) {
        if (!isOwn(words.slice(i))) continue;
        const at = name.lastIndexOf(words[i] ?? '');
        return match.slice(0, at) + blank(match.slice(at));
      }
      return match;
    })
    .replace(MARKED_NAME_RE, blankIfOwn)
    .replace(LOCATED_NAME_RE, blankIfOwn);
}

/**
 * The protected-ground guard, on a listing: its own address is a fact it states, and blanked first
 * (PM on FOLLOW-1431, both paths). The only thing this spares that the guard does not. Blanking can
 * only spare: text the guard passes as written is passed before anything is blanked.
 *
 * @param text - Copy as the model wrote it.
 * @param listing - The listing's own fields by name, the description among them.
 * @returns `true` when the copy is refused.
 */
export function refusesOnProtectedGround(
  text: string,
  listing: Readonly<Record<string, string>>,
): boolean {
  return (
    describesResidentsByProtectedGround(text) &&
    describesResidentsByProtectedGround(blankOwnAddress(text, listing))
  );
}
