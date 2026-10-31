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
const STREET_WORD =
  'Street|St\\.?|Road|Rd\\.?|Avenue|Ave\\.?|Lane|Ln\\.?|Drive|Dr\\.?|Place|Pl\\.?|Court|Ct\\.?|' +
  'Boulevard|Blvd\\.?|Way|Terrace|Close|Crescent|Square|Mews';
const STREET_PREFIX =
  '[Uu]l\\.|[Uu]lic[aąęy]|[Aa]l\\.|[Aa]lej[aąęie]|[Pp]l\\.|[Pp]lac(?:u|em)?|[Oo]s\\.|[Oo]siedl[aeu]|' +
  '[Cc]alle|[Cc]/|[Aa]venida|[Aa]vda\\.|[Pp]aseo|[Pp]laza|[Cc]arrer|[Rr]ua';
const PARTICLE = '(?:de|del|la|las|los|im\\.)';

const ADDRESS_RES: readonly RegExp[] = [
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
    `(?<![\\p{L}\\p{N}])(?:${STREET_PREFIX})\\s+(?:${PARTICLE}\\s+){0,2}${FIRST_NAME}(?:\\s+(?:${PARTICLE}\\s+)?${NAME}){0,3}(?:\\s+${HOUSE_NUMBER})?`,
    'gu',
  ),
  // Postcodes: "FL 32137", "30-001"
  /(?<![\p{L}\p{N}])\p{Lu}{2}\s\p{Nd}{5}(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}-])\p{Nd}{2}-\p{Nd}{3}(?![\p{L}\p{N}-])/gu,
];

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

/**
 * Blank what `text` repeats of a listed address: a part with a letter and a digit ("Rynek 5"), or a
 * street with the number the field keeps apart ("Calle Mayor, 12" as "Calle Mayor 12" or "Calle
 * Mayor, 12"). A bare number is never masked on its own: the listing's "12" says nothing about any
 * other 12 in the copy. Whole words only.
 *
 * @param text - Generated copy.
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
      if (/\p{Nd}/u.test(part)) mask(part);
      const next = parts[i + 1];
      if (next !== undefined && /^\p{Nd}+\p{L}?$/u.test(next)) {
        mask(`${part}, ${next}`);
        mask(`${part} ${next}`);
      }
    }
  }
  return out;
}
