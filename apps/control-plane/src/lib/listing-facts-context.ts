/**
 * Listing-facts enrichment for the adapt LLM context (FOLLOW-1022).
 *
 * THE PROBLEM THIS CLOSES: `POST /api/adapt` built its `listingContext` exclusively from the
 * agency FAQ table (`retrieveListingContext`), and only for a caller that sent BOTH a
 * `listing_id` AND a 1536-dim `intent_vector` — which the SDK does not. In production the model
 * was therefore asked to rewrite copy for a listing it had never been shown, while the base
 * directives it is told to "improve upon" are playbook templates that demand figures
 * (`"Rental Yield: {yield}% | Gross Income: {income}/yr"`). Every number it produced was
 * ungrounded, so FOLLOW-457's post-generation fact check discarded the whole batch.
 *
 * The production measurement of how total that failure was — how many consecutive calls
 * survived the fact check, and what they were discarded for — is registered as [MP-010]. It is
 * a live-environment claim with an owner and an expiry, so it is not restated here.
 *
 * The facts merged here reach BOTH halves of the loop by construction, because `listingContext`
 * is read by the prompt builders AND by `buildDirectiveGroundingText` — so what the model is
 * allowed to say and what it is checked against cannot drift apart again.
 *
 * @module apps/control-plane/src/lib/listing-facts-context
 */

import { fetchListingTextFields } from '@/lib/listing-details';

/**
 * Above this similarity the decision tree serves playbook copy directly and never calls the
 * LLM. Mirrors `HIGH_SIMILARITY_THRESHOLD` in the adapt route — deliberately module-private,
 * because an exported copy would be a second name for the route's own threshold with nothing
 * forcing the two to move together. If the route's value changes, the boundary test below
 * (no fetch on the playbook-direct branch) is what catches the drift.
 */
const LLM_BRANCH_SIMILARITY_CEILING = 0.85;

/**
 * Merge a listing's own facts into the RAG context, for the branches that call the LLM.
 *
 * Deliberate boundaries:
 *
 * - **Only when the LLM will actually run.** Above {@link LLM_BRANCH_SIMILARITY_CEILING} the
 *   playbook-direct branch never calls the model, so fetching there would add a network hop to
 *   the fastest path for nothing.
 * - **Agency-curated wins.** The RAG context is spread last, so a human-authored value for a
 *   key always beats the backend's raw field.
 * - **Fail-open.** `fetchListingTextFields` returns null on missing env, non-2xx, timeout or
 *   malformed JSON, and this then returns the RAG context unchanged. A listing we cannot read
 *   degrades to the previous behaviour (ungrounded → fact check discards → playbook copy); it
 *   never fails the request.
 *
 * @param ragContext - Agency FAQ answers from `retrieveListingContext` (may be empty).
 * @param listingId  - The tenant's listing identifier from the request body, if any.
 * @param similarity - Resolved similarity; decides whether an LLM branch will run at all.
 * @param locale     - Content locale, forwarded to the backend listing-details API.
 */
/**
 * The keys {@link withListingFacts} attaches when the backend answers with usable facts.
 *
 * Module-private on purpose: {@link hasListingFacts} is the whole public surface, and an exported
 * constant with no consumer is a `Rule I` violation — the gate caught exactly that on the first
 * push of this change. Before FOLLOW-1120 no caller could ask this question at all: the fetch
 * fails open (by design, see below), so an unreadable listing, a listing with no facts and a
 * healthy listing all produced the same `Record<string, string>` and the same downstream
 * `fallback_reason`.
 */
const LISTING_FACT_KEYS = [
  'listing_title',
  'listing_description',
  'listing_price',
  'listing_location',
] as const;

/**
 * Did the listing's own facts reach this context?
 *
 * DELIBERATELY CONSERVATIVE. The agency FAQ rows in `ragContext` are spread over the fact keys, so
 * a curated answer stored under one of these names reads as "grounded" here even though the
 * backend fetch failed. That direction is the safe one: it under-reports
 * `listing_context_unavailable` and falls back to the older, broader `llm_unavailable`, which is
 * exactly the conservatism FOLLOW-1056 chose for an absent reason. The opposite error — calling a
 * grounded prompt ungrounded — would let a real LLM outage hide behind an upstream excuse.
 */
export function hasListingFacts(context: Record<string, string>): boolean {
  return LISTING_FACT_KEYS.some((key) => key in context);
}

export async function withListingFacts(
  ragContext: Record<string, string>,
  listingId: string | undefined,
  similarity: number,
  locale: 'en' | 'pl' | 'es',
): Promise<Record<string, string>> {
  if (!listingId || similarity > LLM_BRANCH_SIMILARITY_CEILING) return ragContext;

  const facts = await fetchListingTextFields(listingId, locale);
  if (!facts) return ragContext;

  const factContext: Record<string, string> = {};
  if (facts.title) factContext.listing_title = facts.title;
  if (facts.description) factContext.listing_description = facts.description;
  if (facts.price) factContext.listing_price = facts.price;
  if (facts.location) factContext.listing_location = facts.location;

  return { ...factContext, ...ragContext };
}
