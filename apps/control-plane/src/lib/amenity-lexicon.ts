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

const POOL = ['(?:swimming[- ])?pools?', 'basen(?:u|em|ie|y|ów|ami|ach|om)?', 'piscinas?'];
const GARAGE = [
  'garages?',
  'garaż(?:u|em|e|y|ów|ami|ach|owy|owa|owe|ową|owym|owej|owego|owych)?',
  'garajes?|cocheras?',
];

const AMENITIES: readonly AmenityDef[] = [
  { names: POOL },
  {
    names: [
      '(?:sea|ocean|water|beach|bay)[- ]?views?|(?:sea|ocean)[- ]facing',
      'widok(?:u|iem|i|ów|ami)? na (?:morze|ocean|zatokę|plażę)',
      'vistas? (?:al|a la|sobre el|sobre la|del) (?:mar|océano|bahía|playa)|frente al mar',
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
