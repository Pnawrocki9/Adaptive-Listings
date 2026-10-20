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
 * slot: familial status is a fair-housing protected class (ESC-086), so nothing is added to the
 * page for it, and its rules allow only physical facts the listing states.
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
      'Poproś o prywatny pokaz',
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
      'Pregunta por el espacio de trabajo',
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
      'Zapytaj o wynajem tego domu',
      'Consulta sobre alquilar esta vivienda',
    ),
  },
  has_children: {
    trait: 'has_children',
    source: null,
    rules: [
      'Mention only physical facts the listing states: the bedroom count, a garden or outdoor space, storage, the property type. Mention a school or a park only if the listing names it.',
      'Never describe an area or neighbourhood as family-friendly, safe or suited to families, never address the reader as a parent, and never refer to their children: familial status is a fair-housing protected class.',
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
 * Familial-status steering: copy that tells a reader an area or home suits (or is unsuited to)
 * families or children. Fair-housing exposure [ESC-086]; the `has_children` rules forbid it and
 * the gateway refuses it when that trait is present.
 */
const FAMILIAL_STEERING_RE =
  /\b(?:family|child|kid)[- ]friendly\b|\b(?:ideal|perfect|great|best|suited|suitable|safe)\s+(?:for|to)\s+(?:young\s+)?(?:families|a family|children|kids)\b|\b(?:good|great|ideal|safe)\s+(?:area|neighbou?rhood|location|street)\s+for\s+(?:young\s+)?(?:families|children|kids)\b|\braising\s+(?:a family|children|kids)\b|\byour\s+(?:children|kids)\b/i;

/**
 * Does `value` steer by familial status?
 *
 * @param value - A directive value as the model wrote it.
 * @returns `true` when it matches a steering phrase.
 */
export function steersByFamilialStatus(value: string): boolean {
  return FAMILIAL_STEERING_RE.test(value);
}
