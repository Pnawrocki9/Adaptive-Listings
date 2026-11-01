/**
 * Street addresses, masked before a typed claim is read — FOLLOW-1311.
 *
 * A street address always passes (CEO 2026-10-30), and its words must not be read as facts on
 * either side: "12 Bath Road" is no bathroom count, "5 Pound Lane" no sum of money, "ul. Złota 44"
 * no 44 zloty, "2015 Ocean Drive" no year. So the address is blanked in the copy AND in the listing
 * before any typed recogniser reads them. Masking too much only lets a claim pass.
 *
 * Closed, en / pl / es, and pure. An address the patterns do not see is a known limit: it is read
 * like any other words.
 *
 * @module apps/control-plane/src/lib/street-address
 */

import {
  ALEJA_FORM,
  BARE_STREET_WORD,
  NOT_A_STREET_NAME,
  STREET_PARTICLE,
  STREET_PREFIX,
  STREET_WORD,
} from '@estalara/shared/playbook-traits';

/** Case-insensitive by hand: the masks are case-sensitive on purpose, a name is capitalised. */
const anyCase = (word: string): string =>
  Array.from(word, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`).join('');
/** A word that opens a claim, never a street's name: "4 Bedroom Terrace", "120 Sq Ft Terrace". */
const CLAIM_WORD =
  `(?:${['bed', 'beds', 'sq', 'sqm', 'ft', 'room', 'rooms', 'mkw'].map(anyCase).join('|')}|` +
  `(?:${['bedroom', 'bathroom', 'sypial', 'dormitor', 'habitaci', 'łazien', 'pokoj', 'pokój', 'pokoi'].map(anyCase).join('|')})\\p{L}*|m²|m2)(?![\\p{L}\\p{N}])`;
const CURRENCY_WORD = '(?:€|\\$|£|EUR|USD|PLN|GBP|zł|euro\\p{L}*|złot\\p{L}*)(?![\\p{L}\\p{N}])';
/** One word of a street's name, capitalised. */
const NAME = `(?!${CLAIM_WORD})\\p{Lu}[\\p{L}'’.-]*`;
/** The first word after a street prefix may be a number ("ul. 3 Maja"). */
const FIRST_NAME = `(?!${CLAIM_WORD})[\\p{Lu}\\p{Nd}][\\p{L}\\p{N}'’.-]*`;
/** A house number, never a count or a sum: "ul. Długa 4 Sypialnie" keeps its "4 Sypialnie". */
const HOUSE_NUMBER = `\\p{Nd}+\\p{L}?(?:/\\p{Nd}+\\p{L}?)?(?![\\p{N}]|\\s*${CURRENCY_WORD}|\\s+${CLAIM_WORD})`;
const PARTICLE = STREET_PARTICLE;
/**
 * The prefixes a street name may follow in lower case ("przy ul. parterowa"). Not "plac", "plaza",
 * "paseo": "plac zabaw" and "plaza de parking" are claims. The first word only, and never a word
 * that joins a clause: "cicha ulica z basenem" keeps its pool.
 */
const LOWER_NAME_PREFIX = '[Uu]l\\.|[Uu]lic[aąęy]|[Aa]l\\.|[Cc]alle|[Cc]/|[Aa]vda\\.';

const addressRes = (prefix: string): readonly RegExp[] => [
  // "12 Bath Road", "2015 Ocean Drive"; a number with a currency on it is no house number
  new RegExp(
    `(?<![\\p{L}\\p{N}.,€$£])${HOUSE_NUMBER}\\s+(?:${NAME}\\s+){0,3}(?:${STREET_WORD})(?![\\p{L}\\p{N}])`,
    'gu',
  ),
  // Copy is not always capitalised: "12 bath road", the unambiguous street words only.
  new RegExp(
    `(?<![\\p{L}\\p{N}.,€$£])\\p{Nd}+\\s+(?:(?!${CLAIM_WORD})\\p{Ll}+\\s+){1,2}(?:street|road|lane|avenue|drive|mews)(?![\\p{L}\\p{N}])`,
    'gu',
  ),
  // "Bath Road 12"
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${NAME}\\s+){1,3}(?:${STREET_WORD})\\s+${HOUSE_NUMBER}(?![\\p{L}\\p{N}])`,
    'gu',
  ),
  // "ul. Złota 44", "przy ul. 3 Maja 12", "calle de la Paz 7", "Aleje 12 Bath"
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${prefix})\\s+(?:${PARTICLE}\\s+){0,2}${FIRST_NAME}(?:\\s+(?:${PARTICLE}\\s+)?${NAME}){0,3}(?:\\s+${HOUSE_NUMBER})?`,
    'gu',
  ),
  // "ul. parterowa", "calle solar 7"
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${LOWER_NAME_PREFIX})\\s+(?:${PARTICLE}\\s+){0,2}(?!${CLAIM_WORD}|${NOT_A_STREET_NAME})\\p{Ll}[\\p{L}'’.-]*(?:\\s+${HOUSE_NUMBER})?`,
    'gu',
  ),
  // Postcodes: "FL 32137", "30-001"
  /(?<![\p{L}\p{N}])\p{Lu}{2}\s\p{Nd}{5}(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}-])\p{Nd}{2}-\p{Nd}{3}(?![\p{L}\p{N}-])/gu,
];

const ADDRESS_RES = addressRes(STREET_PREFIX);
/**
 * A listing keeps the reach it had under `claims-v10`. Blanking a listing's words takes away what
 * grounds a claim, so reading "Przy Alejach Umeblowane Mieszkanie" as an address would refuse
 * "Umeblowane mieszkanie". Copy reads every form, which only lets a claim pass [FOLLOW-1431].
 */
const LISTING_ADDRESS_RES = addressRes(STREET_PREFIX.replace(ALEJA_FORM, '[Aa]lej[aąęie]'));

// ─── Street claims (FOLLOW-1311 slice 5) ──────────────────────────────────────
//
// A capital is no signal: "Free Street Parking", "A Sunset Drive", "Plac Budowy". A claim needs a
// house number, a street prefix with a real name, or a locating word in sentence case. If this
// cannot tell, it passes. Same line only: "Quiet Garden\nDrive to the beach" is two thoughts.

const GAP = '[ \\t]+';
/** "Św.", "Dr.", "Ks.", "J.", "Sta.": no name itself; the next word decides. */
const ABBREVIATION = '\\p{Lu}\\p{L}{0,3}\\.(?=[ \\t]+[\\p{Lu}\\p{Nd}])';
const CLAIM_NAME = `(?!${CLAIM_WORD})\\p{Lu}[\\p{L}'’-]+`;
const CLAIM_PIECE = `(?:${ABBREVIATION}|${CLAIM_NAME})`;
/** The first word after a prefix may be a number ("ul. 3 Maja"). */
const CLAIM_FIRST = `(?:${ABBREVIATION}|(?!${CLAIM_WORD})[\\p{Lu}\\p{Nd}][\\p{L}\\p{N}'’-]*)`;
/** Nothing that goes on naming something else follows: "on Google Street View" is no street. */
const CLAUSE_GOES_ON = `(?=[ \\t]*(?:[.,;:!?)\\n]|$)|${GAP}(?:in|near|and|or|with|to|at|from|for|is|has|which|w|i|z|na|en|y)(?![\\p{L}\\p{N}]))`;
const LOCATING_WORD = '(?:on|at|off|near|along|przy)';
const STRONG_PREFIX =
  `[Uu]l\\.|[Uu]lic[aąęy]|[Aa]l\\.|${ALEJA_FORM}|[Cc]alle|[Cc]/|[Aa]venida|[Aa]vda\\.|` +
  '[Cc]arrer|[Rr]ua';
/** A square or a promenade needs a locating word too: "Plac Budowy", "Plaza de Garaje". */
const WEAK_PREFIX = '[Pp]l\\.|[Pp]lac(?:u|em)?|[Pp]aseo|[Pp]laza';
const WEAK_LOCATING_WORD = '(?:przy|na|od|do|koło|obok|en|del|de|junto a|cerca de)';
const PREFIXED_NAME = `(?:${PARTICLE}${GAP}){0,2}(${CLAIM_FIRST}(?:${GAP}(?:${PARTICLE}${GAP})?${CLAIM_PIECE}){0,3})`;

const NUMBERED_CLAIM_RE = new RegExp(
  `(?<![\\p{L}\\p{N}.,€$£])${HOUSE_NUMBER}${GAP}((?:${CLAIM_PIECE}${GAP}){1,3})(?:${STREET_WORD})(?![\\p{L}\\p{N}])`,
  'gu',
);
const LOCATED_CLAIM_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])${LOCATING_WORD}${GAP}(?:the${GAP})?((?:${CLAIM_PIECE}${GAP}){1,3})(?:${BARE_STREET_WORD})(?![\\p{L}\\p{N}])${CLAUSE_GOES_ON}`,
  'gu',
);
/**
 * "Alejka" is a garden path before it is a street, so it needs a house number: "Przy Alejce Różanej
 * 12" is read and "Alejka Spacerowa prowadzi do parku" is not [FOLLOW-1436].
 */
const ALLEY_CLAIM_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])[Aa]lej(?:k\\p{L}*|ce|ek)${GAP}${PREFIXED_NAME}${GAP}${HOUSE_NUMBER}(?![\\p{L}\\p{N}])`,
  'gu',
);
const STRONG_PREFIX_CLAIM_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${STRONG_PREFIX})${GAP}${PREFIXED_NAME}`,
  'gu',
);
const WEAK_PREFIX_CLAIM_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])${WEAK_LOCATING_WORD}${GAP}(?:(?:la|el)${GAP})?(?:${WEAK_PREFIX})${GAP}${PREFIXED_NAME}`,
  'gu',
);

/** Before a street word, the name is only what follows the last of these: "To The Main Road". */
const GENERIC_STREET_WORDS: ReadonlySet<string> = new Set(
  (
    'a an the this that these those your our its their every each no one to of in on at by for ' +
    'from with and or near off along just quiet peaceful private main high side back country ' +
    'residential ring service access open scenic coastal long short test hard tree-lined easy ' +
    'free paved gated sunset large big small sunny covered roof ' +
    'minute minutes min mile miles hour hours km second seconds day week car cars star stars ' +
    'zabaw budowy marítimo maritimo tranquilo tranquila principal peatonal comercial residencial ' +
    'privada ancha garaje parking aparcamiento terraza piscina jardín jardin ascensor balcón ' +
    'balcon vistas trastero con sin en y para'
  ).split(' '),
);
const PARTICLES: ReadonlySet<string> = new Set(['de', 'del', 'la', 'las', 'los', 'im.']);

/** Title case carries no signal: "Beautiful Home on Sunset Drive". The sentence's first word may. */
function followsTitleCase(text: string, at: number): boolean {
  const sentence =
    text
      .slice(Math.max(0, at - 80), at)
      .split(/[.!?:;|\n]/u)
      .at(-1) ?? '';
  const words = sentence
    .trim()
    .split(/[ \t]+/u)
    .filter(Boolean);
  return words.length >= 2 && /^\p{Lu}/u.test(words.at(-1) ?? '');
}

/** The words of a name that a listing must state; abbreviations and numbers decide nothing. */
const named = (words: readonly string[]): string[] =>
  words.filter((w) => !w.endsWith('.') && /^\p{Lu}/u.test(w) && Array.from(w).length >= 2);

const beforeStreetWord = (name: string): string[] => {
  const all = name.trim().split(/[ \t]+/u);
  const lastGeneric = all.map((w) => GENERIC_STREET_WORDS.has(w.toLowerCase())).lastIndexOf(true);
  return named(all.slice(lastGeneric + 1));
};

/**
 * Right after a number these count or measure, so it is no house number: "A 2 Story Terrace", "3
 * Season Terrace", "1 Acre Close", "4 Wheel Drive" [FOLLOW-1436]. Closed: any other word keeps the
 * number a house number, so "12 Baker Close", "12 Door Lane" and "12 Lane Road" are read. A real
 * "12 Mile Road" passes, and that is the known limit.
 */
const COUNTED_WORDS: ReadonlySet<string> = new Set(
  (
    'story stories storey storeys level levels degree degrees foot feet inch inches yard yards ' +
    'acre acres hectare hectares season seasons separate wheel minute minutes hour hours star ' +
    'stars mile miles meter meters metre metres'
  ).split(' '),
);

const afterNumber = (name: string): string[] =>
  COUNTED_WORDS.has(
    name
      .trim()
      .split(/[ \t]+/u)[0]
      ?.toLowerCase() ?? '',
  )
    ? []
    : beforeStreetWord(name);

/** After a prefix a generic first word means no name at all: "Calle Principal", "c/ Terraza". */
const afterPrefix = (name: string): string[] => {
  const all = name
    .trim()
    .split(/[ \t]+/u)
    .filter((w) => !PARTICLES.has(w.toLowerCase()));
  const words = named(all);
  return GENERIC_STREET_WORDS.has((words[0] ?? '').toLowerCase()) ? [] : words;
};

/** One street a text states by name. */
interface StreetClaim {
  /** As written, without the street word: "Ocean", "Długiej". */
  readonly name: string;
  /** The words a listing's name has to match; never empty. */
  readonly words: readonly string[];
}

/**
 * Every street `text` states with a signal: a house number, a street prefix with a real name, or a
 * locating word in sentence case. A name in lower case and a street word outside the closed lists
 * are not read, and pass.
 *
 * @param text - Generated copy, as written.
 * @returns The claims; each is one street.
 */
export function readStreetClaims(text: string): StreetClaim[] {
  const claims = (
    re: RegExp,
    read: (name: string) => string[],
    titleCaseCounts: boolean,
  ): StreetClaim[] =>
    Array.from(text.matchAll(re))
      .filter((m) => !titleCaseCounts || !followsTitleCase(text, m.index))
      .map((m) => {
        const name = (m[1] ?? '').trim();
        return { name, words: read(name) };
      });
  return [
    ...claims(NUMBERED_CLAIM_RE, afterNumber, false),
    ...claims(LOCATED_CLAIM_RE, beforeStreetWord, true),
    ...claims(STRONG_PREFIX_CLAIM_RE, afterPrefix, false),
    ...claims(ALLEY_CLAIM_RE, afterPrefix, false),
    ...claims(WEAK_PREFIX_CLAIM_RE, afterPrefix, true),
  ].filter((claim) => claim.words.length > 0);
}

/**
 * The names a listing writes in lower case beside a street word: "plac wolności", "coast road".
 * `alej…` stays a stem here: this only grants a name, and a closed list would refuse a street that
 * "alejka spacerowa" grounds today, which a loosening does not do [FOLLOW-1436].
 */
const LOWER_STREET_NAME_RES: readonly RegExp[] = [
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${LOWER_NAME_PREFIX}|[Aa]lej\\p{L}*|[Aa]lei|[Pp]lac(?:u|em)?)[ \\t]+(?:${PARTICLE}[ \\t]+){0,2}(?!${NOT_A_STREET_NAME})(\\p{Ll}[\\p{L}'’-]*)`,
    'gu',
  ),
  /(?<![\p{L}\p{N}])(\p{Ll}[\p{L}'’-]*)[ \t]+(?:street|road|avenue|boulevard|lane|drive|way|place|court|st\.|rd\.?|ave\.?|blvd\.?|dr\.?|pl\.?)(?![\p{L}\p{N}])/gu,
];

/**
 * The names a listing's text writes in lower case right beside a street word.
 *
 * @param listing - The listing's own words.
 * @returns Each such name.
 */
export function readLowerCaseStreetNames(listing: string): string[] {
  return LOWER_STREET_NAME_RES.flatMap((re) => Array.from(listing.matchAll(re), (m) => m[1] ?? ''));
}

const blank = (match: string): string => ' '.repeat(match.length);

/**
 * Blank every street address and postcode of `text`.
 *
 * @param text - Generated copy or a listing's words.
 * @returns `text`, same length, with each address replaced by spaces.
 */
export function maskStreetAddresses(text: string): string {
  return ADDRESS_RES.reduce((out, re) => out.replace(re, blank), text);
}

/**
 * {@link maskStreetAddresses} for a listing's own words.
 *
 * @param text - A listing's words.
 * @returns `text`, same length, with each address replaced by spaces.
 */
export function maskListingAddresses(text: string): string {
  return LISTING_ADDRESS_RES.reduce((out, re) => out.replace(re, blank), text);
}

const ADDRESS_FIELD_RE = /location|address|adres|street|direcci[oó]n/iu;

/**
 * Is this listing field an address by its name? Its whole value is then no source of typed facts.
 *
 * @param field - The field's key.
 * @returns `true` for a location or address field.
 */
export function isAddressField(field: string): boolean {
  return ADDRESS_FIELD_RE.test(field);
}

const escapeRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');

/** A listed part that is a street by its own words; a town named like an attribute is not. */
const LISTED_STREET_RE = new RegExp(
  `^(?:(?:${STREET_PREFIX})\\s+\\S.*|.*\\S\\s+(?:${STREET_WORD}))$`,
  'iu',
);

/**
 * Blank what `text` repeats of a listed address, in any case: a part with a letter and a digit
 * ("Rynek 5"), a part that is a street by its own words ("Freehold Road", "ul. parterowa"), or a
 * street with the number the field keeps apart ("Calle Mayor, 12" as "Calle Mayor 12" or "Calle
 * Mayor, 12"). A bare number is never masked on its own: the listing's "12" says nothing about any
 * other 12 in the copy. Nor is a lettered part that names no street: a location "Bungalow" leaves
 * "a bungalow" a claim. Whole words only.
 *
 * @param text - Generated copy, or a listing's words.
 * @param addresses - The values of the listing's address fields.
 * @returns `text`, same length, with each repeated address replaced by spaces.
 */
export function maskListedAddressParts(text: string, addresses: readonly string[]): string {
  let out = text;
  const mask = (needle: string): void => {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(needle)}(?![\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, blank);
  };
  for (const address of addresses) {
    const parts = address.split(',').map((part) => part.trim());
    for (const [i, part] of parts.entries()) {
      if (!/\p{L}/u.test(part)) continue;
      if (/\p{Nd}/u.test(part) || LISTED_STREET_RE.test(part)) mask(part);
      const next = parts[i + 1];
      if (next !== undefined && /^\p{Nd}+\p{L}?$/u.test(next)) {
        mask(`${part}, ${next}`);
        mask(`${part} ${next}`);
      }
    }
  }
  return out;
}
