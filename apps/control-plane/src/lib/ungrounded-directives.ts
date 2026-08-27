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
 * Module-private: {@link withholdUngroundedDirectives} is the whole public surface, and an
 * exported constant whose only consumer is its own module is a `Rule I` violation.
 */
const NON_ASSERTIVE_SLOTS: ReadonlySet<string> = new Set(['cta']);

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
