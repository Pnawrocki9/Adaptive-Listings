/**
 * The physical and tenure attributes of the claim checks, in en / pl / es — FOLLOW-1311 slice 4.
 *
 * A closed list. An attribute asserted in copy with no matching fact in the listing is refused
 * (`unsupported_attribute`); what no pattern here sees passes as before. A pattern is written for
 * the word in its context, because the same word means something else one word away: "wanna
 * wolnostojąca" is a bath, "entrada independiente" a door, "cocina amueblada" a fitted kitchen,
 * "una planta" a plant, "na południe od Krakowa" a place. So each claim names what it is about, and
 * every doubt falls on the side of passing: a false refusal costs the adaptation, a hole costs what
 * no check caught before this one either.
 *
 * T8, the closed entailment table, is the `groundedBy` of each attribute and nothing else:
 *   - a bungalow, "parterowy" → single-storey; a single-storey house → a bungalow.
 *   - "ground-floor" → "parterowy" only on a listing that names no upper floor (the house with
 *     "na parterze" and "na piętrze" is not "parterowy").
 *   - "single-family" → never "single-storey"; → "detached" only in English and only on a listing
 *     that names no attached form. The borderline, allowed: in US usage it reads as detached, and
 *     a real headline says so of a real listing ("Wolnostojący dom", FOLLOW-1381, Palm Coast). "Dom
 *     jednorodzinny" and "vivienda unifamiliar" do not entail it: they commonly name a terrace.
 *   - "własność", "księga wieczysta" → freehold.
 *   - "replaced" → new, for an installation; "do wymiany" (to be replaced) is not.
 * The garage → parking entailment lives in `lib/amenity-lexicon.ts`.
 *
 * Pure, no I/O.
 *
 * @module apps/control-plane/src/lib/attribute-lexicon
 */

import { assertedMatches } from '@/lib/amenity-lexicon';

const W = '\\p{L}\\p{N}_';
const S = '[ \\t]+';

function wordRe(patterns: readonly string[]): RegExp {
  return new RegExp(`(?<![${W}-])(?:${patterns.join('|')})(?![${W}-])`, 'giu');
}

/** One attribute: what copy asserts, and what in the listing supports it. */
interface AttributeDef {
  readonly key: string;
  /** What a text asserts, in en / pl / es. */
  readonly claim: readonly string[];
  /** T8: other words of a listing that support the claim. */
  readonly groundedBy?: readonly string[];
  /** T8: words that support it only where `unless` names nothing in the listing. */
  readonly weak?: { readonly groundedBy: readonly string[]; readonly unless: RegExp };
}

// ─── Storeys ──────────────────────────────────────────────────────────────────

/** A part of the property: "single-storey extension", "parterowa dobudówka". */
const PART_AFTER =
  `(?![ \\t-]+(?:rear|side|extensions?|annex(?:e|es)?|garages?|outbuildings?|wings?|sheds?|workshops?|` +
  `dobudówk\\p{L}*|przybudówk\\p{L}*|garaż\\p{L}*|budyn\\p{L}*${S}gospodarcz\\p{L}*|częś[cć]\\p{L}*)(?![${W}]))`;
const SINGLE_STOREY = [
  // "one story" alone is a tale ("tells a single story"): only hyphenated, or naming the house.
  `(?:single|one)-stor(?:e)?y${PART_AFTER}`,
  `(?:single|one)${S}storey(?!${S}(?:up|down|above|below|higher|lower|of))${PART_AFTER}`,
  `(?:single|one)${S}story${S}(?:home|house|property|villa|residence)`,
  // "one level from the street" is a distance: with a space, only naming what is on it.
  `(?:single|one)-level${PART_AFTER}`,
  `(?:single|one)${S}level${S}(?:home|house|living|layout|property|villa|flat|apartment|bungalow)`,
  `on${S}(?:one|a${S}single)${S}level(?!${S}of${S}(?:the|a|this))`,
  `single-floor${PART_AFTER}`,
  `(?:all${S}|everything${S})on${S}one${S}floor`,
  `on${S}a${S}single${S}floor`,
  // pl
  `jedno(?:poziomow|kondygnacyjn)(?:y|a|e|ą|ego|ej|ym|ych|ymi)${PART_AFTER}`,
  `na${S}jednym${S}poziomie(?!${S}(?:z|ze|cen))`,
  // es: "una planta" alone is a plant, and "planta baja" is a floor of a building.
  `(?:casa|vivienda|chal[eé]t?|bungalow|villa|piso|apartamento)${S}de${S}una${S}planta(?!${S}de)`,
  `(?:de|en)${S}una${S}(?:sola|[uú]nica)${S}planta(?!${S}de)`,
  `de${S}planta${S}[uú]nica`,
];
const PARTEROWY = [`parterow(?:y|a|e|ą|ego|ej|emu|ym|ych|ymi|i)${PART_AFTER}`];
/** A neighbour's bungalow is no claim, nor are "bungalows" in the street. */
const BUNGALOW = [
  `(?<!(?:neighbou?ring|nearby|next-door|adjacent)${S})bungalow(?:u|em|ie)?(?!${S}(?:road|street|lane|park|estate))`,
  'bungal[oó]',
];
const SINGLE_STOREY_HOUSE = [
  `(?:single|one)-stor(?:e)?y${S}(?:home|house)`,
  `(?:single|one)${S}stor(?:e)?y${S}(?:home|house)`,
  `dom(?:u|em|ie)?${S}parterow\\p{L}*`,
  `parterow\\p{L}*${S}dom(?:u|em|ie)?`,
  `(?:casa|vivienda)${S}de${S}una${S}(?:sola${S})?planta`,
];
/** "on one level", "single-storey" and their translations, a listing's "parterowy", a bungalow. */
const LEVEL_FACTS = [...SINGLE_STOREY, ...PARTEROWY, ...BUNGALOW];

// ─── Position in the building ─────────────────────────────────────────────────

/**
 * The whole unit only: "the top floor" of a house holds a bedroom, and says nothing a listing with
 * an upstairs has to state. A floor number is not the top floor: "4th floor" does not ground it.
 */
const UNIT_EN = 'flat|apartment|unit|studio|condo';
const UNIT_PL = 'mieszkani\\p{L}*|apartament\\p{L}*|lokal\\p{L}*|kawalerk\\p{L}*';
const UNIT_ES = 'piso|apartamento|estudio';
const TOP_FLOOR = [
  `top[- ]floor${S}(?:${UNIT_EN}|walk-?up)`,
  `(?:${UNIT_EN})${S}(?:(?:is|sits|located)${S})?on${S}the${S}top${S}floor`,
  `(?:${UNIT_PL})${S}(?:(?:jest|znajduje${S}się)${S})?na${S}ostatnim${S}piętrze`,
  `(?:${UNIT_ES})${S}(?:(?:est[aá]|situado)${S})?en${S}(?:la${S})?[uú]ltima${S}planta`,
];
const TOP_FLOOR_LISTING = [
  `top[- ]floor`,
  `ostatni\\p{L}*${S}pi[eę]tr\\p{L}*`,
  `[uú]ltim[oa]${S}(?:planta|piso)`,
  'penthouse|[aá]tico',
];

// ─── Detached ─────────────────────────────────────────────────────────────────

const HOUSE_EN = 'house|home|villa|property|residence|bungalow|cottage|dwelling|chalet';
const HOUSE_PL =
  'dom(?:u|em|ie)?|dom(?:ek|ku|kiem)|will(?:a|i|ę|ą)|budyn(?:ek|ku|kiem)|rezydencj\\p{L}*';
const WOLNOSTOJACY = 'wolno(?:[ -])?stoj[aą]c\\p{L}*';
const DETACHED_PARTS =
  'garages?|annex(?:e|es)?|outbuildings?|sheds?|workshops?|from|bath(?:tub)?s?';
const WOLNOSTOJACY_PARTS =
  'wann\\p{L}*|garaż\\p{L}*|lod[oó]wk\\p{L}*|piekarnik\\p{L}*|kuchenk\\p{L}*|zmywark\\p{L}*|szaf\\p{L}*|lamp\\p{L}*|' +
  `budyn\\p{L}*${S}gospodarcz\\p{L}*`;
const DETACHED = [
  // "semi-detached" is out by the hyphen of the word boundary, "semi detached" here.
  `(?<!semi${S})detached(?:${S}(?!${DETACHED_PARTS})[\\p{L}-]+){0,2}${S}(?:${HOUSE_EN})`,
  `(?:${HOUSE_EN})${S}is${S}(?:fully${S})?detached`,
  'fully[- ]detached',
  `(?:free[- ]?standing|stand[- ]?alone)${S}(?:${HOUSE_EN})`,
  `(?:${HOUSE_PL})${S}(?:jest${S})?${WOLNOSTOJACY}`,
  `${WOLNOSTOJACY}${S}(?:${HOUSE_PL})`,
  // es: "entrada independiente" is a door, "casa aislada" may be insulated or remote.
  `(?:casa|vivienda|chal[eé]t?|villa)s?${S}independientes?`,
  `unifamiliar(?:es)?${S}aislad[oa]s?`,
];
/** A listing need not name the house beside the word; a part it names is no fact about the house. */
const DETACHED_LISTING = [
  `(?<!semi${S})detached(?!${S}(?:${DETACHED_PARTS})(?![${W}]))`,
  `(?<!(?:${WOLNOSTOJACY_PARTS})${S})${WOLNOSTOJACY}(?!${S}(?:${WOLNOSTOJACY_PARTS})(?![${W}]))`,
];

// ─── Orientation ──────────────────────────────────────────────────────────────

/** Each compass point in each language; a compound names both of its points. */
const DIRECTIONS: readonly {
  key: string;
  en: string;
  plAdj: string;
  plNoun: string;
  es: string;
}[] = [
  {
    key: 'south',
    en: 'south(?:[- ]?(?:east|west))?',
    plAdj: 'południow(?:ej|a|ą|e|y|o-(?:zachodni|wschodni)(?:ej|a|ą|e|y))',
    plNoun: 'południe|południowy[ \\t]+(?:zachód|wschód)',
    es: 'sur|sureste|suroeste|sudeste|sudoeste',
  },
  {
    key: 'north',
    en: 'north(?:[- ]?(?:east|west))?',
    plAdj: 'północn(?:ej|a|ą|e|y|o-(?:zachodni|wschodni)(?:ej|a|ą|e|y))',
    plNoun: 'północ|północny[ \\t]+(?:zachód|wschód)',
    es: 'norte|noreste|noroeste|nordeste',
  },
  {
    key: 'east',
    en: '(?:(?:north|south)[- ]?)?east',
    plAdj: '(?:(?:południowo|północno)-)?wschodni(?:ej|a|ą|e)',
    plNoun: '(?:(?:południowy|północny)[ \\t]+)?wsch[oó]d',
    es: 'este|sureste|sudeste|noreste|nordeste',
  },
  {
    key: 'west',
    en: '(?:(?:north|south)[- ]?)?west',
    plAdj: '(?:(?:południowo|północno)-)?zachodni(?:ej|a|ą|e)',
    plNoun: '(?:(?:południowy|północny)[ \\t]+)?zach[oó]d',
    es: 'oeste|suroeste|sudoeste|noroeste',
  },
];
/** What follows a compass word and makes it a place: "facing South Beach", "south of the river". */
const NOT_A_PLACE =
  `(?![ \\t-]+(?:of|beach|bay|coast|park|side|street|road|shore|end|tower|building|wing|avenue|` +
  `od|części|dzielnic\\p{L}*|stron\\p{L}*|granic\\p{L}*|de)(?![${W}]))`;

function orientationPatterns(d: (typeof DIRECTIONS)[number]): string[] {
  const es = `(?:${d.es})`;
  return [
    `(?:${d.en})[- ]facing`,
    `(?:faces?|facing)${S}(?:${d.en})${NOT_A_PLACE}`,
    `(?:${d.en})(?:ern|erly)?${S}(?:aspect|exposure)`,
    `(?:orientation|aspect|exposure)[ \\t:]+(?:${d.en})${NOT_A_PLACE}`,
    // pl
    `od${S}strony${S}(?:${d.plAdj})${NOT_A_PLACE}`,
    `(?:wystaw\\p{L}*|ekspozycj\\p{L}*|orientacj\\p{L}*)[ \\t:]+(?:${d.plAdj}|${d.plNoun})${NOT_A_PLACE}`,
    `(?:okn\\p{L}*|wystawion\\p{L}*|skierowan\\p{L}*|zorientowan\\p{L}*|wychodz\\p{L}*)(?:${S}\\p{L}+){0,1}${S}na${S}(?:${d.plNoun})${NOT_A_PLACE}`,
    // es
    `orientad[oa]s?${S}(?:al|hacia${S}el)${S}${es}${NOT_A_PLACE}`,
    `orientaci[oó]n[ \\t:]+(?:al${S})?${es}${NOT_A_PLACE}`,
    `(?:da|dan|mira|miran)${S}(?:al|hacia${S}el)${S}${es}${NOT_A_PLACE}`,
    `de${S}cara${S}al${S}${es}${NOT_A_PLACE}`,
  ];
}

// ─── Furnished ────────────────────────────────────────────────────────────────

/** Furnishing a part says nothing about the property: "cocina amueblada", "furnished kitchen". */
const ROOM_EN =
  'kitchens?|rooms?|bedrooms?|terraces?|balcon(?:y|ies)|lounges?|patios?|gardens?|lanais?';
const ROOM_PL =
  'kuchni\\p{L}*|aneks\\p{L}*|pok[oó]j|sypialni\\p{L}*|salon\\p{L}*|taras\\p{L}*|balkon\\p{L}*';
const ROOM_ES = 'cocinas?|habitaci[oó]n(?:es)?|dormitorios?|sal[oó]n|terrazas?';
const FURNISHED = [
  `(?<!(?:${ROOM_EN})${S}(?:(?:is|are)${S})?)(?:fully[- ])?(?<!(?:part|partly|partially|semi|un|not|non)[ -])furnished(?!${S}(?:with|${ROOM_EN}|show|model)(?![${W}]))`,
  `fully[- ]furnished${S}with`,
  `(?<!(?:${ROOM_PL})${S}(?:(?:jest|są)${S})?)umeblowan(?:y|a|e|ą|ego|ej|ym|ych|ymi)(?!${S}(?:${ROOM_PL})(?![${W}]))`,
  `z${S}(?:(?:pełnym|całym)${S})?umeblowaniem`,
  `(?<!(?:${ROOM_ES})${S}(?:(?:est[aá]n?)${S})?)(?<!semi${S})amueblad[oa]s?(?!${S}(?:${ROOM_ES})(?![${W}]))`,
];
/** A listing's other words for it. "with its kitchen furniture" is not one. */
const FURNISHED_LISTING = [
  `with${S}(?:(?:all|the|its)${S})?(?:furniture|furnishings)`,
  `(?:furniture|furnishings)${S}included`,
  `z${S}(?:(?:całym|pełnym)${S})?(?:meblami|wyposażeniem)(?!${S}kuchenn\\p{L}*)`,
  `meble${S}w${S}cenie`,
  `con${S}(?:todos${S})?(?:los${S})?muebles`,
  `muebles${S}incluidos`,
];

// ─── Renewable fittings ───────────────────────────────────────────────────────

/** "solar" alone is no claim: a plot in Spanish, a street, "solarium", "solar gain". */
const SOLAR = [
  `solar${S}(?:panels?|array|hot${S}water|water${S}heating|heating|thermal|energy|power|system|installation)`,
  `solar-powered(?!${S}(?:lights?|lamps?|lanterns?))`,
  'photovoltaics?',
  `pv${S}(?:panels?|system|installation)`,
  `panel\\p{L}*${S}(?:słoneczn|fotowoltaiczn)\\p{L}*`,
  'fotowoltaik\\p{L}*',
  `instalacj\\p{L}*${S}(?:fotowoltaiczn|solarn)\\p{L}*`,
  `kolektor\\p{L}*${S}(?:słoneczn|solarn)\\p{L}*`,
  `(?:placas?|paneles?|instalaci[oó]n(?:es)?)${S}(?:solar(?:es)?|fotovoltaic\\p{L}*)`,
  `energ[ií]a${S}solar`,
  'fotovoltaic\\p{L}*',
];

// ─── Tenure and fees ──────────────────────────────────────────────────────────

const VACANT = [
  `vacant${S}possession`,
  `vacant${S}on${S}completion`,
  `sold${S}vacant`,
  `(?:property|home|flat|apartment|house|unit|villa)${S}is${S}(?:currently${S})?vacant`,
  `free${S}of${S}tenants`,
  `woln\\p{L}*${S}od${S}(?:najemc\\p{L}*|lokator\\p{L}*)`,
  `bez${S}(?:najemc\\p{L}*|lokator\\p{L}*)`,
  `libre${S}de${S}(?:inquilinos|arrendatarios|ocupantes)`,
  `sin${S}(?:inquilinos|arrendatarios|ocupantes)`,
];
/** "własność" alone is not a claim of copy ("na własność" is any purchase), a listing's fact is. */
const FREEHOLD = [
  'freehold',
  `pełn\\p{L}*${S}własnoś\\p{L}*`,
  `pleno${S}dominio`,
  `plena${S}propiedad`,
];
const FREEHOLD_LISTING = [
  `(?<!spółdzielcz\\p{L}*${S})własno(?:ść|ści|ścią)(?!${S}spółdzielcz\\p{L}*)`,
  `ksi[eę]g\\p{L}*${S}wieczyst\\p{L}*`,
];
/** "Low" is the seller's to say. A low price, "low-rent" and "low rental income" are not read. */
const LOW_FEES = [
  `low${S}(?:rent|service${S}charges?|fees|(?:community|condominium|condo|hoa|maintenance|monthly)${S}(?:fees?|charges?))`,
  `nisk\\p{L}+${S}czynsz\\p{L}*`,
  `czynsz\\p{L}*${S}(?:jest${S})?nisk\\p{L}+`,
  `baj[oa]s?${S}(?:alquiler|gastos${S}de${S}comunidad|cuotas?|comunidad)`,
  `(?:alquiler|cuotas?|comunidad|gastos${S}de${S}comunidad)${S}baj[oa]s?`,
];

// ─── New installations ────────────────────────────────────────────────────────

const NEW_ELECTRICS = [
  `new${S}(?:electrics|wiring|electrical${S}(?:installation|system|wiring))`,
  `(?:(?:fully|completely)${S})?re-?wired`,
  `now\\p{L}+${S}instalacj\\p{L}+${S}elektryczn\\p{L}*`,
  `instalacj\\p{L}*${S}elektryczn\\p{L}*${S}(?:jest${S})?now\\p{L}+`,
  `nueva${S}instalaci[oó]n${S}el[eé]ctrica`,
  `instalaci[oó]n${S}el[eé]ctrica${S}nueva`,
];
/** "Do wymiany" (to be replaced) is not here, and neither is an installation with no "new". */
const NEW_ELECTRICS_LISTING = [
  `(?:replaced|renewed|updated|upgraded)${S}(?:the${S})?(?:electrics|wiring|electrical)`,
  `(?:electrics|wiring|electrical${S}(?:installation|system))${S}(?:(?:was|were|has${S}been|have${S}been)${S})?(?:replaced|renewed|updated|upgraded)`,
  `(?<!do${S})wymian\\p{L}*${S}instalacji${S}elektrycznej`,
  `wymienion\\p{L}*${S}instalacj\\p{L}*${S}elektryczn\\p{L}*`,
  `instalacj\\p{L}*${S}elektryczn\\p{L}*${S}(?:(?:została|jest)${S})?wymienion\\p{L}*`,
  `instalaci[oó]n${S}el[eé]ctrica${S}(?:renovada|actualizada)`,
];
const NEW_BOILER = [
  `new${S}(?:(?:gas|combi|condensing)${S})?boiler`,
  `now\\p{L}+${S}(?:piec\\p{L}*|kocioł|kotł\\p{L}*)`,
  `(?:piec|kocioł)${S}(?:(?:jest|gazowy)${S})?now\\p{L}+`,
  `(?:nueva${S}caldera|caldera${S}nueva)`,
];
const NEW_PLUMBING = [
  `new${S}plumbing`,
  `now\\p{L}+${S}(?:hydraulik\\p{L}*|instalacj\\p{L}+${S}(?:wodn\\p{L}*|wod-kan\\p{L}*|hydrauliczn\\p{L}*))`,
  `(?:nueva${S}fontaner[ií]a|fontaner[ií]a${S}nueva)`,
];

// ─── The list ─────────────────────────────────────────────────────────────────

const ATTRIBUTES: readonly AttributeDef[] = [
  { key: 'single_storey', claim: SINGLE_STOREY, groundedBy: LEVEL_FACTS },
  {
    key: 'parterowy',
    claim: PARTEROWY,
    groundedBy: LEVEL_FACTS,
    weak: {
      groundedBy: ['parterze', `ground[- ]floor`, `planta${S}baja`],
      unless: new RegExp(
        `(?<![${W}])(?:na${S}pi[eę]trze|upstairs|upper${S}floor|first${S}floor|floor${S}above|planta${S}(?:alta|superior)|primera${S}planta)(?![${W}])`,
        'iu',
      ),
    },
  },
  { key: 'bungalow', claim: BUNGALOW, groundedBy: SINGLE_STOREY_HOUSE },
  { key: 'top_floor', claim: TOP_FLOOR, groundedBy: TOP_FLOOR_LISTING },
  {
    key: 'detached',
    claim: DETACHED,
    groundedBy: DETACHED_LISTING,
    weak: {
      groundedBy: [`single-family${S}(?:home|house|residence|property)`],
      unless: new RegExp(
        `(?<![${W}])(?:town-?(?:house|home)s?|row${S}(?:house|home)s?|terraced|end-terrace|semi-?detached|duplex|attached${S}(?:single-family|home|house))(?![${W}])`,
        'iu',
      ),
    },
  },
  ...DIRECTIONS.map((d) => ({ key: `orientation_${d.key}`, claim: orientationPatterns(d) })),
  { key: 'furnished', claim: FURNISHED, groundedBy: FURNISHED_LISTING },
  { key: 'solar', claim: SOLAR },
  { key: 'vacant_possession', claim: VACANT },
  { key: 'freehold', claim: FREEHOLD, groundedBy: FREEHOLD_LISTING },
  { key: 'low_fees', claim: LOW_FEES },
  { key: 'new_electrics', claim: NEW_ELECTRICS, groundedBy: NEW_ELECTRICS_LISTING },
  { key: 'new_boiler', claim: NEW_BOILER },
  { key: 'new_plumbing', claim: NEW_PLUMBING },
];

/** One attribute, compiled: {@link assertedAttributes} and {@link groundsAttribute} read it. */
interface Attribute {
  readonly key: string;
  readonly claim: RegExp;
  readonly grounding: RegExp;
  readonly weak?: { readonly grounding: RegExp; readonly unless: RegExp };
}

export const ATTRIBUTE_RES: readonly Attribute[] = ATTRIBUTES.map((a) => ({
  key: a.key,
  claim: wordRe(a.claim),
  grounding: wordRe([...a.claim, ...(a.groundedBy ?? [])]),
  ...(a.weak && { weak: { grounding: wordRe(a.weak.groundedBy), unless: a.weak.unless } }),
}));

// ─── Reading a match in its sentence ──────────────────────────────────────────

/**
 * An offer, a need or a possibility, right before the word: "could be furnished", "room for solar
 * panels", "needs new wiring", "można zamontować panele słoneczne", "posibilidad de instalar placas
 * solares". Nothing is stated about the property as it is.
 */
const NOT_STATED_BEFORE_RE = new RegExp(
  `(?<![${W}])(?:` +
    `(?:could|can|may|might|would|to)${S}(?:be${S}(?:sold${S})?|have${S}|add${S}|install${S}|fit${S}|take${S})|` +
    `(?:ready|room|space|potential|scope|ideal|suitable|option|possibility)${S}(?:for|of|to${S}(?:add|install|fit))${S}(?:(?:adding|installing|fitting)${S})?|` +
    `(?:needs?|needing|requires?|requiring|wants?)${S}(?:(?:a|an)${S})?|` +
    `można(?:${S}\\p{L}+)?${S}|możliwoś\\p{L}*(?:${S}\\p{L}+)?${S}|(?:miejsce|gotow\\p{L}*)${S}(?:pod|na)${S}|` +
    `(?:wymaga|wymagają|potrzebuje|potrzebn\\p{L}*)${S}|` +
    `(?:posibilidad|opci[oó]n)${S}de(?:${S}\\p{L}+)?${S}|(?:puede|pueden|podr[ií]an?)(?:${S}\\p{L}+)?${S}|` +
    `(?:necesitan?|requieren?)${S}` +
    `)$`,
  'iu',
);

/** A capital in mid-sentence is a name: "przy Parterowej", "the Solar Panels Café", "facing South". */
function readsAsName(text: string, start: number, match: string): boolean {
  if (/^\p{Ll}.*\p{Lu}/su.test(match)) return true;
  return /^\p{Lu}/u.test(match) && /\p{Ll},?[ \t]+$/u.test(text.slice(0, start));
}

/**
 * The attribute claims `pattern` finds asserted in `text`: not negated (the amenity rule), not an
 * offer or a need, not a name.
 *
 * @param pattern - A global pattern from {@link ATTRIBUTE_RES}.
 * @param text - Generated copy, or a listing's words, addresses masked.
 * @returns Each asserted match, as written.
 */
export function assertedAttributes(pattern: RegExp, text: string): string[] {
  return assertedMatches(pattern, text)
    .filter(
      (m) =>
        !NOT_STATED_BEFORE_RE.test(text.slice(0, m.index)) && !readsAsName(text, m.index, m[0]),
    )
    .map((m) => m[0]);
}

/**
 * Do the listing's own words ground this attribute?
 *
 * @param attribute - From {@link ATTRIBUTE_RES}.
 * @param listing - The listing's words, addresses masked. A denied fact grounds nothing.
 * @returns `true` when they do.
 */
export function groundsAttribute(attribute: Attribute, listing: string): boolean {
  if (assertedAttributes(attribute.grounding, listing).length > 0) return true;
  const { weak } = attribute;
  return (
    weak !== undefined &&
    !weak.unless.test(listing) &&
    assertedAttributes(weak.grounding, listing).length > 0
  );
}
