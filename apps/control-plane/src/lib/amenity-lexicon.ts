/**
 * The amenity vocabulary of the claim checks, in every supported language — FOLLOW-1383.
 *
 * One closed list, shared by the description path (`grounding-check.ts`, `checkBodyClaims` /
 * `checkHeadlineFacts`) and `/api/adapt` (`claim-containment.ts`, `checkUnsupportedClaims`). Each
 * amenity is ONE group whose pattern names it in English, Polish and Spanish, so a group asserted
 * in the text is grounded by the same group in the listing whatever language either is written
 * in: "kominek" grounds "fireplace", "fireplace" grounds "kominkiem", "piscina" grounds "pool".
 * Until FOLLOW-1383 the list was English only, so a Polish original grounded no English amenity
 * and a Polish or Spanish text was never checked at all.
 *
 * Polish inflection is spelled out as explicit endings per lemma, never an open stem: an open stem
 * would let a different word ground the claim ("ogrodzony" is fenced, not a garden; "komin" is a
 * chimney, not a fireplace). Two Polish forms are left out on purpose because they are English
 * words: "wind" (genitive plural of "winda") and "windy" (its genitive singular) — so "brak windy"
 * neither grounds nor denies an elevator, and "a windy headland" is no elevator claim. Closed and
 * deterministic: no fuzzy matching, no model call.
 *
 * Pure, no I/O.
 *
 * @module apps/control-plane/src/lib/amenity-lexicon
 */

/** Python's `\w` (`str.isalnum()` or `_`) as a class body — both paths' word class. */
const WORD = '\\p{L}\\p{N}_';

/** One amenity: the claim a text makes, and the patterns in the listing that ground it. */
interface AmenityDef {
  /** The amenity in en | pl | es. */
  readonly names: readonly string[];
  /** Other amenities that also ground this one (a garage grounds a parking claim). */
  readonly alsoGroundedBy?: readonly string[];
}

/**
 * FOLLOW-1394: people a "pool" can be made of. "The pool of buyers", "a pool of finished-product
 * tenants" and "the demand pool" are a market, not a swimming pool; "a pool of 10 x 5 m" and
 * "the swimming pool of the complex" are still a pool.
 */
const POOL_PEOPLE =
  'buyers?|purchasers?|tenants?|renters?|lessees?|households?|occupants?|guests?|investors?|' +
  'bidders?|applicants?|candidates?|people|families|end[- ]users?|demand|talent|labou?r';
const POOL = [
  'swimming[- ]pools?',
  `(?<!(?:${POOL_PEOPLE}|rental|resale)[- ])pools?(?![ \\t]+of[ \\t]+(?:[\\p{L}-]+[ \\t]+){0,2}(?:${POOL_PEOPLE})(?![\\p{L}]))`,
  'basen(?:u|em|ie|y|ów|ami|ach|om)?',
  'piscinas?',
];
const GARAGE = [
  'garages?',
  'garaż(?:u|em|e|y|ów|ami|ach|owy|owa|owe|ową|owym|owej|owego|owych)?',
  'garajes?|cocheras?',
];

/**
 * FOLLOW-1411: schools, nurseries and playgrounds near the property — "local amenities" in the
 * estate-agent sense. ESC-089 (CEO 2026-10-29) lifted the familial-status refusal, so family copy
 * may name them again, but only as the listing does (§E.7.0, ESC-076): an invented "close to good
 * schools" is an unsupported amenity like an invented pool. The routine of a school day ("the
 * school run", "mornings before school", "po szkole", "antes del colegio") names no school and is
 * not a claim; a school's name in the listing ("Szkoła Podstawowa nr 5") grounds one.
 */
const SCHOOL = [
  '(?<!(?:before|after|nursery)[ \\t]+)schools?(?![ \\t]+(?:runs?|days?|holidays?|years?|age|bags?|uniforms?|mornings?|terms?))|catchments?',
  '(?<!(?:przed|po)[ \\t]+)(?:szkoł(?:a|y|ę|ą|om|ami|ach)|szkole|szkół)|podstawów(?:ka|ki|kę|ką|ce|ek|kom|kami|kach)',
  '(?<!(?:antes|después|despues)[ \\t]+del[ \\t]+|ruta[ \\t]+del[ \\t]+)colegios?|escuelas?(?![ \\t]+infantil)',
];
const NURSERY = [
  'kindergartens?|pre-?schools?|nursery[ \\t]+schools?|day[- ]?care(?:[ \\t]+cent(?:re|er)s?)?|cr[eè]ches?',
  'przedszkol(?:e|a|u|em|i|om|ami|ach)|żłob(?:ek|ka|ku|kiem|ki|ków|kom|kami|kach)',
  'guarder[ií]as?|escuelas?[ \\t]+infantil(?:es)?',
];
const PLAYGROUND = [
  'playgrounds?|play[ \\t]?parks?|play[ \\t]+areas?',
  'plac(?:u|em|e|ów|om|ami|ach)?[ \\t]+zabaw',
  'parques?[ \\t]+infantil(?:es)?|zonas?[ \\t]+infantil(?:es)?|áreas?[ \\t]+de[ \\t]+juegos?|columpios',
];

const AMENITIES: readonly AmenityDef[] = [
  { names: POOL },
  {
    names: [
      '(?:sea|ocean|water|beach|bay)[- ]?views?|(?:sea|ocean)[- ]facing|' +
        // FOLLOW-1394: the views-of-the-sea phrasing is the same claim.
        'views? (?:of|over|across|to|towards) the (?:sea|ocean|bay|beach)',
      'widok(?:u|iem|i|ów|ami)? na (?:morze|ocean|zatokę|plażę)',
      'vistas? (?:al|a la|sobre el|sobre la|del) (?:mar|océano|bahía|playa)|frente al mar',
    ],
    // FOLLOW-1394: a view that names other things before the sea, in the same sentence ("views
    // of the Montgó mountain and, from the upper terrace, of the sea", "widokiem na góry i
    // morze", "vistas a la montaña y al mar").
    alsoGroundedBy: [
      `views? (?:of|over|across|to|towards)[^.;!?\\n]{0,80}?(?<![\\p{L}])(?:of |over |across |to |and )the (?:sea|ocean|bay)`,
      `widok(?:u|iem|i|ów|ami)? na [^.;!?\\n]{0,60}?(?<![\\p{L}])(?:morze|ocean|zatokę)`,
      `vistas? (?:a|al|sobre|hacia)[^.;!?\\n]{0,60}?(?<![\\p{L}])(?:mar|océano|bahía)`,
    ],
  },
  {
    names: [
      'gardens?',
      'ogr[oó]d(?:u|em|zie|y|ów|om|ami|ach)?|ogr[oó]d(?:ek|ka|kiem|ku|ki|ków|kami|kach)',
      'jard[ií]n(?:es)?',
    ],
  },
  { names: GARAGE },
  { names: ['balcon(?:y|ies)', 'balkon(?:u|em|ie|y|ów|ami|ach|om)?', 'balc[oó]n(?:es)?'] },
  { names: ['(?:roof[- ]?)?terraces?', 'taras(?:u|em|ie|y|ów|ami|ach|om)?', 'terrazas?'] },
  { names: ['elevators?|lifts?', 'wind(?:a|zie|ę|ą|ami|ach)', 'ascensor(?:es)?'] },
  { names: ['gyms?|fitness (?:room|centre|center)', 'siłowni(?:a|ę|ą)?', 'gimnasios?'] },
  { names: ['saunas?', 'saun(?:y|ą|ę|ie|ami|ach)'] },
  {
    names: ['jacuzzis?|hot[- ]tubs?', 'hydromasaż(?:u|em)?', 'bañeras? de hidromasaje|hidromasaje'],
  },
  {
    names: [
      'tennis courts?',
      'kort(?:u|em|y|ów|ami)? tenisow(?:y|ego|ym|e|ych)',
      'pistas? de tenis',
    ],
  },
  { names: ['fireplaces?', 'komin(?:ek|ka|kiem|ku|ki|ków|kami|kach)', 'chimeneas?'] },
  {
    names: [
      'air[- ]condition(?:ing|ed)',
      'klimatyzacj(?:a|i|ę|ą)|klimatyzowan(?:y|e|a|ego|ym|ej|ych)',
      'aire acondicionado|climatizaci[oó]n|climatizad[oa]s?',
    ],
  },
  { names: ['concierge', 'portier(?:a|em|ni|nia|nię|nią)?', 'conserjer[ií]a|conserjes?'] },
  {
    names: [
      'planning (?:permission|consent)|building permits?',
      'pozwoleni(?:e|a|em|u) na budowę|warunk(?:i|ów|ami) zabudowy',
      'licencias? de (?:obras?|construcci[oó]n)|permisos? de construcci[oó]n',
    ],
  },
  { names: ['basements?|cellars?', 'piwnic(?:a|y|ę|ą|e|ach|ami)?', 's[oó]tanos?|bodegas?'] },
  {
    names: [
      'parking|car[- ]?parks?',
      'miejsc(?:e|a|em|u)? (?:parkingow|postojow)(?:e|ego|ym|ych|a)|parking(?:u|iem)?',
      'aparcamientos?|plazas? de (?:aparcamiento|parking)',
    ],
    alsoGroundedBy: GARAGE,
  },
  // FOLLOW-1411: surroundings a family copy may name only as the listing does.
  { names: SCHOOL },
  { names: NURSERY },
  { names: PLAYGROUND },
];

function wordRe(patterns: readonly string[]): RegExp {
  return new RegExp(`(?<![${WORD}-])(?:${patterns.join('|')})(?![${WORD}-])`, 'giu');
}

/**
 * Every amenity as a pair of global, case-insensitive patterns: `claim` is what a text asserts,
 * `grounding` what in the listing supports it (the claim itself, plus `alsoGroundedBy`).
 */
export const AMENITY_RES: readonly { readonly claim: RegExp; readonly grounding: RegExp }[] =
  AMENITIES.map((a) => ({
    claim: wordRe(a.names),
    grounding: wordRe([...a.names, ...(a.alsoGroundedBy ?? [])]),
  }));

/**
 * A negator in en | pl | es, as a whole word (Unicode word boundaries, so "właśnie" holds no
 * "nie"). Both paths look for it in the same clause within 30 characters BEFORE an amenity.
 */
export const NEGATOR_RE = new RegExp(
  `(?<![${WORD}])(?:no|not|without|lacks?|lacking|nor|bez|brak|braku|nie|ani|sin|ni|carece|carecen)(?![${WORD}])`,
  'iu',
);

/**
 * A negation right AFTER an amenity, as Polish spec lines write it ("Basen: brak", "Winda - nie",
 * "Garażu brak", "Pool: no"). Anchored at the end of the amenity's match.
 */
export const NEGATED_AFTER_RE = new RegExp(
  `^(?:[ \\t]*[:–—-][ \\t]*(?:brak|nie|no|none|sin|ninguno|ninguna)|[ \\t]+brak)(?![${WORD}])`,
  'iu',
);
