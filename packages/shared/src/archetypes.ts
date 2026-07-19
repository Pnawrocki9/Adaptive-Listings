/**
 * Canonical archetype ID list — single source of truth for `packages/shared`.
 *
 * FOLLOW-584 (RETRO-179 §4a/§4c, supersedes the long-dormant FOLLOW-036): before this
 * file, `packages/shared/src/directives.ts` (`ArchetypeId` union),
 * `packages/shared/src/schemas/description.ts` (`ArchetypeIdSchema` zod enum), and
 * `apps/control-plane/src/lib/bandit-seed.ts` (`CANONICAL_ARCHETYPES`) each hand-maintained
 * an independent 18-entry copy of this list, all confirmed in sync at consolidation time but
 * with no guard preventing future drift between them. This file collapses those three copies
 * into one, and `packages/shared/src/__tests__/archetype-canonical-parity.test.ts` guards it
 * against drift from the true canonical source below.
 *
 * TRUE canonical source of truth: `ARCHETYPE_NAMES` in `packages/sdk/src/core/intent.ts`.
 * `packages/shared` may NOT depend on `packages/sdk` — `@estalara/sdk` depends on
 * `@estalara/shared` (see `packages/sdk/package.json`), so the reverse dependency would create
 * a circular package graph edge that breaks the pnpm/turbo build order (`typecheck`/`build`
 * both use `dependsOn: ["^build"]`). This array is therefore a hand-maintained PARALLEL copy,
 * not an import from the SDK — the same rationale `directives.ts` already documented for its
 * (now-removed) inline `ArchetypeId` union. Keep in sync with `ARCHETYPE_NAMES` whenever
 * archetypes are added, removed, or renamed; the guard test above will fail loudly if it drifts.
 *
 * @module @estalara/shared/archetypes
 */

/**
 * The 18 canonical archetype identifiers, in the same order as `ARCHETYPE_NAMES`
 * (`packages/sdk/src/core/intent.ts`). Every other `packages/shared` archetype-typed
 * export (`ArchetypeId` in `directives.ts`, `ArchetypeIdSchema` in
 * `schemas/description.ts`) derives from this single array.
 *
 * Deliberately does NOT also export an `ArchetypeId` type alias here — `ArchetypeId`
 * stays declared exactly once, in `directives.ts` (derived from this array), so that
 * `tenant-site-schema.ts` (which already imports `ArchetypeId` from `./directives.js`)
 * and every `@estalara/shared` root re-export keep a single, unambiguous binding.
 */
export const CANONICAL_ARCHETYPE_IDS = [
  // Investors
  'yield_hunter',
  'vacation_rental_investor',
  'flip_investor',
  'portfolio_builder',
  'golden_visa_buyer',
  'commercial_investor',
  // Own use
  'family_buyer',
  'first_time_buyer',
  'upsizer',
  'downsizer',
  'luxury_buyer',
  'remote_worker',
  // Special / cross-border
  'lifestyle_expat',
  'retiree_relocator',
  'diaspora_buyer',
  'second_home_buyer',
  'student_parent',
  // Fallback
  'neutral',
] as const satisfies readonly string[];
