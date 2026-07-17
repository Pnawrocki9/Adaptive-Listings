/**
 * FOLLOW-561 — Archetype-ID parity guard for the hand-maintained literal copies
 * of the 18-archetype set (audit finding A3-F-10; CONVENTIONS_PATCH.md Rule J —
 * mirror-code sync gate for cross-runtime duplicates).
 *
 * Canonical source of truth: `ARCHETYPE_NAMES` in `packages/sdk/src/core/intent.ts`.
 * Three copies of that 18-name set are hand-maintained in other runtimes/files with
 * NO prior automated guard:
 *   - `apps/intent-engine/src/nlp.py` `_ARCHETYPES` (Python tuple — feeds the chat
 *     NLP prompt's allowed `archetype_hint` values).
 *   - `packages/db/src/seed/archetype-seeds.ts` `ARCHETYPE_SEEDS` (TS literal —
 *     feeds the Modal archetype-embeddings seed job).
 *   - `packages/db/migrations/0005_seed_archetype_embeddings.sql` (SQL INSERT —
 *     the Postgres seed for `archetype_embeddings`).
 *
 * Before this test, only the sdk<->shared pair was guarded
 * (`packages/sdk/src/__tests__/intent-weights-drift.test.ts`, whose doc comment
 * this file's structure mirrors). The three copies above could silently diverge
 * from `ARCHETYPE_NAMES` — add/remove/rename an archetype in one place and forget
 * the others — and nothing in CI would catch it. That is the exact "3 divergent
 * archetype sets" failure mode a 2026-05 audit once (wrongly, at the time) alleged
 * was already true; this test makes sure it can never quietly become true.
 *
 * WHAT MAKES THIS A REAL TEST (not a dead-wire test, per the QA charter):
 *   - `ARCHETYPE_NAMES` is imported directly from the real SDK source
 *     (`packages/sdk/src/core/intent.ts`) — the canonical oracle, not re-typed here.
 *   - The three copies are read and parsed from their REAL, currently-checked-in
 *     files on disk (`readFileSync` + regex against the actual `nlp.py` /
 *     `archetype-seeds.ts` / migration SQL text) — never a fixture that merely
 *     restates what the files are supposed to contain. Any edit to any of the four
 *     files changes what this test sees on the next run.
 *   - Each parser asserts it extracted a non-empty list before comparing, so a
 *     regex broken by a future reformat FAILS LOUDLY instead of vacuously passing
 *     with an empty "matches" set on both sides.
 *
 * WHY tests/integration/ (not packages/sdk/src/__tests__, despite the precedent
 * file living there): both `packages/sdk` and `packages/db` have `composite: true`
 * + `rootDir: "./src"` in their tsconfig (see `tsconfig.base.json`). A same-package
 * relative import can't reach across that boundary under `tsc --noEmit` without
 * tripping a rootDir violation. `tests/integration/` has no tsconfig/typecheck
 * script (turbo skips packages that don't define a task), so it is where
 * `intent-weights-live.smoke.test.ts` already does the same kind of cross-package
 * relative import (`../../packages/sdk/src/core/intent-weights.js`) without adding
 * `@estalara/sdk` as a declared dependency of this package. This file follows that
 * established precedent, and additionally lands squarely in QA's ownership of
 * `tests/integration/` (cross-cutting parity is not a single module's unit test).
 *
 * EXEMPTION (AC-b): `packages/sdk/src/auto-detect/archetype-hints.ts` is NOT
 * included in the full-parity assertions above. It is a deliberate SUBSET of
 * `ARCHETYPE_NAMES` — it derives Bayesian priors from site-level HTML/URL/schema
 * signals, and several archetypes (e.g. `neutral` by definition, and niche
 * investor sub-types with no distinguishing site-content pattern) have no
 * corresponding detectable signal. Its own dedicated test
 * (`packages/sdk/src/auto-detect/__tests__/archetype-hints.test.ts`) covers its
 * boost/summing/capping behavior. This file only asserts the weaker "subset
 * validity" property below: every archetype id it DOES reference must be a real,
 * spelled-correctly member of `ARCHETYPE_NAMES` (catches typos / stale ids after a
 * rename), and the set it references must be a PROPER subset (never accidentally
 * grows to look like full parity, which would silently invalidate this exemption).
 *
 * @module tests/integration/archetype-id-parity
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// ─── Production-path import: the canonical SoT, not re-typed here ────────────
import { ARCHETYPE_NAMES } from '../../packages/sdk/src/core/intent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf-8');
}

// ─── Parsers — each reads the REAL checked-in file, not a fixture copy ────────

/** Parses `_ARCHETYPES: tuple[str, ...] = (...)` out of the real `nlp.py`. */
function parseNlpPyArchetypes(source: string): string[] {
  const block = /_ARCHETYPES:\s*tuple\[str,\s*\.\.\.\]\s*=\s*\(([\s\S]*?)\)/.exec(source);
  if (!block) {
    throw new Error(
      'archetype-id-parity: could not locate `_ARCHETYPES: tuple[str, ...] = (...)` in ' +
        'apps/intent-engine/src/nlp.py — the literal was likely renamed or reformatted; ' +
        'update this parser regex to match.',
    );
  }
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
}

/** Parses `ARCHETYPE_SEEDS: readonly ArchetypeSeedRow[] = [...]` out of the real seed file. */
function parseArchetypeSeedsTs(source: string): string[] {
  const block =
    /ARCHETYPE_SEEDS:\s*readonly ArchetypeSeedRow\[\]\s*=\s*\[([\s\S]*?)\]\s*as const;/.exec(
      source,
    );
  if (!block) {
    throw new Error(
      'archetype-id-parity: could not locate `ARCHETYPE_SEEDS: readonly ArchetypeSeedRow[] = ' +
        '[...] as const;` in packages/db/src/seed/archetype-seeds.ts — the literal was likely ' +
        'renamed or reformatted; update this parser regex to match.',
    );
  }
  return [...block[1].matchAll(/archetypeName:\s*'([a-z_]+)'/g)].map((m) => m[1]!);
}

/** Parses the `archetype_name` value of every inserted row in migration 0005's SQL. */
function parseMigration0005Archetypes(source: string): string[] {
  const block = /INSERT INTO archetype_embeddings[\s\S]*?VALUES([\s\S]*?)ON CONFLICT/.exec(source);
  if (!block) {
    throw new Error(
      'archetype-id-parity: could not locate the `INSERT INTO archetype_embeddings ... VALUES ' +
        '... ON CONFLICT` block in packages/db/migrations/0005_seed_archetype_embeddings.sql — ' +
        'the migration was likely reformatted; update this parser regex to match.',
    );
  }
  // Each row opens with `(` immediately followed by a newline, then the quoted
  // archetype_name as the first column value — this distinguishes row-tuples from
  // the column-list `(archetype_name, description, ...)` on the INSERT line itself,
  // which has no newline directly after its opening paren.
  return [...block[1].matchAll(/\(\s*\r?\n\s*'([a-z_]+)',/g)].map((m) => m[1]!);
}

/** Parses every `archetype: '<id>'` reference out of the real archetype-hints.ts. */
function parseArchetypeHintsReferencedIds(source: string): Set<string> {
  const ids = new Set<string>();
  for (const m of source.matchAll(/archetype:\s*'([a-z_]+)'/g)) {
    ids.add(m[1]!);
  }
  return ids;
}

// ─── Set-equality assertion helper ────────────────────────────────────────────

function assertExactParity(label: string, actual: string[], canonical: readonly string[]): void {
  const canonicalSet = new Set(canonical);
  const actualSet = new Set(actual);

  const duplicates = actual.filter((name, idx) => actual.indexOf(name) !== idx);
  const missing = canonical.filter((name) => !actualSet.has(name));
  const extra = actual.filter((name) => !canonicalSet.has(name));

  expect(
    duplicates,
    `${label}: duplicate archetype entries found: [${duplicates.join(', ')}]`,
  ).toEqual([]);
  expect(
    missing,
    `${label}: MISSING archetypes present in ARCHETYPE_NAMES but absent here: [${missing.join(', ')}]. ` +
      'Rule J violation — add the missing archetype(s) to this copy.',
  ).toEqual([]);
  expect(
    extra,
    `${label}: EXTRA archetypes not present in ARCHETYPE_NAMES: [${extra.join(', ')}]. ` +
      'Rule J violation — either this copy has a stale/typo id, or ARCHETYPE_NAMES itself ' +
      'is missing an archetype that was added here first.',
  ).toEqual([]);
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('FOLLOW-561 — archetype-ID parity guard (Rule J)', () => {
  it('sanity: ARCHETYPE_NAMES (canonical SoT) currently has 18 entries', () => {
    // Not a hard requirement of the guard below (which compares by set, not count),
    // but documents the MASTER_DESIGN.md §D 18-archetype baseline this test assumes.
    expect(ARCHETYPE_NAMES.length).toBe(18);
  });

  it('apps/intent-engine/src/nlp.py _ARCHETYPES matches ARCHETYPE_NAMES exactly', () => {
    const source = readRepoFile('apps/intent-engine/src/nlp.py');
    const parsed = parseNlpPyArchetypes(source);
    expect(
      parsed.length,
      'parser matched 0 archetypes in nlp.py — regex is broken',
    ).toBeGreaterThan(0);
    assertExactParity('apps/intent-engine/src/nlp.py _ARCHETYPES', parsed, ARCHETYPE_NAMES);
  });

  it('packages/db/src/seed/archetype-seeds.ts ARCHETYPE_SEEDS matches ARCHETYPE_NAMES exactly', () => {
    const source = readRepoFile('packages/db/src/seed/archetype-seeds.ts');
    const parsed = parseArchetypeSeedsTs(source);
    expect(
      parsed.length,
      'parser matched 0 archetypes in archetype-seeds.ts — regex is broken',
    ).toBeGreaterThan(0);
    assertExactParity(
      'packages/db/src/seed/archetype-seeds.ts ARCHETYPE_SEEDS',
      parsed,
      ARCHETYPE_NAMES,
    );
  });

  it('migration 0005 inserted archetype_name values match ARCHETYPE_NAMES exactly', () => {
    const source = readRepoFile('packages/db/migrations/0005_seed_archetype_embeddings.sql');
    const parsed = parseMigration0005Archetypes(source);
    expect(
      parsed.length,
      'parser matched 0 archetypes in migration 0005 — regex is broken',
    ).toBeGreaterThan(0);
    assertExactParity(
      'packages/db/migrations/0005_seed_archetype_embeddings.sql',
      parsed,
      ARCHETYPE_NAMES,
    );
  });
});

describe('FOLLOW-561 — archetype-hints.ts exemption (AC-b: documented, not full parity)', () => {
  it('is EXEMPT from full-parity: every referenced id is valid, but the set stays a proper subset', () => {
    // See the file-top doc comment for the full rationale. This asserts the
    // weaker "subset validity" contract instead of set-equality:
    //   1. Every archetype id `archetype-hints.ts` references must be a real member
    //      of ARCHETYPE_NAMES (catches typos or ids left over from a rename).
    //   2. The referenced set must remain a PROPER subset of ARCHETYPE_NAMES — if it
    //      ever grew to cover all 18, that would silently invalidate this exemption
    //      and this test should be revisited (promote to assertExactParity instead).
    const source = readRepoFile('packages/sdk/src/auto-detect/archetype-hints.ts');
    const referenced = parseArchetypeHintsReferencedIds(source);

    expect(
      referenced.size,
      'parser matched 0 archetype references in archetype-hints.ts — regex is broken',
    ).toBeGreaterThan(0);

    const canonicalSet = new Set<string>(ARCHETYPE_NAMES);
    for (const id of referenced) {
      expect(
        canonicalSet.has(id),
        `archetype-hints.ts references '${id}', which is not a member of ARCHETYPE_NAMES ` +
          '(stale id after a rename, or a typo).',
      ).toBe(true);
    }

    expect(
      referenced.size,
      'archetype-hints.ts now references ALL 18 archetypes — it is no longer a deliberate ' +
        'subset. Revisit the AC-b exemption in this file and consider requiring full parity.',
    ).toBeLessThan(ARCHETYPE_NAMES.length);
  });
});
