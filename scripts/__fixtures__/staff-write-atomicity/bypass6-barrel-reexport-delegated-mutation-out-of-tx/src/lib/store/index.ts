/**
 * FIXTURE barrel — re-exports the delegated mutation helper via a wildcard
 * re-export (`export * from './mutation-helper'`), identical to the co-scoped
 * variant's barrel (../../bypass6-barrel-reexport-delegated-mutation/src/lib/store/index.ts).
 * Intentionally never imported or built outside the guard's own text parsing.
 */

export * from './mutation-helper';
