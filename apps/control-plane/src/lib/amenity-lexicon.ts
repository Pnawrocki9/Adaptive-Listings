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
  `(?<![${WORD}])(?:no|not|without|lacks?|lacking|neither|nor|bez|brak|braku|nie|ani|sin|ni|carece|carecen)(?![${WORD}])`,
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

/** The negation window: the same clause, within this many code points before a match. */
const NEGATION_WINDOW = 30;
const CLAUSE_BREAK_RE = /[.;:!?\n,]/gu;

/**
 * The clause before `start`: at most {@link NEGATION_WINDOW} code points, back to the last clause
 * mark.
 *
 * @param text - The text the match was found in.
 * @param start - The match's UTF-16 start index.
 * @returns The part of the window after the last clause mark.
 */
export function clauseBefore(text: string, start: number): string {
  const before = Array.from(text.slice(0, start));
  const window = before.slice(Math.max(0, before.length - NEGATION_WINDOW)).join('');
  let cut = 0;
  for (const m of window.matchAll(CLAUSE_BREAK_RE)) cut = m.index + m[0].length;
  return window.slice(cut);
}

function isNegated(text: string, start: number): boolean {
  return NEGATOR_RE.test(clauseBefore(text, start));
}

/**
 * At least one NON-negated match of `pattern`. A match followed by a spec-line negation ("Basen:
 * brak") is negated [FOLLOW-1383], and so is an item of a negated list ("no schools, nurseries or
 * playgrounds") [FOLLOW-1413].
 *
 * @param pattern - A global pattern.
 * @param text - The text to read.
 * @returns `true` when the text asserts what the pattern names.
 */
export function asserted(pattern: RegExp, text: string): boolean {
  for (const m of text.matchAll(pattern)) {
    if (isNegated(text, m.index) || negatedThroughList(text, m.index, isNegated)) continue;
    if (NEGATED_AFTER_RE.test(text.slice(m.index + m[0].length))) continue;
    return true;
  }
  return false;
}

/**
 * FOLLOW-1413: the separators of a coordinated list — a comma (optionally followed by a
 * coordinator) or a coordinator alone: and / or / nor, i / oraz / lub / albo / czy / ani,
 * y / o / ni. Anchored at the END of the text before a list item.
 */
const LIST_COORDINATORS = 'and|or|nor|i|oraz|lub|albo|czy|ani|y|o|ni';
const LIST_SEPARATOR_END_RE = new RegExp(
  `(?:[ \\t]*,[ \\t]*(?:(?:${LIST_COORDINATORS})[ \\t]+)?|[ \\t]+(?:${LIST_COORDINATORS})[ \\t]+)$`,
  'iu',
);
/** One word of a bare list item (letters, hyphen). */
const LIST_WORD_END_RE = /(?<![\p{L}\p{N}_-])[\p{L}-]+$/u;
/**
 * Words that end a negated list: a contrast ("but", "ale", "pero") or a verb that opens a new
 * statement ("is", "there", "jest", "ma", "hay", "tiene"). An item holding one is not a list item.
 */
const LIST_BREAK_WORD_RE = new RegExp(
  `^(?:but|however|yet|although|though|while|whereas|instead|except|is|are|has|have|there|it|` +
    `ale|lecz|jednak|natomiast|choć|chociaż|za|jest|są|ma|mają|` +
    `pero|sino|aunque|mientras|hay|tiene|tienen|es|está|están|con)$`,
  'iu',
);
/** At most this many words per list item, and this many items walked back. */
const LIST_ITEM_MAX_WORDS = 3;
const LIST_MAX_ITEMS = 8;
const ARTICLE_RE = /^(?:a|an|the|un|una)$/iu;

/**
 * The connectors that let a negation carry to the END of a list — disjunctive or negative only:
 * or / nor, ani / lub / albo / czy, ni / o [FOLLOW-1413, PM ruling: fail-closed]. A list closed by
 * and / i / oraz / y ("No garage, gym and pool included") does not carry the negation.
 */
const CARRYING_CONNECTOR_RE = /^(?:or|nor|ani|lub|albo|czy|ni|o)$/iu;
const LIST_CONNECTOR_WORD_RE = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${LIST_COORDINATORS})(?![\\p{L}\\p{N}_])`,
  'giu',
);
/** Where a list's clause ends: a sentence or clause mark, or a contrast. */
const LIST_CLAUSE_END_RE =
  /[.;:!?\n]|(?<![\p{L}\p{N}_])(?:but|however|yet|although|whereas|ale|lecz|jednak|natomiast|pero|sino|aunque)(?![\p{L}\p{N}_])/iu;

/**
 * FOLLOW-1413: is the match at `start` an item of a coordinated list whose first item is negated
 * ("no schools, nurseries or playgrounds", "nie wymienia szkół, przedszkoli ani placów zabaw",
 * "no menciona colegios, guarderías ni parques infantiles")?
 *
 * Walks back from `start`: a list separator (`LIST_SEPARATOR_END_RE`), then a bare item of one to
 * three words, then either another separator (keep walking) or the first item, which must be
 * negated by the caller's own window rule (`directlyNegated`). Never crosses a sentence end, a
 * semicolon or colon, a contrast or a new statement (`LIST_BREAK_WORD_RE`), and never an article
 * ("no garage, a garden" stays a claim). The list's FINAL connector (the last one before the
 * clause ends) must be disjunctive or negative (`CARRYING_CONNECTOR_RE`): "no pool, garage or
 * garden" carries, "no garage, gym and pool" and a comma-only list do not. Fail-closed.
 *
 * @param text - The text the match was found in.
 * @param start - The match's UTF-16 start index.
 * @param directlyNegated - The caller's negation rule, applied to the list's first item.
 * @returns `true` when the match is negated through the list.
 */
function negatedThroughList(
  text: string,
  start: number,
  directlyNegated: (text: string, start: number) => boolean,
): boolean {
  // The start of the negated first item, or -1.
  const walk = (end: number, items: number): number => {
    if (items >= LIST_MAX_ITEMS) return -1;
    const sep = LIST_SEPARATOR_END_RE.exec(text.slice(0, end));
    if (sep === null) return -1;
    // Grow the item one word at a time, leftwards from the separator: 1, 2, then 3 words.
    let itemStart = sep.index;
    for (let words = 0; words < LIST_ITEM_MAX_WORDS; words += 1) {
      const head = text.slice(0, itemStart).replace(/[ \t]+$/u, '');
      if (words > 0 && head.length === itemStart) break;
      const word = LIST_WORD_END_RE.exec(head);
      if (word === null || LIST_BREAK_WORD_RE.test(word[0]) || ARTICLE_RE.test(word[0])) break;
      itemStart = word.index;
      if (directlyNegated(text, itemStart)) return itemStart;
      const first = walk(itemStart, items + 1);
      if (first >= 0) return first;
    }
    return -1;
  };
  const first = walk(start, 0);
  if (first < 0) return false;
  // The list's final connector, between its first item and the end of its clause.
  let clause = text.slice(first);
  const end = LIST_CLAUSE_END_RE.exec(clause);
  if (end !== null) clause = clause.slice(0, end.index);
  const connectors = Array.from(clause.matchAll(LIST_CONNECTOR_WORD_RE), (m) => m[0]);
  const last = connectors.at(-1);
  return last !== undefined && CARRYING_CONNECTOR_RE.test(last);
}
