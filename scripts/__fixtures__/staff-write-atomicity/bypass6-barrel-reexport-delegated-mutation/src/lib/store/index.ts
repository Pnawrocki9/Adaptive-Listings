/**
 * FIXTURE barrel — re-exports the delegated mutation helper via a wildcard
 * re-export (`export * from './mutation-helper'`), the exact shape
 * `packages/db/src/index.ts` uses for the real `upsertConversionLabel` and that
 * FOLLOW-597's `admin/labels/[id]/route.ts` reaches through `@estalara/db`.
 * The route in this fixture imports `upsertSomething` from THIS barrel, not
 * from `./mutation-helper` directly — so the guard must follow the
 * `ts.isExportDeclaration` re-export specifier (FOLLOW-613 AC 1) to discover
 * that the barrel ultimately provides a mutating helper. Intentionally never
 * imported or built outside the guard's own text parsing.
 */

export * from './mutation-helper';
