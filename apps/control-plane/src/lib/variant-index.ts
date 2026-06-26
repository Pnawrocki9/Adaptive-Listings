/**
 * Bandit variant-to-index map — derived from SEED_VARIANTS (Rule K.1 / FOLLOW-397).
 *
 * Previously hardcoded inline in route.ts as `{ control: 0, v1: 1, v2: 2 }`.
 * Extracted to a separate module so:
 *   1. It can be exported and unit-tested without violating Next.js route-file
 *      export constraints (Next.js disallows non-handler named exports).
 *   2. Any future addition to SEED_VARIANTS automatically propagates here.
 *
 * Unknown variant names (e.g. a stray 'v3' not yet in SEED_VARIANTS) yield
 * `undefined` — callers must NOT use `?? 0` which would silently serve control copy.
 * Copy selection in route.ts uses `variantIndex !== undefined` guard instead.
 *
 * @module apps/control-plane/src/lib/variant-index
 */

import { SEED_VARIANTS } from './bandit-query';

/**
 * Maps each bandit variant name to its zero-based index into
 * `SlotDirective.variants.en`. Derived from SEED_VARIANTS — no third copy.
 *
 * Exported for unit testing (route.follow397.test.ts AC-2).
 */
export const VARIANT_INDEX: Record<string, number> = Object.fromEntries(
  SEED_VARIANTS.map((v, i) => [v, i]),
);
