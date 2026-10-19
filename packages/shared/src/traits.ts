/**
 * Canonical buyer-trait identifiers — single source of truth for `packages/shared`
 * (MASTER_DESIGN §E.4.3 v3.0, FOLLOW-1356).
 *
 * A trait is a secondary fact about the buyer that the quiz records on its optional last
 * "anything else that applies?" screen (or on an answer, e.g. `main_move` carries
 * `buying_from_abroad`). Traits NEVER change the resolved archetype — a trait screen is a
 * `kind: 'multi'` question with empty `weights` and `next: null`. They change copy only
 * (decision Q-F), downstream in the SDK intent state and the description guidance.
 *
 * Each trait absorbs a former archetype or playbook (`packages/shared/src/playbooks/archetypes/`):
 * `premium` ← luxury_buyer, `works_from_home` ← remote_worker, `residency_goal` ←
 * golden_visa_buyer, `seasoned_investor` ← portfolio_builder, `buying_from_abroad` ← the
 * remote-purchase copy of diaspora_buyer, `will_let` ← the "let it when I'm away" second
 * home, `has_children` ← new.
 *
 * Consumers: `schemas/presentation-config.ts` (`QuizAnswerSchema.traits`), `schemas/quiz-walk.ts`
 * (`resolveQuizOutcome`), the SDK quiz widget and intent state (FOLLOW-1357 / Q2, FOLLOW-1359 / Q4).
 *
 * @module @estalara/shared/traits
 */

import { z } from 'zod';

/**
 * The 7 canonical trait identifiers, in canonical order (the order `resolveQuizOutcome`
 * returns collected traits in).
 */
export const CANONICAL_TRAIT_IDS = [
  'premium',
  'works_from_home',
  'residency_goal',
  'buying_from_abroad',
  'seasoned_investor',
  'will_let',
  'has_children',
] as const;

/** Union of the canonical trait ids. */
export type TraitId = (typeof CANONICAL_TRAIT_IDS)[number];

/**
 * Zod enum over the canonical trait ids. Used by the AUTHORING schema only (`quiz-lint.ts`);
 * the serve schema keeps trait entries as plain strings for forward compatibility. `@__PURE__`
 * so the SDK bundle drops it.
 */
export const TraitIdSchema = /* @__PURE__ */ z.enum(CANONICAL_TRAIT_IDS);

/** Type guard: is `value` one of the canonical trait ids? */
export function isTraitId(value: unknown): value is TraitId {
  return typeof value === 'string' && (CANONICAL_TRAIT_IDS as readonly string[]).includes(value);
}
