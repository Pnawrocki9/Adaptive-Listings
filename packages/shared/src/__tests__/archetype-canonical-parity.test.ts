/**
 * FOLLOW-584 (RETRO-179 §4a/§4c, supersedes the long-dormant FOLLOW-036) — guards
 * `CANONICAL_ARCHETYPE_IDS` (`packages/shared/src/archetypes.ts`), the single
 * canonical archetype-ID source now shared by `directives.ts` `ArchetypeId`,
 * `schemas/description.ts` `ArchetypeIdSchema`, and
 * `apps/control-plane/src/lib/bandit-seed.ts` (which seeds 18 archetypes × 3
 * variants = 54 live-prod `ab_bandit_weights` rows per new tenant), against
 * drift from the TRUE canonical source of truth: `ARCHETYPE_NAMES` in
 * `packages/sdk/src/core/intent.ts`.
 *
 * WHY THIS PARSES THE REAL `intent.ts` FILE INSTEAD OF IMPORTING IT:
 * `packages/shared/tsconfig.json` has `composite: true` + `rootDir: "./src"` (same
 * as `packages/sdk` and `packages/db`). A relative TS import reaching outside
 * `packages/shared/src` into `packages/sdk/src` trips `tsc --noEmit` with
 * TS6059/TS6307 ("File is not under 'rootDir'") — confirmed empirically before
 * writing this file (a scratch import was added, `pnpm --filter @estalara/shared
 * typecheck` failed with exactly those two errors, then reverted). A package-level
 * import (`@estalara/sdk`) is also not an option: `@estalara/sdk` already depends
 * on `@estalara/shared` (see `packages/sdk/package.json`), so `packages/shared`
 * adding a reverse dependency — even a test-only `devDependency` — would create a
 * circular edge in the pnpm/turbo workspace graph (`typecheck`/`build` both use
 * `dependsOn: ["^build"]`, which cannot resolve a cycle).
 *
 * The resolution (same discipline as `tests/integration/archetype-id-parity.test.ts`,
 * which parses `nlp.py`/`archetype-seeds.ts`/migration SQL instead of importing them
 * for the same class of reason): read the REAL checked-in
 * `packages/sdk/src/core/intent.ts` via `node:fs` and regex-parse the
 * `ARCHETYPE_NAMES` array literal. `readFileSync` is a runtime call, not a TS
 * import specifier, so it never enters the `tsc` program and never trips rootDir —
 * confirmed empirically (typecheck + vitest both green with this approach before
 * this file was finalized).
 *
 * WHAT MAKES THIS A REAL TEST (not a dead-wire test):
 *   - `CANONICAL_ARCHETYPE_IDS` is imported directly from the real, production
 *     `../archetypes.js` module — the same binding `directives.ts`,
 *     `schemas/description.ts`, and `bandit-seed.ts` all consume.
 *   - `ARCHETYPE_NAMES` is parsed from the REAL, currently-checked-in
 *     `packages/sdk/src/core/intent.ts` file on disk — never a fixture that merely
 *     restates what the file is supposed to contain. Any edit to that file changes
 *     what this test sees on the next run.
 *   - The parser asserts it extracted a non-empty list before comparing, so a
 *     regex broken by a future reformat FAILS LOUDLY instead of vacuously passing
 *     with an empty "matches" set on both sides.
 *
 * @module packages/shared/src/__tests__/archetype-canonical-parity
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CANONICAL_ARCHETYPE_IDS } from '../archetypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/shared/src/__tests__ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** Parses `ARCHETYPE_NAMES: readonly Archetype[] = [...]` out of the real intent.ts. */
function parseArchetypeNames(source: string): string[] {
  const block = /ARCHETYPE_NAMES:\s*readonly Archetype\[\]\s*=\s*\[([\s\S]*?)\];/.exec(source);
  if (!block) {
    throw new Error(
      'archetype-canonical-parity: could not locate ' +
        '`ARCHETYPE_NAMES: readonly Archetype[] = [...]` in ' +
        'packages/sdk/src/core/intent.ts — the literal was likely renamed or reformatted; ' +
        'update this parser regex to match.',
    );
  }
  return [...block[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe('FOLLOW-584 — CANONICAL_ARCHETYPE_IDS (packages/shared) parity guard', () => {
  it('sanity: CANONICAL_ARCHETYPE_IDS currently has 18 entries', () => {
    // Not a hard requirement of the guard below (which compares by set, not count),
    // but documents the MASTER_DESIGN.md §D 18-archetype baseline this test assumes.
    expect(CANONICAL_ARCHETYPE_IDS.length).toBe(18);
  });

  it('CANONICAL_ARCHETYPE_IDS matches ARCHETYPE_NAMES (packages/sdk/src/core/intent.ts) exactly', () => {
    const source = readFileSync(
      path.resolve(REPO_ROOT, 'packages/sdk/src/core/intent.ts'),
      'utf-8',
    );
    const canonical = parseArchetypeNames(source);
    expect(
      canonical.length,
      'parser matched 0 archetypes in packages/sdk/src/core/intent.ts — regex is broken',
    ).toBeGreaterThan(0);

    const canonicalSet = new Set(canonical);
    const sharedSet = new Set<string>(CANONICAL_ARCHETYPE_IDS);

    const duplicates = CANONICAL_ARCHETYPE_IDS.filter(
      (name, idx) => CANONICAL_ARCHETYPE_IDS.indexOf(name) !== idx,
    );
    const missing = canonical.filter((name) => !sharedSet.has(name));
    const extra = CANONICAL_ARCHETYPE_IDS.filter((name) => !canonicalSet.has(name));

    expect(
      duplicates,
      `CANONICAL_ARCHETYPE_IDS: duplicate archetype entries found: [${duplicates.join(', ')}]`,
    ).toEqual([]);
    expect(
      missing,
      'CANONICAL_ARCHETYPE_IDS: MISSING archetypes present in ARCHETYPE_NAMES but absent ' +
        `here: [${missing.join(', ')}]. Add the missing archetype(s) to ` +
        'packages/shared/src/archetypes.ts.',
    ).toEqual([]);
    expect(
      extra,
      'CANONICAL_ARCHETYPE_IDS: EXTRA archetypes not present in ARCHETYPE_NAMES: ' +
        `[${extra.join(', ')}]. Either packages/shared/src/archetypes.ts has a stale/typo id, ` +
        'or ARCHETYPE_NAMES itself is missing an archetype that was added here first.',
    ).toEqual([]);
  });
});
