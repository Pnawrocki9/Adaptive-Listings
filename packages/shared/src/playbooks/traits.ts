/**
 * Trait add-ons — what each of the 7 buyer traits adds to the copy [FOLLOW-1360, Faza Q §A].
 *
 * A trait never changes the archetype (MASTER_DESIGN §E.4.3 v3.0); it attaches a SMALL rule set and
 * at most one invitation slot to whatever the archetype's playbook already says. The rules are
 * distilled from the playbook the trait absorbed (`premium` ← luxury_buyer, `works_from_home` ←
 * remote_worker, `residency_goal` ← golden_visa_buyer, `seasoned_investor` ← portfolio_builder);
 * the other three are short rule sets written here.
 *
 * GROUNDING (MASTER_DESIGN §E.7.0 / ESC-076). Every rule is phrased so it can only be obeyed with
 * a fact the listing states ("only where the listing says …"), and every rule ends in a prohibition,
 * so a trait can never be the reason a claim appears. Rules are PROMPT GUIDANCE: the text a model
 * writes under them still passes the existing deterministic checks (`checkDirectiveFacts`,
 * `checkUnsupportedClaims`, the description claim contract) exactly as without the trait.
 *
 * THE SLOT. A trait's optional `trait_note` slot is an INVITATION the buyer can accept ("Ask About
 * Home Office Space"), never a statement about the property — the same class as the `cta` strings
 * enumerated in `ungrounded-directives.ts`. It asserts nothing, so it is the one trait element
 * that may be served on the playbook branches, where no listing was read. `has_children` has no
 * slot: its contribution is emphasis in the copy (family wording, and the listing's own bedrooms,
 * garden, storage and — only where the listing names them — schools or parks). Since ESC-089 (CEO
 * 2026-10-29) familial status is not a copy constraint; FOLLOW-1360's "physical facts only, never
 * address the reader as a parent" rule is lifted [FOLLOW-1411].
 *
 * @module @estalara/shared/playbooks/traits
 */

import type { ArchetypeId } from '../directives.js';
import { CANONICAL_TRAIT_IDS, isTraitId, type TraitId } from '../traits.js';
import { luxuryBuyerPlaybook } from './archetypes/luxury-buyer.js';
import { remoteWorkerPlaybook } from './archetypes/remote-worker.js';
import { goldenVisaBuyerPlaybook } from './archetypes/golden-visa-buyer.js';
import { portfolioBuilderPlaybook } from './archetypes/portfolio-builder.js';
import type { ListingClassRule, SlotDirective } from './types.js';

/** The slot every trait invitation is served on. */
export const TRAIT_NOTE_SLOT = 'trait_note';

/** One trait's contribution. */
export interface TraitAddOn {
  /** The trait this add-on belongs to. */
  trait: TraitId;
  /** The playbook the trait absorbed; `null` for the traits that are new. */
  source: ArchetypeId | null;
  /** Prompt rules (English; the model writes in the request locale). Each is listing-grounded. */
  rules: readonly string[];
  /** The absorbed playbook's `listing_rules` (card boost/suppress); `null` when there is none. */
  listing_rules: ListingClassRule | null;
  /** At most one invitation slot; `null` for `has_children`. */
  slot: SlotDirective | null;
}

const invitation = (en: string, pl: string, es: string): SlotDirective => ({
  slot: TRAIT_NOTE_SLOT,
  en,
  pl,
  es,
});

/** The 7 add-ons, keyed by trait. */
const ADD_ONS: Readonly<Record<TraitId, TraitAddOn>> = {
  premium: {
    trait: 'premium',
    source: 'luxury_buyer',
    rules: [
      'Write discreetly and with understatement. Lead with finishes, fittings or setting only where the listing describes them.',
      'Never name a fittings brand and never describe a view unless the listing names it. Say "premium" or "high-end" only if the listing does.',
    ],
    listing_rules: luxuryBuyerPlaybook.listing_rules,
    slot: invitation(
      'Request a Private Viewing',
      'Poproś o prywatną prezentację',
      'Solicita una visita privada',
    ),
  },
  works_from_home: {
    trait: 'works_from_home',
    source: 'remote_worker',
    rules: [
      'Mention a study, spare room, flex room or quiet corner only if the listing lists such a room or space.',
      'Never quote a broadband speed, latency, or a time to a station or hub unless the listing states it.',
    ],
    listing_rules: remoteWorkerPlaybook.listing_rules,
    slot: invitation(
      'Ask About Home Office Space',
      'Zapytaj o miejsce na gabinet',
      'Pregunta por espacio para teletrabajar',
    ),
  },
  residency_goal: {
    trait: 'residency_goal',
    source: 'golden_visa_buyer',
    rules: [
      'Mention residency or a visa only if the listing itself mentions it; then repeat only what it says.',
      'Never state an investment threshold, an eligibility rule or a pathway the listing does not state, and never imply that this property qualifies for any residency programme.',
    ],
    listing_rules: goldenVisaBuyerPlaybook.listing_rules,
    slot: invitation(
      'Ask About Residency Requirements',
      'Zapytaj o wymogi pobytowe',
      'Consulta los requisitos de residencia',
    ),
  },
  seasoned_investor: {
    trait: 'seasoned_investor',
    source: 'portfolio_builder',
    rules: [
      'Use a direct, numbers-literate voice. Foreground only figures, tenancy and unit-count facts that the listing states.',
      'Never state or imply a yield, rental income, occupancy, discount, financing term or multi-unit potential the listing does not state.',
    ],
    listing_rules: portfolioBuilderPlaybook.listing_rules,
    slot: invitation(
      'Request an Investment Pack',
      'Poproś o pakiet inwestycyjny',
      'Solicita un dosier de inversión',
    ),
  },
  buying_from_abroad: {
    trait: 'buying_from_abroad',
    source: null,
    rules: [
      'Write plainly for a reader who cannot visit easily. Mention remote viewing, video tours or local representation only if the listing or the agency context says they are offered.',
      'Never state purchase-process, legal, tax or currency facts, and never state a completion time.',
    ],
    listing_rules: null,
    slot: invitation(
      'Ask About Buying From Abroad',
      'Zapytaj o zakup z zagranicy',
      'Consulta cómo comprar desde el extranjero',
    ),
  },
  will_let: {
    trait: 'will_let',
    source: null,
    rules: [
      'Foreground only the facts a letting reader weighs that the listing states: bedrooms, furnishing, the property type, the location as named.',
      'Never state rental demand, income, a licence or permit, or that letting is permitted, unless the listing states it.',
    ],
    listing_rules: null,
    slot: invitation(
      'Ask About Letting This Home',
      'Zapytaj o wynajem tej nieruchomości',
      'Consulta sobre el alquiler de esta vivienda',
    ),
  },
  has_children: {
    trait: 'has_children',
    source: null,
    rules: [
      'Write for a household with children: foreground what a family weighs, as the listing states it — the bedroom count (a room each), a garden or outdoor space to play, storage, the layout — and schools, nurseries, parks or playgrounds only where the listing names them (when it names none, leave them out rather than noting their absence).',
      'Never invent a school, catchment, playground, distance or safety claim, and call an area safe or family-friendly only if the listing does.',
    ],
    listing_rules: null,
    slot: null,
  },
};

/**
 * Normalise a raw trait list: keep canonical ids only, drop duplicates, cap at 7, and return them
 * in canonical order so the same set always renders the same prompt.
 *
 * @param traits - Untrusted input (a request body field); anything not a trait id is dropped.
 * @returns The add-ons for the traits that are present; `[]` when none is.
 */
export function getTraitAddOns(traits: readonly unknown[] | undefined): TraitAddOn[] {
  if (!traits || traits.length === 0) return [];
  const present = new Set(traits.filter(isTraitId));
  return CANONICAL_TRAIT_IDS.filter((id) => present.has(id)).map((id) => ADD_ONS[id]);
}

/**
 * The prompt block the trait rules render as, appended to an archetype's guidance. Empty string
 * when no trait is present, so a request without traits builds a byte-identical prompt.
 *
 * @param addOns - From {@link getTraitAddOns}.
 * @returns The block, or `''`.
 */
export function renderTraitRules(addOns: readonly TraitAddOn[]): string {
  if (addOns.length === 0) return '';
  const lines = addOns.flatMap((a) => a.rules.map((r) => `- [${a.trait}] ${r}`));
  return (
    'Buyer traits (secondary facts about the reader; they add emphasis, never facts about the ' +
    'property, and every rule below yields to the grounding rules above):\n' +
    lines.join('\n')
  );
}

/**
 * The invitation slots the present traits add, in canonical order.
 *
 * @param addOns - From {@link getTraitAddOns}.
 * @returns One slot per trait that has one; the playbook branches serve these unread-listing-safe
 *          invitations (they assert nothing about the property).
 */
export function traitSlots(addOns: readonly TraitAddOn[]): SlotDirective[] {
  return addOns.flatMap((a) => (a.slot ? [a.slot] : []));
}

/**
 * Statements about the race, ethnic origin or religion of residents or neighbours — the one
 * protected-ground guard left on generated copy after ESC-089 (CEO 2026-10-29) lifted the
 * familial-status refusal (FOLLOW-1360 / FOLLOW-1400) [FOLLOW-1411]. EU Directive 2000/43/EC and
 * the PL Act of 3 Dec 2010 on equal treatment cover access to housing on racial or ethnic origin,
 * and the PL act religion; familial status is not a ground there, so family wording is allowed.
 *
 * The CEO's follow-up ruling (2026-10-30) [FOLLOW-1415] narrows it to discrimination, not facts,
 * on one condition — the copy must stir no controversy — as three rules:
 *   1. PASS — a historical fact or place ("the old Jewish quarter", "historically home to
 *      Kraków's Jewish community", "dawna dzielnica żydowska") and a building or institution.
 *   2. REFUSE — present-day residents described by race, ethnic origin or religion, and every
 *      exclusionary or composition statement ("predominantly Catholic", "no immigrants"),
 *      historical qualifier or not.
 *   3. REFUSE — sensitive or traumatic history, even as a fact ({@link SENSITIVE_HISTORY}).
 *
 * The CEO's decisions of 2026-10-30 [FOLLOW-1419] tighten rules 1 and 3, never the family wording
 * ESC-089 allowed:
 *   - Rule 3 also refuses terms that can evoke painful associations: Nazi / German / Soviet
 *     occupation, the Nazis, the Gestapo, the SS, the Third Reich; the camps by name (Auschwitz,
 *     Birkenau, Treblinka, Majdanek, Sobibór, Bełżec, Stutthof, …); expulsions and displacement
 *     ("wysiedlenia", "expelled", "la expulsión de los judíos"); deportations by train
 *     ("wywózki", "wywiezieni", "death trains"); round-ups ("łapanka") and forced labour. A town
 *     that shares a camp's name (Oświęcim, Brzezinka, Dachau, Kraków's Płaszów district) passes;
 *     only "obóz Płaszów", "KL Plaszow", "Dachau camp" refuse. Ordinary listing words stay out:
 *     "przedwojenna / powojenna kamienica", "pre-war", "ready for occupation", "transport links",
 *     "wywózka śmieci", "ocupación inmediata".
 *   - Rule 1 narrows for a PLACE named by race, ethnic origin or religion ("dzielnica żydowska",
 *     "the Jewish quarter", "the Muslim neighbourhood", "barrio judío", "la judería"): it passes
 *     ONLY with a historical adjective directly before it ("dawna", "stara", "former", "old",
 *     "historic", "antiguo / antigua"), {@link PLACE_GROUND_PATTERNS}. A building or institution
 *     ("a synagogue nearby", "a Catholic school", "a church") and a street's name ("ul.
 *     Żydowska") stay allowed.
 * Prices are untouched: a figure is only ever the listing's exact figure (the digit rule in
 * `grounding-check`), so "850 tys." for 849 000 stays refused.
 *
 * A NARROW, closed en / pl / es phrase list, not a classifier: the gateway and the description
 * path refuse a text that matches, whoever wrote the words. What it is NOT: a buyer's nationality
 * or origin ("diaspora", "returning home", "an international / British community" — buyer
 * targeting is a product feature, ESC-089); a place's name ("the former Jewish Quarter", "dawna
 * dzielnica żydowska", "el antiguo barrio judío"); a building or institution ("a church nearby",
 * "the Jewish Community Centre", "a Catholic school"). Colour words count in English only and only
 * before a word for people ("white residents"), because "mostly white walls", "Białe ściany" and
 * the Andalusian "pueblos blancos" are not about anyone. Boundaries are Unicode-aware (`\b` is
 * ASCII-only).
 */
const B = String.raw`(?<![\p{L}\p{N}])`;
const E = String.raw`(?![\p{L}\p{N}])`;
/** en: race, ethnic origin or religion, as an adjective; colours only with {@link EN_PEOPLE}. */
const EN_GROUND_NO_COLOUR =
  'asian|hispanic|latino|latina|arab|roma|gypsy|christian|catholic|protestant|' +
  'muslim|islamic|jewish|hindu|sikh|buddhist';
const EN_GROUND = `white|black|${EN_GROUND_NO_COLOUR}`;
/** en: words for the people who live somewhere. */
const EN_PEOPLE =
  'residents?|neighbou?rs?|community|communities|population|families|people|locals|' +
  'households?|enclaves?|ghettos?';
const EN_PLACE = String.raw`areas?|neighbou?rhoods?|districts?|streets?|estates?|buildings?|blocks?`;
/**
 * en: an area a group could be said to live in — no building or street, whose naming by a group is
 * an institution or an address ("a Catholic school", "Jewish Street") [FOLLOW-1419].
 */
const EN_AREA = String.raw`areas?|neighbou?rhoods?|districts?|quarters?|enclaves?|towns?|villages?`;
/** en: what makes an area named by a group a building's or an institution's name instead. */
const EN_INSTITUTION = String.raw`cent(?:re|er)s?|halls?|museums?|cemeter(?:y|ies)|schools?`;
const EN_MOSTLY = String.raw`predominantly|mostly|largely|mainly|overwhelmingly|exclusively|almost\s+exclusively|almost\s+entirely|entirely`;
const EN_GROUP_NOUN =
  'muslims|jews|christians|catholics|hindus|sikhs|arabs|asians|hispanics|latinos';
const EN_EXCLUDED =
  'immigrants|migrants|refugees|asylum\\s+seekers|minorities|ethnic\\s+minorities|gypsies';
/**
 * pl: race, ethnic origin or religion, as an adjective stem cut before the -sk/-ck / -sc/-cc
 * alternation ("muzułmańska", "muzułmańscy"); no colours ("białe ściany").
 */
const PL_GROUND = String.raw`(?:roms|cygańs|arabs|azjatyc|żydows|muzułmańs|islams|katolic|chrześcijańs|prawosławn|protestanc|ewangelic)\p{L}*`;
/** pl: the same grounds as nouns for people ("katolicy", "muzułmanie", "Żydzi", "Romowie"). */
const PL_GROUP_NOUN =
  'katolicy|katolików|muzułmanie|muzułmanów|żydzi|żydów|chrześcijanie|chrześcijan|romowie|' +
  'romów|cyganie|cyganów|arabowie|arabów|azjaci|azjatów|hindusi|hindusów';
const PL_PLACE = String.raw`(?:dzielnic|okolic|osiedl|ulic|kamienic|budyn)\p{L}*`;
/** pl: an area (see {@link EN_AREA}); no "ulica", "kamienica" or "budynek" [FOLLOW-1419]. */
const PL_AREA = String.raw`(?:dzielnic|okolic|osiedl|kwarta[lł]|miasteczk|rejon)\p{L}*`;
/** pl: an institution after the adjective ("w okolicy katolickiego kościoła"). */
const PL_INSTITUTION = String.raw`(?:kości|synagog|cerkw|meczet|szkoł|szkol|cmentarz|muze|świątyn|parafi|gmin|przedszkol)\p{L}*`;
const PL_PEOPLE = String.raw`(?:mieszkańc|sąsiad|sąsiedz|społecznoś|ludnoś|rodzin|enklaw|gett)\p{L}*`;
const PL_MOSTLY = String.raw`głównie|przeważnie|w\s+większości|wyłącznie|niemal\s+wyłącznie|prawie\s+wyłącznie|sami|tylko`;
const PL_EXCLUDED = String.raw`(?:imigrant|migrant|uchodźc|uchodźców|mniejszoś|romów|cyganów)\p{L}*`;
/** es: race, ethnic origin or religion, as an adjective stem; colours only with people. */
const ES_GROUND_NO_COLOUR = String.raw`(?:musulm[aá]n|isl[aá]mic|jud[ií]|cat[oó]lic|cristian|protestante|ortodox|gitan|[aá]rabe|asi[aá]tic)\p{L}*`;
const ES_GROUND = String.raw`(?:${ES_GROUND_NO_COLOUR}|(?:blanc|negr)\p{L}*)`;
const ES_PEOPLE =
  'vecinos|vecindario|residentes|comunidad|población|poblacion|familias|habitantes|enclave|gueto';
const ES_PLACE = 'barrio|zona|distrito|calle|urbanización|urbanizacion|edificio';
/** es: an area (see {@link EN_AREA}) [FOLLOW-1419]. */
const ES_AREA = 'barrios?|zonas?|distritos?|vecindarios?';
const ES_MOSTLY =
  'mayoritariamente|predominantemente|principalmente|exclusivamente|casi\\s+exclusivamente|sobre\\s+todo';
const ES_EXCLUDED = String.raw`(?:inmigrantes|migrantes|refugiados|minor[ií]as|gitanos)`;

/**
 * Rule 1 / 2 boundary: a group of residents named by race, ethnic origin or religion, with no
 * claim about how many there are. Refused unless {@link isHistoricalMention} — "the former Jewish
 * community" is a fact about a place's past, "a welcoming Jewish community" is about who lives
 * there now [FOLLOW-1415].
 */
const RESIDENT_GROUND_PATTERNS: readonly string[] = [
  // en — "Muslim neighbours", "a white community" (not "the Jewish Community Centre")
  String.raw`(?:${EN_GROUND})\s+(?:${EN_PEOPLE})(?!\s+(?:cent(?:re|er)s?|halls?|museums?|cemeter(?:y|ies)|schools?))`,
  // pl — "katolicka społeczność", "muzułmańscy sąsiedzi", and the noun first: "społeczność
  // muzułmańska", "mieszkańcy żydowscy"
  String.raw`${PL_GROUND}\s+${PL_PEOPLE}`,
  String.raw`${PL_PEOPLE}\s+${PL_GROUND}`,
  // "zamieszkana przez katolików"
  String.raw`zamieszkan\p{L}*\s+przez\s+(?:${PL_GROUP_NOUN}|${PL_GROUND})`,
  // es — "vecinos musulmanes", "comunidad judía"
  String.raw`(?:${ES_PEOPLE})\s+${ES_GROUND}`,
];

/**
 * Rule 1 narrowed (CEO 2026-10-30) [FOLLOW-1419]: a PLACE named by race, ethnic origin or
 * religion. Refused unless a historical adjective stands directly before it ("the former Jewish
 * quarter", "dawna dzielnica żydowska", "la antigua judería") — "the Jewish quarter" or
 * "żydowska dzielnica" alone reads as who lives there now.
 */
const PLACE_GROUND_PATTERNS: readonly string[] = [
  // en — "the Jewish quarter", "a Muslim neighbourhood" (not "the Jewish district school")
  String.raw`(?:${EN_GROUND_NO_COLOUR})\s+(?:${EN_AREA})(?!\s+(?:${EN_INSTITUTION}))`,
  // pl — "żydowska dzielnica", "dzielnica żydowska" (not "w okolicy katolickiego kościoła")
  String.raw`${PL_GROUND}\s+${PL_AREA}`,
  String.raw`${PL_AREA}\s+${PL_GROUND}(?!\s+${PL_INSTITUTION})`,
  // es — "barrio judío", and the quarter that names its group: "la judería", "la morería"
  String.raw`(?:${ES_AREA})\s+${ES_GROUND_NO_COLOUR}`,
  String.raw`juder[ií]as?|morer[ií]as?`,
];

/**
 * Rule 2: how many residents belong to a group, or that a group is absent — refused whatever the
 * tense or qualifier ("historically and still predominantly Muslim residents") [FOLLOW-1415].
 */
const COMPOSITION_PATTERNS: readonly string[] = [
  // en — "a predominantly Catholic neighbourhood", "mostly Muslims"
  String.raw`(?:${EN_MOSTLY})\s+(?:${EN_GROUND})\s+(?:${EN_PEOPLE})`,
  String.raw`(?:${EN_MOSTLY})\s+(?:${EN_GROUND_NO_COLOUR})\s+(?:${EN_PLACE})`,
  String.raw`(?:${EN_MOSTLY})\s+(?:${EN_GROUP_NOUN})`,
  // "the area is mostly Christian", "residents are predominantly Asian"
  String.raw`(?:${EN_PEOPLE})\s+(?:is|are)\s+(?:${EN_MOSTLY})\s+(?:${EN_GROUND}|${EN_GROUP_NOUN})`,
  String.raw`(?:${EN_PLACE})\s+(?:is|are)\s+(?:${EN_MOSTLY})\s+(?:${EN_GROUND_NO_COLOUR}|${EN_GROUP_NOUN})`,
  // "no immigrants", "free of minorities"
  String.raw`(?:no|few|without|free\s+of|zero)\s+(?:${EN_EXCLUDED})`,
  // "ethnically diverse", "religiously homogeneous"
  String.raw`(?:ethnically|racially|religiously)\s+(?:diverse|homogen(?:e|o)ous|mixed|uniform)`,
  // pl — "mieszkańcy to głównie katolicy", "w większości muzułmanie" (not "głównie azjatycka kuchnia")
  String.raw`(?:${PL_MOSTLY})\s+(?:${PL_GROUP_NOUN})`,
  // "dzielnica głównie katolicka"
  String.raw`${PL_PLACE}\s+(?:${PL_MOSTLY})\s+${PL_GROUND}`,
  // "zamieszkana głównie przez katolików"
  String.raw`zamieszkan\p{L}*\s+(?:${PL_MOSTLY})\s+przez\s+(?:${PL_GROUP_NOUN}|${PL_GROUND})`,
  // "bez imigrantów", "mało mniejszości"
  String.raw`(?:bez|mało|niewielu|brak)\s+${PL_EXCLUDED}`,
  String.raw`(?:etnicznie|rasowo|religijnie)\s+(?:jednorodn|zróżnicowan|mieszan|jednolit)\p{L}*`,
  // es — "vecinos mayoritariamente musulmanes"
  String.raw`(?:${ES_PEOPLE})\s+(?:${ES_MOSTLY})\s+${ES_GROUND}`,
  // "un barrio mayoritariamente musulmán" (not "el antiguo barrio judío")
  String.raw`(?:${ES_PLACE})\s+(?:${ES_MOSTLY})\s+${ES_GROUND_NO_COLOUR}`,
  // "sin inmigrantes", "pocos gitanos"
  String.raw`(?:sin|pocos|pocas|libre\s+de)\s+${ES_EXCLUDED}`,
  String.raw`(?:étnica|etnica|racial|religiosa)mente\s+(?:divers|homog[eé]ne|mixt|uniform)\p{L}*`,
];

/**
 * Rule 3: sensitive or traumatic history — refused even as a fact and whatever the qualifier
 * ("the former ghetto", "dawne getto", "el antiguo gueto") [FOLLOW-1415]. Polish "getto" is
 * listed by form, not by stem, so "Gettysburg" stays out; Spanish "deport-" only as
 * "deportación", so "polideportivo" stays out.
 */
/**
 * A town that shares a camp's name; refused only beside a camp word [FOLLOW-1419]. Oświęcim and
 * Brzezinka are towns, Płaszów a Kraków district with a railway station, Dachau, Mauthausen and
 * Sachsenhausen (a Frankfurt district) towns with listings, Chełmno a town on the Vistula.
 */
const CAMP_TOWN = String.raw`(?:o[sś]wi[eę]cim\p{L}*|brzezink\p{L}*|p[lł]asz[oó]w\p{L}*|dachau|mauthausen|sachsenhausen|che[lł]mn\p{L}*|terez[ií]n\p{L}*)`;
/** pl: what is hauled away in a listing ("wywózka śmieci"), so the word is not a deportation. */
const PL_HAULED = String.raw`śmieci|odpad\p{L}*|gruz\p{L}*|nieczystoś\p{L}*|szamb\p{L}*|gabaryt\p{L}*|mebli|liści|śniegu|ziemi|fekali\p{L}*`;
const SENSITIVE_HISTORY: readonly string[] = [
  // en
  String.raw`holo[ck]aust\p{L}*|sho[aá]h?|ghettos?|ghettoes|deportations?|deported|deportees?|pogroms?`,
  String.raw`massacr(?:e|es|ed)|ethnic\s+cleansing|genocid(?:e|es|al)|war\s+crimes?`,
  String.raw`(?:concentration|extermination|death)\s+camps?`,
  // pl
  String.raw`szoa|zagład\p{L}*|getto|getta|gettu|gettem|getcie|gettach|deportacj\p{L}*|deportowan\p{L}*`,
  String.raw`pogrom\p{L}*|masakr\p{L}*|rzeź|rzezi|czystk\p{L}*\s+etniczn\p{L}*|ludobójstw\p{L}*|ludobójcz\p{L}*`,
  String.raw`zbrodni\p{L}*\s+wojenn\p{L}*|ob(?:óz|oz\p{L}*)\s+(?:koncentracyjn\p{L}*|śmierci)`,
  // es
  String.raw`guetos?|deportaci[oó]n|deportaciones|pogromos?|masacres?|limpiezas?\s+[eé]tnicas?`,
  String.raw`genocidios?|cr[ií]men(?:es)?\s+de\s+guerra|campos?\s+de\s+(?:concentraci[oó]n|exterminio|la\s+muerte)`,
  // CEO 2026-10-30 [FOLLOW-1419] — every locale: the Nazi regime and its forces, and the camps by
  // a name no town carries
  String.raw`nazi(?:s|sm|smo|zm\p{L}*|st\p{L}*)?|hitler\p{L}*|gestap\p{L}*|wehrmacht\p{L}*|esesman\p{L}*`,
  String.raw`third\s+reich|tercer\s+reich|(?:iii|trzeci\p{L}*)\s+rzesz\p{L}*|ss[-\s]+(?:camps?|guards?|officers?|men|barracks)`,
  String.raw`auschwitz\p{L}*|birkenau|monowitz|treblin(?:ka|ki|ce|kę|ką)|majdan(?:ek|ka|ku|kiem)|sobib[oó]r\p{L}*`,
  String.raw`be[lł][zż](?:ec|ca|cu|cem)|stutthof\p{L}*|gross-rosen|buchenwald|bergen-belsen|ravensbr[uü]ck`,
  String.raw`theresienstadt|kulmhof|umschlagplatz\p{L}*|pawiak\p{L}*|katy[nń]sk\p{L}*`,
  // a camp at a town that shares its name — only with the camp word ("KL Plaszow", "obóz w
  // Płaszowie", "Dachau camp", "campo de Mauthausen"); the town itself passes (Oświęcim)
  String.raw`(?:kl|kz|konzentrationslager)\s+${CAMP_TOWN}`,
  String.raw`${CAMP_TOWN}\s+(?:(?:concentration|labou?r|death)\s+)?camps?`,
  String.raw`camps?\s+(?:at|in|of)\s+${CAMP_TOWN}`,
  String.raw`ob(?:óz|oz\p{L}*)\s+(?:(?:koncentracyjn\p{L}*|pracy|zagłady)\s+)?(?:(?:w|we|na)\s+)?${CAMP_TOWN}`,
  String.raw`campos?\s+(?:de\s+(?:concentraci[oó]n|exterminio|trabajo)\s+)?(?:de|en)\s+${CAMP_TOWN}`,
  // en — occupation, expulsion, deportation by train, forced labour
  String.raw`(?:german|nazi|soviet|wartime|enemy)\s+occupation|german-occupied`,
  String.raw`expulsions?|expelled|forced(?:ly)?\s+(?:displace\p{L}*|resettle\p{L}*|removals?)|displaced\s+persons`,
  String.raw`(?:death|deportation|prisoner|cattle)\s+(?:transports?|trains?|wagons?|cars?)|transports?\s+to\s+(?:the\s+)?(?:camps?|ghettos?)`,
  String.raw`(?:forced|slave)\s+labou?r\p{L}*|(?:labou?r|internment|transit|prison|pow|prisoner[- ]of[- ]war)\s+camps?`,
  // pl — "okupacja niemiecka", "w czasie okupacji" (Polish "okupacja" is never occupancy)
  String.raw`(?:niemieck|hitlerowsk|nazistowsk|sowieck|radzieck)\p{L}*\s+okupacj\p{L}*`,
  String.raw`okupacj\p{L}*\s+(?:niemieck|hitlerowsk|nazistowsk|sowieck|radzieck)\p{L}*`,
  String.raw`(?:podczas|czas\p{L}*|okres\p{L}*|lat\p{L}*)\s+okupacji`,
  // "wysiedlenia", "wysiedleni", "wypędzeni", "zsyłki", "łapanka"
  String.raw`wysiedl\p{L}*|wypędz\p{L}*|zsyłk\p{L}*|łapank\p{L}*`,
  // "wywózki" — not the rubbish collection ("wywózka śmieci")
  String.raw`wyw[oó]zk\p{L}*(?!\s+(?:${PL_HAULED}))|wywiezieni`,
  String.raw`wywiez\p{L}*\s+(?:do|na)\s+(?:obozu|obozów|obozow|sybir|syberi\p{L}*|niemiec|kazachstan\p{L}*|rosj\p{L}*|zsrr|roboty)`,
  String.raw`transport\p{L}*\s+(?:do\s+(?:obozu|obozów|obozow|getta)|więźniów|deportowanych|żydów|śmierci)`,
  String.raw`(?:pociąg|wagon)\p{L}*\s+(?:śmierci|bydlęc\p{L}*)`,
  String.raw`(?:robot|robót|prac)\p{L}*\s+przymusow\p{L}*|przymusow\p{L}*\s+(?:robot|robót|prac)\p{L}*`,
  String.raw`ob(?:óz|oz\p{L}*)\s+(?:pracy|jeniec\p{L}*|internowan\p{L}*|przejściow\p{L}*)`,
  // es — "ocupación nazi" (not "ocupación inmediata"), the historical "expulsión" only
  String.raw`ocupaci[oó]n\s+(?:nazi|alemana|sovi[eé]tica)`,
  String.raw`expulsi[oó]n(?:es)?\s+de\s+(?:los\s+)?(?:jud[ií]os|moriscos|musulmanes|sefard[ií]es)`,
  String.raw`(?:jud[ií]os|moriscos|sefard[ií]es)\s+expulsados|deportad[oa]s|desplaza(?:miento|mientos|dos)\s+forz\p{L}*`,
  String.raw`(?:trenes?|transportes?|vagones?)\s+de\s+(?:deportados|prisioneros|la\s+muerte)|trabajos?\s+forzad\p{L}*`,
];

const anyOf = (patterns: readonly string[], flags: string): RegExp =>
  new RegExp(`${B}(?:${patterns.join('|')})${E}`, flags);
const SENSITIVE_HISTORY_RE = anyOf(SENSITIVE_HISTORY, 'iu');
const COMPOSITION_RE = anyOf(COMPOSITION_PATTERNS, 'iu');
const RESIDENT_GROUND_RE = anyOf(RESIDENT_GROUND_PATTERNS, 'giu');
const PLACE_GROUND_RE = anyOf(PLACE_GROUND_PATTERNS, 'giu');

/**
 * A qualifier that puts a group of residents in the past. An adjective must directly precede the
 * phrase it qualifies ("the old Jewish community", "la antigua comunidad judía"), so "an old
 * building with Muslim neighbours" does not qualify; an adverb may stand up to
 * {@link HISTORICAL_ADVERB_REACH} words before it, with no comma between ("historically home to
 * Kraków's Jewish community").
 */
const HISTORICAL_ADJECTIVE_RE = new RegExp(
  `${B}(?:former|old|historic|historical|dawn(?:a|ej|ego|y|e|ych|ą|ym|ymi)|star(?:a|ej|ego|y|e|ych|ą|ym|ymi)|historyczn(?!ie)\\p{L}*|antigu[oa]s?|hist[oó]ric[oa]s?)\\s+$`,
  'iu',
);
const HISTORICAL_ADVERB_RE = new RegExp(
  `${B}(?:historically|formerly|once|dawniej|niegdyś|historycznie|hist[oó]ricamente|antiguamente|antaño)${E}`,
  'giu',
);
const HISTORICAL_ADVERB_REACH = 6;
/** A word that brings the group back into the present ("historically and still Muslim residents"). */
const PRESENT_MARKER_RE = new RegExp(
  `${B}(?:still|today|now|nowadays|currently|continues?|nadal|wciąż|obecnie|dziś|dzisiaj|teraz|todav[ií]a|a[uú]n|hoy|actualmente|siguen?|contin[uú]an?)${E}`,
  'iu',
);

/**
 * Only a collective noun (a community, a population) or a place "inhabited by" a group can be a
 * historical fact; "old Muslim neighbours" are people, and "old" there means their age.
 */
const HISTORICAL_SUBJECT_RE = new RegExp(
  `${B}(?:communit(?:y|ies)|population|enclaves?|społecznoś\\p{L}*|ludnoś\\p{L}*|enklaw\\p{L}*|zamieszkan\\p{L}*|comunidad|poblaci[oó]n|enclave)${E}`,
  'iu',
);

/** `text`'s clause before `start`, back to the last sentence or clause stop. */
function clauseBefore(text: string, start: number): string {
  const before = text.slice(0, start);
  return before.slice(before.search(/[^.;:!?\n]*$/u));
}

/** Is the resident-group phrase at `[start, end)` a statement about the past only (rule 1)? */
function isHistoricalMention(text: string, start: number, end: number): boolean {
  if (!HISTORICAL_SUBJECT_RE.test(text.slice(start, end))) return false;
  const clause = clauseBefore(text, start);
  const rest = text.slice(end);
  const tail = rest.slice(0, rest.search(/[,.;:!?\n—–]|$/u));
  if (PRESENT_MARKER_RE.test(tail)) return false;
  if (HISTORICAL_ADJECTIVE_RE.test(clause)) return true;
  const adverb = [...clause.matchAll(HISTORICAL_ADVERB_RE)].pop();
  if (adverb === undefined) return false;
  const between = clause.slice(adverb.index + adverb[0].length);
  // A comma ends the adverb's reach: "Once inside, Muslim neighbours" is not about the past.
  if (between.includes(',') || PRESENT_MARKER_RE.test(between)) return false;
  return between.split(/\s+/u).filter(Boolean).length <= HISTORICAL_ADVERB_REACH;
}

/**
 * Does `value` make a statement about the race, ethnic origin or religion of residents or
 * neighbours, or recount sensitive history? [FOLLOW-1411, ESC-089; FOLLOW-1415]
 *
 * @param value - Copy as the model wrote it (a directive, a description body or a headline).
 * @returns `true` when it matches a phrase of the closed en / pl / es list: a sensitive-history
 *          term (rule 3), a composition or exclusion statement (rule 2), a group of residents not
 *          put in the past by a historical qualifier (rules 1 and 2), or a place named by a group
 *          with no historical adjective directly before it [FOLLOW-1419].
 */
export function describesResidentsByProtectedGround(value: string): boolean {
  if (SENSITIVE_HISTORY_RE.test(value) || COMPOSITION_RE.test(value)) return true;
  for (const m of value.matchAll(RESIDENT_GROUND_RE)) {
    if (!isHistoricalMention(value, m.index, m.index + m[0].length)) return true;
  }
  // A place named by a group passes only with a historical adjective directly before it.
  for (const m of value.matchAll(PLACE_GROUND_RE)) {
    if (!HISTORICAL_ADJECTIVE_RE.test(clauseBefore(value, m.index))) return true;
  }
  return false;
}
