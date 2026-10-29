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
 * A NARROW, closed en / pl / es phrase list, not a classifier: the gateway and the description
 * path refuse a text that matches, whoever wrote the words. What it is NOT: a buyer's nationality
 * or origin ("diaspora", "returning home", "an international / British community" — buyer
 * targeting is a product feature, ESC-089); a place's name ("the former Jewish Quarter", "dawna
 * dzielnica żydowska", "el antiguo barrio judío"); a building or institution ("a church nearby",
 * "the Jewish Community Centre"). Colour words count in English only and only before a word for
 * people ("white residents"), because "mostly white walls", "Białe ściany" and the Andalusian
 * "pueblos blancos" are not about anyone. Boundaries are Unicode-aware (`\b` is ASCII-only).
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
const PL_PEOPLE = String.raw`(?:mieszkańc|sąsiad|sąsiedz|społecznoś|ludnoś|rodzin|enklaw|gett)\p{L}*`;
const PL_MOSTLY = String.raw`głównie|przeważnie|w\s+większości|wyłącznie|niemal\s+wyłącznie|prawie\s+wyłącznie|sami|tylko`;
const PL_EXCLUDED = String.raw`(?:imigrant|migrant|uchodźc|uchodźców|mniejszoś|romów|cyganów)\p{L}*`;
/** es: race, ethnic origin or religion, as an adjective stem; colours only with people. */
const ES_GROUND_NO_COLOUR = String.raw`(?:musulm[aá]n|isl[aá]mic|jud[ií]|cat[oó]lic|cristian|protestante|ortodox|gitan|[aá]rabe|asi[aá]tic)\p{L}*`;
const ES_GROUND = String.raw`(?:${ES_GROUND_NO_COLOUR}|(?:blanc|negr)\p{L}*)`;
const ES_PEOPLE =
  'vecinos|vecindario|residentes|comunidad|población|poblacion|familias|habitantes|enclave|gueto';
const ES_PLACE = 'barrio|zona|distrito|calle|urbanización|urbanizacion|edificio';
const ES_MOSTLY =
  'mayoritariamente|predominantemente|principalmente|exclusivamente|casi\\s+exclusivamente|sobre\\s+todo';
const ES_EXCLUDED = String.raw`(?:inmigrantes|migrantes|refugiados|minor[ií]as|gitanos)`;

const PROTECTED_GROUND_PATTERNS: readonly string[] = [
  // en — "Muslim neighbours", "a white community" (not "the Jewish Community Centre")
  String.raw`(?:${EN_GROUND})\s+(?:${EN_PEOPLE})(?!\s+(?:cent(?:re|er)s?|halls?|museums?|cemeter(?:y|ies)|schools?))`,
  // "a predominantly Catholic neighbourhood", "mostly Muslims"
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
  // pl — "katolicka społeczność", "muzułmańscy sąsiedzi"
  String.raw`${PL_GROUND}\s+${PL_PEOPLE}`,
  // "mieszkańcy to głównie katolicy", "w większości muzułmanie" (not "głównie azjatycka kuchnia")
  String.raw`(?:${PL_MOSTLY})\s+(?:${PL_GROUP_NOUN})`,
  // "dzielnica głównie katolicka"
  String.raw`${PL_PLACE}\s+(?:${PL_MOSTLY})\s+${PL_GROUND}`,
  // "zamieszkana głównie przez katolików"
  String.raw`zamieszkan\p{L}*\s+(?:(?:${PL_MOSTLY})\s+)?przez\s+(?:${PL_GROUP_NOUN}|${PL_GROUND})`,
  // "bez imigrantów", "mało mniejszości"
  String.raw`(?:bez|mało|niewielu|brak)\s+${PL_EXCLUDED}`,
  String.raw`(?:etnicznie|rasowo|religijnie)\s+(?:jednorodn|zróżnicowan|mieszan|jednolit)\p{L}*`,
  // es — "vecinos musulmanes", "comunidad judía"
  String.raw`(?:${ES_PEOPLE})\s+(?:(?:${ES_MOSTLY})\s+)?${ES_GROUND}`,
  // "un barrio mayoritariamente musulmán" (not "el antiguo barrio judío")
  String.raw`(?:${ES_PLACE})\s+(?:${ES_MOSTLY})\s+${ES_GROUND_NO_COLOUR}`,
  // "sin inmigrantes", "pocos gitanos"
  String.raw`(?:sin|pocos|pocas|libre\s+de)\s+${ES_EXCLUDED}`,
  String.raw`(?:étnica|etnica|racial|religiosa)mente\s+(?:divers|homog[eé]ne|mixt|uniform)\p{L}*`,
];
const PROTECTED_GROUND_RE = new RegExp(`${B}(?:${PROTECTED_GROUND_PATTERNS.join('|')})${E}`, 'iu');

/**
 * Does `value` make a statement about the race, ethnic origin or religion of residents or
 * neighbours? [FOLLOW-1411, ESC-089]
 *
 * @param value - Copy as the model wrote it (a directive, a description body or a headline).
 * @returns `true` when it matches a phrase of the closed en / pl / es list.
 */
export function describesResidentsByProtectedGround(value: string): boolean {
  return PROTECTED_GROUND_RE.test(value);
}
