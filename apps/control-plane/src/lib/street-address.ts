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

/** One word of a street's name: capitalised, or a number ("3 Maja", "N 42ND"). */
const NAME = "[\\p{Lu}\\p{Nd}][\\p{L}\\p{N}'’.-]*";
const HOUSE_NUMBER = '\\p{Nd}+[\\p{L}]?(?:/\\p{Nd}+[\\p{L}]?)?';
const STREET_WORD =
  'Street|St\\.?|Road|Rd\\.?|Avenue|Ave\\.?|Lane|Ln\\.?|Drive|Dr\\.?|Place|Pl\\.?|Court|Ct\\.?|' +
  'Boulevard|Blvd\\.?|Way|Terrace|Close|Crescent|Square';
const STREET_PREFIX =
  '[Uu]l\\.|[Uu]lic[aąęy]|[Aa]l\\.|[Aa]lej[aąęi]|[Pp]l\\.|[Pp]lac(?:u|em)?|[Oo]s\\.|[Oo]siedl[aeu]|' +
  '[Cc]alle|[Cc]/|[Aa]venida|[Aa]vda\\.|[Pp]aseo|[Pp]laza|[Cc]arrer|[Rr]ua';
const PARTICLE = '(?:de|del|la|las|los|im\\.)';

const ADDRESS_RES: readonly RegExp[] = [
  // "12 Bath Road", "1512 N 42ND Street", "2015 Ocean Drive"
  new RegExp(
    `(?<![\\p{L}\\p{N}.,])${HOUSE_NUMBER}\\s+(?:${NAME}\\s+){0,3}(?:${STREET_WORD})(?![\\p{L}\\p{N}])`,
    'gu',
  ),
  // "Bath Road 12"
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${NAME}\\s+){1,3}(?:${STREET_WORD})\\s+${HOUSE_NUMBER}(?![\\p{L}\\p{N}])`,
    'gu',
  ),
  // "ul. Złota 44", "przy ul. 3 Maja 12", "calle de la Paz 7"
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${STREET_PREFIX})\\s+(?:${PARTICLE}\\s+){0,2}${NAME}(?:\\s+(?:${PARTICLE}\\s+)?${NAME}){0,3}(?:\\s+${HOUSE_NUMBER})?`,
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

/**
 * Blank the parts of an address field that `text` repeats word for word, whatever their shape: the
 * listing's own location is an address however it is written ("Rynek 5").
 *
 * @param text - Generated copy.
 * @param addresses - The values of the listing's address fields.
 * @returns `text`, same length, with each repeated part replaced by spaces.
 */
export function maskListedAddressParts(text: string, addresses: readonly string[]): string {
  let out = text;
  for (const address of addresses) {
    for (const part of address.split(',')) {
      const needle = part.trim();
      if (!/\p{Nd}/u.test(needle)) continue;
      out = out.split(needle).join(' '.repeat(needle.length));
    }
  }
  return out;
}
