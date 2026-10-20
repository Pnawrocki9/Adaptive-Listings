/**
 * MASTER_DESIGN §E.7.0 (ESC-076) — what a template may say about a property it never read.
 * [FOLLOW-1163]
 *
 * THE PROBLEM THIS CLOSES. Two response paths serve playbook copy VERBATIM: branch 2
 * (`similarity > HIGH_SIMILARITY_THRESHOLD`, which deliberately skips the listing fetch) and
 * branch 3's `playbook_fallback_llm_unavailable`, the path a model outage takes. `similarity` is
 * confidence about the BUYER's archetype and carries no information about the PROPERTY, so no
 * threshold on it can make `'Golden Visa Eligible — Residency by Investment'`,
 * `'Holiday Let Opportunity — Tourist License, Near Beach'` or `'Spacious 3-Bedroom Home Near
 * Top-Rated Schools'` true of the listing in front of the buyer. Under §E.7.0 a directive comes
 * from the listing's own text or not at all, and when we cannot ground, we do not adapt.
 *
 * THE HALF OF THE RULE THAT IS NOT "SERVE NOTHING". §E.7.0 forbids asserting a FACT we cannot
 * ground. A call to action asserts no fact about the property: it is an offer we make
 * (`'Request Investment Pack'`) or an invitation to the buyer (`'Book a Viewing'`), and it is
 * exactly as true whatever the listing turns out to contain. Withholding it would cost the
 * buyer an adaptation while protecting nothing.
 *
 * THE CLASSIFICATION, AND THE EVIDENCE BEHIND EACH LINE — enumerated from the shipped copy
 * before the line was drawn (Rule AC), not reasoned from the slot names:
 *
 * - **`cta` — non-assertive, SERVED.** All seventeen shipped strings were read. Every one is an
 *   offer or an invitation: `Request Investment Pack`, `Get Renovation Report`, `Download Golden
 *   Visa Guide`, `Book a Viewing`, `Compare Properties`, `Check Connectivity`, `Request Private
 *   Viewing`, `Request Bulk Enquiry`, `Speak with a Diaspora Specialist`, `Get Family Buyer
 *   Guide`, `Get First-Time Buyer Guide`, `Download Expat Relocation Guide`, `Download
 *   Retirement Living Guide`, `Enquire About Holiday Use`, `Calculate Student Rental Return`,
 *   `See Short-Term Rental Projections`, `Request Commercial Pack`. The last two were the ones
 *   worth arguing about and they hold: they promise that WE have a projection or a calculator,
 *   not that this property yields anything. `Enquire About Holiday Use` invites a question; it
 *   does not claim holiday use is permitted.
 * - **`trait_note` — non-assertive, SERVED [FOLLOW-1360].** One invitation per buyer trait, all six
 *   read: `Request a Private Viewing`, `Ask About Home Office Space`, `Ask About Residency
 *   Requirements`, `Request an Investment Pack`, `Ask About Buying From Abroad`, `Ask About
 *   Letting This Home` (and their PL/ES). Each is an offer or a question the buyer may ask; none
 *   says the property has an office, qualifies for residency, yields anything or may be let.
 *   `has_children` has no slot. The set lives in `packages/shared/src/playbooks/traits.ts`, whose
 *   test pins every string against a claim-word list, so a re-authored string is a red test.
 * - **`headline` — assertive, WITHHELD.** Every property claim in the playbook lives here.
 * - **`feature` — MIXED, and therefore withheld whole.** Most are section labels that assert
 *   nothing (`Family Essentials`, `Portfolio Metrics`, `Renovation Scope`, `Why Upgrade?`), but
 *   four are claims about the property: `remote_worker`'s `Remote Work Ready`, `downsizer`'s
 *   `Downsizer Friendly`, `vacation_rental_investor`'s `Short-Term Rental Projections` and
 *   `golden_visa_buyer`'s `Residency Requirements`. A mechanical slot rule cannot separate the
 *   label from the claim, and separating them means re-authoring shipped copy — which is
 *   FOLLOW-1164's job (playbooks become briefs), not this one's. Withholding the slot is the
 *   conservative direction: it costs a section label, it cannot ship a claim.
 *
 * WHAT THIS IS NOT. It is not a fact-check of the agency. AL never verifies the seller's copy
 * (§E.7.0): if the listing's own description says the schools are top-rated, a GROUNDED
 * directive may say so too. This module governs only the paths where no listing was read at all.
 *
 * @module apps/control-plane/src/lib/ungrounded-directives
 */

import * as Sentry from '@sentry/nextjs';
import type { TextDirective } from '@estalara/shared';

/**
 * Slots a template may serve without having read the listing.
 *
 * The SET stays module-private — an exported constant whose only consumer is its own module is
 * a `Rule I` violation, and a mutable-looking export invites a second definition. The membership
 * test is exported instead: see {@link isNonAssertiveSlot}.
 */
const NON_ASSERTIVE_SLOTS: ReadonlySet<string> = new Set(['cta', 'trait_note']);

/**
 * Does this slot assert a fact about the property? [FOLLOW-1173]
 *
 * Exported so the directive fact check in `lib/llm-gateway.ts` decides the question against the
 * SAME classification this module's withhold rule uses, rather than a second one that can drift.
 * Before this export the two controls disagreed about `cta` in opposite directions: the withhold
 * rule served it unconditionally *because it asserts nothing*, while `checkDirectiveFacts` flagged
 * it as a hallucinated proper name — and that disagreement cost a judge round trip on every LLM
 * request (RETRO-318 §4a; measured 12/12 in both arms of #873's live run).
 *
 * The classification and the evidence behind it are in this module's header, where they belong:
 * the argument is a §E.7.0 argument about what a template may claim, not a fact about the LLM
 * path. A caller that wants to exempt a slot from a check should be arguing about THAT list.
 *
 * WHICH POPULATION THE EVIDENCE COVERS — read this before adding a third consumer. [FOLLOW-1176]
 * The header's argument is an ENUMERATION of the seventeen `cta` strings **we authored**. It is
 * evidence about those strings and about nothing else. It says nothing about a `cta` a model
 * writes, a tenant writes, or a future brief generates, because no such string was available to
 * enumerate. This module's own caller is safe by construction — `withholdUngroundedDirectives`
 * only ever sees template copy — but `lib/llm-gateway.ts` sees model output, and #875 gave it
 * this predicate alone: `Book a Viewing with Knight Frank` was served unchecked until FOLLOW-1176
 * paired it with a provenance test. A caller whose values are NOT authored copy must either
 * bound them itself or say in its PR that it is applying this predicate without evidence
 * (Rule BC).
 *
 * @param slot - A `TextDirective.slot` name.
 * @returns `true` when the slot makes no claim about the property (today: `cta` and `trait_note`).
 */
export function isNonAssertiveSlot(slot: string): boolean {
  return NON_ASSERTIVE_SLOTS.has(slot);
}

/**
 * The `feature` section labels WE authored that assert nothing about the property, keyed by
 * archetype, each pinned to the exact string reviewed [FOLLOW-1251].
 *
 * WHY AN ENUMERATION AND NOT A SLOT RULE. The header above already read all seventeen shipped
 * `feature` strings and found the slot MIXED: thirteen are headings (`Investment Performance`,
 * `Portfolio Metrics`, `Why Upgrade?`), four are claims about the property (`remote_worker`'s
 * `Remote Work Ready`, `downsizer`'s `Downsizer Friendly`, `vacation_rental_investor`'s
 * `Short-Term Rental Projections`, `golden_visa_buyer`'s `Residency Requirements`). A slot rule
 * cannot separate them, so this map lists the thirteen headings and leaves the four claims out:
 * they stay ordinary model output, scanned and judged. `neutral` has no `feature` slot.
 *
 * WHY THE STRING IS PINNED. A label is exempt because it was READ and found to be a heading. If
 * a playbook re-authors its label, the new string has not been read, so
 * {@link isAuthoredSectionLabel} stops matching (it requires the playbook's live `en` to equal
 * the string here) — the exemption fails CLOSED until someone reviews the new label and updates
 * this map. `__tests__/llm-gateway.follow1251.test.ts` asserts every entry against the shipped
 * playbooks, so drift is a red test, not a silent loss.
 *
 * WHAT A LABEL IS NOT. It is a heading over the listing's features, not evidence about the
 * listing. It is never added to the fact check's grounding corpus (`buildDirectiveGroundingText`
 * stays listing-only, MASTER_DESIGN §E.7.0), so it cannot ground any other directive's words.
 */
const AUTHORED_SECTION_LABELS: ReadonlyMap<string, string> = new Map([
  ['yield_hunter', 'Investment Performance'],
  ['first_time_buyer', 'Your First Step'],
  ['diaspora_buyer', 'Remote Purchase Guide'],
  ['lifestyle_expat', 'Expat Essentials'],
  ['family_buyer', 'Family Essentials'],
  ['commercial_investor', 'Commercial Due Diligence Pack'],
  ['flip_investor', 'Renovation Scope'],
  ['upsizer', 'Why Upgrade?'],
  ['retiree_relocator', 'Retirement Living Highlights'],
  ['second_home_buyer', 'Weekend Escape'],
  ['luxury_buyer', 'Premium Highlights'],
  ['student_parent', 'Student Area Insights'],
  ['portfolio_builder', 'Portfolio Metrics'],
]);

/** The slot {@link AUTHORED_SECTION_LABELS} enumerates. */
const SECTION_LABEL_SLOT = 'feature';

/**
 * Is this value our own reviewed section label for this archetype's `feature` slot? [FOLLOW-1251]
 *
 * A label we authored comes from us — not from the model and not from the seller — so it is
 * grounded by construction and the proper-name scan must not flag it as an invented name (README
 * §5.15 run 2: `hallucinated_proper_name archetype=yield_hunter slot=feature value="Investment
 * Performance"` refused the whole batch). The match is trimmed and case-folded and NOTHING else,
 * the same rule as the `cta` provenance test in `lib/llm-gateway.ts`: a label with a clause, a
 * figure or a name appended is a different string, is model-written, and goes to the scan and the
 * judge like any other copy.
 *
 * Three conditions, all required: the slot is `feature`; the archetype is in the reviewed map;
 * and the playbook handed to THIS request still authors exactly the reviewed string (so a
 * re-authored label is not exempt until it is reviewed).
 *
 * @param playbook - The archetype's playbook entry, as handed to this request.
 * @param slot - The directive's slot name.
 * @param value - The directive's value, as the model returned it.
 * @returns `true` when the value is the archetype's reviewed, still-shipped section label.
 */
export function isAuthoredSectionLabel(
  playbook: { archetype: string; slots: readonly { slot: string; en: string }[] },
  slot: string,
  value: string,
): boolean {
  if (slot !== SECTION_LABEL_SLOT) return false;
  const reviewed = AUTHORED_SECTION_LABELS.get(playbook.archetype);
  if (reviewed === undefined) return false;
  const normalise = (s: string): string => s.trim().toLowerCase();
  const shipped = playbook.slots.find((s) => s.slot === SECTION_LABEL_SLOT)?.en;
  if (shipped === undefined || normalise(shipped) !== normalise(reviewed)) return false;
  return normalise(value) === normalise(reviewed);
}

/**
 * Split template directives into what may be served ungrounded and what may not.
 *
 * @param directives - Playbook directives, already variant-selected and token-resolved.
 * @returns `served` in input order, and `withheldSlots` naming what was dropped (duplicates
 *          kept, so the count is the number of DIRECTIVES withheld, not of distinct slots).
 */
export function withholdUngroundedDirectives(directives: readonly TextDirective[]): {
  served: TextDirective[];
  withheldSlots: string[];
} {
  const served: TextDirective[] = [];
  const withheldSlots: string[] = [];
  for (const directive of directives) {
    if (NON_ASSERTIVE_SLOTS.has(directive.slot)) {
      served.push(directive);
    } else {
      withheldSlots.push(directive.slot);
    }
  }
  return { served, withheldSlots };
}

/**
 * Report a withheld batch — the adaptation the buyer did NOT receive.
 *
 * Deliberately mirrors `reportDroppedPlaceholderDirectives`: a withhold is a silent loss unless
 * something says so, and on the `playbook_fallback_*` branches it cannot be said on the wire
 * (`fallback_reason` there carries the LLM diagnosis the FOLLOW-1022 canary reads, and
 * displacing it would blind that canary). Branch 2 says it on the wire AND here.
 *
 * **Expected to be frequent, and that is the ruling working.** Every branch-2 response for a
 * non-neutral archetype fires this, by construction — §E.7.0 predicted the adaptation rate would
 * fall. Do not read a high count as an incident; read a count of ZERO as one, because it would
 * mean the template paths stopped running at all.
 */
export function reportWithheldUngroundedDirectives(
  withheldSlots: string[],
  context: { sessionId: string; tenantId: string; archetype: string; listingId?: string },
): void {
  const detail = { ...context, withheld_slots: withheldSlots };
  console.warn('[adapt] directive withheld — ungrounded template copy', JSON.stringify(detail));
  Sentry.captureMessage('adapt ungrounded directive withheld', {
    level: 'info',
    tags: {
      area: 'adapt',
      kind: 'ungrounded_directive_withheld',
      // One tag per event would be unqueryable; the first slot is a stable grouping key and the
      // full list is on `extra`.
      slot: withheldSlots[0] ?? 'unknown',
    },
    extra: detail,
  });
}
