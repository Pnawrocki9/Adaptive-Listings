/**
 * Archetype semantic descriptors — the LLM's grounding for suggest-weights
 * (FOLLOW-1002).
 *
 * One line per canonical archetype so the model maps ANSWER MEANING → archetype
 * rather than pattern-matching on id strings. Hand-maintained beside the
 * canonical list; `route.test.ts` asserts this map covers EXACTLY
 * `CANONICAL_ARCHETYPE_IDS` so it cannot drift when archetypes change.
 * `neutral` is present for coverage but is never offered to the LLM (see
 * {@link SUGGESTIBLE_ARCHETYPES}).
 *
 * Lives in its own module (not `route.ts`) because a Next.js Route file may
 * only export handlers + route segment config — a value export here broke the
 * `Build (control-plane)` route-types check.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-definition/suggest-weights/archetype-descriptors
 */

import { CANONICAL_ARCHETYPE_IDS } from '@estalara/shared';

export const ARCHETYPE_DESCRIPTORS: Record<string, string> = {
  yield_hunter: 'Investor optimising for rental yield / recurring income from long-term lets',
  vacation_rental_investor: 'Investor buying to operate short-term/holiday rentals',
  flip_investor: 'Investor buying to renovate and resell at a profit on a short horizon',
  portfolio_builder: 'Investor accumulating multiple properties as a long-term portfolio',
  golden_visa_buyer: 'Buyer whose primary driver is residency/citizenship via property investment',
  commercial_investor: 'Investor focused on commercial (non-residential) property',
  family_buyer: 'Own-use buyer choosing a primary home for a family (schools, space, safety)',
  first_time_buyer:
    'Own-use buyer purchasing their first property (budget- and guidance-sensitive)',
  upsizer: 'Own-use buyer moving to a larger home than their current one',
  downsizer: 'Own-use buyer moving to a smaller, easier-to-keep home',
  luxury_buyer: 'Own-use buyer at the premium end — finish, prestige and exclusivity driven',
  remote_worker: 'Own-use buyer optimising for remote work (connectivity, workspace, lifestyle)',
  lifestyle_expat: 'Cross-border buyer relocating for lifestyle (climate, culture, pace)',
  retiree_relocator: 'Cross-border buyer relocating for retirement',
  diaspora_buyer: 'Buyer purchasing in their (or their family_s) country of origin',
  second_home_buyer: 'Buyer of a holiday/second home for own use, not primarily investment',
  student_parent: 'Parent buying near a university for a studying child',
  neutral: 'Fallback — no signal; never suggest weights for this id',
};

/** Archetypes the LLM may weight — everything canonical except the fallback. */
export const SUGGESTIBLE_ARCHETYPES = CANONICAL_ARCHETYPE_IDS.filter((id) => id !== 'neutral');

/** O(1) membership set over {@link SUGGESTIBLE_ARCHETYPES}. */
export const SUGGESTIBLE_SET = new Set<string>(SUGGESTIBLE_ARCHETYPES);
