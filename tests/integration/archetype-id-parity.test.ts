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
 * FOLLOW-583 (RETRO-178) additions — a repo-wide grep for `golden_visa_buyer`
 * found a 4th hand-maintained full-parity copy the FOLLOW-561 guard missed, plus
 * two more subset copies (one of them already broken):
 *   - `apps/llm-gateway/src/jobs/generate_description.py` `_ARCHETYPE_GUIDANCE`
 *     (full parity, production-live): feeds the live Modal AI-description/headline
 *     prompt via `.get(archetype, "<generic fallback>")`. A missing key here does
 *     NOT throw — it silently falls back to generic copy for that one archetype
 *     forever, the exact failure class this whole guard file exists to prevent.
 *     Parsed from the real checked-in `.py` file, same discipline as the three
 *     parsers above (non-empty check, fail-loud regex).
 *   - `apps/control-plane/src/lib/demo-override-store.ts` `REACHABLE_ARCHETYPES`
 *     (subset, legitimate): a documented 13-of-18 "reachable archetypes" allow-list
 *     (Master Design §D.6) for the demo-mode override UI. Guarded the same way as
 *     the `archetype-hints.ts` exemption above — subset validity, not full parity.
 *   - `apps/control-plane/src/app/api/admin/labels/route-helpers.ts`
 *     `MOCK_ARCHETYPES` + `.../export/route.ts`'s inline `buildMockExportRows()`
 *     literals (subset, dev/CI-only): both are `data_source: 'mock'` fixtures used
 *     only when `CLICKHOUSE_URL`/`DATABASE_URL_ADMIN` are absent — never served to
 *     real tenants. Guarded with subset validity (not full parity — a 5-row mock
 *     fixture has no reason to cover all 18 archetypes). This is the copy that was
 *     ALREADY BROKEN: both files hard-coded `'family_upsizer'`, which is not a
 *     member of `ARCHETYPE_NAMES` (the canonical set has `family_buyer` and
 *     `upsizer` as two separate archetypes) — TypeScript never caught it because
 *     both fields are typed `archetype: string`, not the canonical union type.
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

/**
 * Parses the top-level keys of `_ARCHETYPE_GUIDANCE: dict[str, str] = {...}` out
 * of the real `generate_description.py`. Each value is a multi-line parenthesised
 * Python string (nested quotes/commas inside the prose), so the key regex is
 * anchored to the exact 4-space indent + `"<key>": (` shape that only top-level
 * dict entries use — a value line never starts a new statement at that indent
 * with a trailing `": ("`, so this cannot accidentally match a substring inside
 * one of the guidance strings.
 */
function parseArchetypeGuidancePyKeys(source: string): string[] {
  const block = /_ARCHETYPE_GUIDANCE:\s*dict\[str,\s*str\]\s*=\s*\{([\s\S]*?)\n\}/.exec(source);
  if (!block) {
    throw new Error(
      'archetype-id-parity: could not locate `_ARCHETYPE_GUIDANCE: dict[str, str] = {...}` in ' +
        'apps/llm-gateway/src/jobs/generate_description.py — the literal was likely renamed or ' +
        'reformatted; update this parser regex to match.',
    );
  }
  return [...block[1].matchAll(/^\s{4}"([a-z_]+)":\s*\(/gm)].map((m) => m[1]!);
}

/** Parses the `REACHABLE_ARCHETYPES = [...] as const;` array literal. */
function parseReachableArchetypes(source: string): Set<string> {
  const block = /REACHABLE_ARCHETYPES\s*=\s*\[([\s\S]*?)\]\s*as const;/.exec(source);
  if (!block) {
    throw new Error(
      'archetype-id-parity: could not locate `REACHABLE_ARCHETYPES = [...] as const;` in ' +
        'apps/control-plane/src/lib/demo-override-store.ts — the literal was likely renamed or ' +
        'reformatted; update this parser regex to match.',
    );
  }
  return new Set([...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));
}

/** Parses the `MOCK_ARCHETYPES = [...] as const;` array literal. */
function parseMockArchetypes(source: string): Set<string> {
  const block = /MOCK_ARCHETYPES\s*=\s*\[([\s\S]*?)\]\s*as const;/.exec(source);
  if (!block) {
    throw new Error(
      'archetype-id-parity: could not locate `MOCK_ARCHETYPES = [...] as const;` in ' +
        'apps/control-plane/src/app/api/admin/labels/route-helpers.ts — the literal was likely ' +
        'renamed or reformatted; update this parser regex to match.',
    );
  }
  return new Set([...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));
}

/**
 * Parses every quoted `archetype: '<id>'` object-literal value out of
 * export/route.ts's `buildMockExportRows()`. Only matches quoted string values
 * (the interface declaration uses `archetype: string;`, no quotes, so it can't
 * be picked up here).
 */
function parseExportRouteMockArchetypes(source: string): Set<string> {
  return new Set([...source.matchAll(/archetype:\s*'([a-z_]+)'/g)].map((m) => m[1]!));
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

/**
 * Weaker "subset validity" assertion for deliberate, documented subsets of
 * `ARCHETYPE_NAMES` (mirrors the archetype-hints.ts exemption shape, FOLLOW-583):
 *   1. Every referenced id must be a real, spelled-correctly member of
 *      `ARCHETYPE_NAMES` (catches typos / stale ids after a rename).
 *   2. The referenced set must remain a PROPER subset — never silently grow to
 *      cover all 18, which would mean the copy should be promoted to
 *      `assertExactParity` instead of staying exempt.
 */
function assertSubsetValidity(
  label: string,
  referenced: Iterable<string>,
  canonical: readonly string[],
): void {
  const referencedSet = new Set(referenced);
  const canonicalSet = new Set(canonical);

  const invalid = [...referencedSet].filter((id) => !canonicalSet.has(id));
  expect(
    invalid,
    `${label}: references invalid archetype id(s) not in ARCHETYPE_NAMES: [${invalid.join(', ')}]. ` +
      'Stale id after a rename, or a typo.',
  ).toEqual([]);

  expect(
    referencedSet.size,
    `${label}: now references ALL ${String(canonical.length)} archetypes — it is no longer a deliberate ` +
      'subset. Revisit this exemption and consider requiring full parity.',
  ).toBeLessThan(canonical.length);
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

  it('apps/llm-gateway/src/jobs/generate_description.py _ARCHETYPE_GUIDANCE matches ARCHETYPE_NAMES exactly', () => {
    // FOLLOW-583 (RETRO-178): this dict feeds the LIVE Modal AI-description/headline
    // prompt via `.get(archetype, "<generic fallback>")` — a missing key does not
    // throw, it silently degrades one archetype to generic copy forever. Highest
    // production consequence of the four copies this file guards.
    const source = readRepoFile('apps/llm-gateway/src/jobs/generate_description.py');
    const parsed = parseArchetypeGuidancePyKeys(source);
    expect(
      parsed.length,
      'parser matched 0 archetypes in generate_description.py _ARCHETYPE_GUIDANCE — regex is broken',
    ).toBeGreaterThan(0);
    assertExactParity(
      'apps/llm-gateway/src/jobs/generate_description.py _ARCHETYPE_GUIDANCE',
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

describe('FOLLOW-583 — demo-override-store.ts REACHABLE_ARCHETYPES (documented subset, §D.6)', () => {
  it('is a valid, proper subset of ARCHETYPE_NAMES: every referenced id is real, set stays partial', () => {
    // REACHABLE_ARCHETYPES is a legitimate, documented 13-of-18 allow-list for the
    // demo-mode override UI (Master Design §D.6) — NOT a bug, so this is
    // subset-validity (like archetype-hints.ts above), not full parity.
    const source = readRepoFile('apps/control-plane/src/lib/demo-override-store.ts');
    const referenced = parseReachableArchetypes(source);

    expect(
      referenced.size,
      'parser matched 0 archetypes in demo-override-store.ts REACHABLE_ARCHETYPES — regex is broken',
    ).toBeGreaterThan(0);

    assertSubsetValidity(
      'apps/control-plane/src/lib/demo-override-store.ts REACHABLE_ARCHETYPES',
      referenced,
      ARCHETYPE_NAMES,
    );
  });
});

describe('FOLLOW-583 — admin/labels mock archetype fixtures (dev/CI-only, data_source: "mock")', () => {
  // MOCK_ARCHETYPES (route-helpers.ts) and buildMockExportRows()'s inline literals
  // (export/route.ts) are both dev/CI-only fixtures used only when
  // CLICKHOUSE_URL/DATABASE_URL_ADMIN are absent — never served to real tenants
  // (both responses carry data_source: 'mock', which the page must badge). A 5-row
  // fixture has no reason to cover all 18 archetypes, so this is subset validity,
  // not full parity — same shape as the two exemptions above. This is the copy
  // RETRO-178 found ALREADY BROKEN: both files hard-coded 'family_upsizer', which
  // is not a member of ARCHETYPE_NAMES.
  it('MOCK_ARCHETYPES + export route inline literals are a valid, proper subset of ARCHETYPE_NAMES', () => {
    const routeHelpersSource = readRepoFile(
      'apps/control-plane/src/app/api/admin/labels/route-helpers.ts',
    );
    const exportRouteSource = readRepoFile(
      'apps/control-plane/src/app/api/admin/labels/export/route.ts',
    );

    const mockArchetypes = parseMockArchetypes(routeHelpersSource);
    const exportRouteArchetypes = parseExportRouteMockArchetypes(exportRouteSource);

    expect(
      mockArchetypes.size,
      'parser matched 0 archetypes in route-helpers.ts MOCK_ARCHETYPES — regex is broken',
    ).toBeGreaterThan(0);
    expect(
      exportRouteArchetypes.size,
      'parser matched 0 archetype literals in export/route.ts buildMockExportRows() — regex is broken',
    ).toBeGreaterThan(0);

    const combined = new Set([...mockArchetypes, ...exportRouteArchetypes]);

    assertSubsetValidity(
      'route-helpers.ts MOCK_ARCHETYPES + export/route.ts buildMockExportRows() literals',
      combined,
      ARCHETYPE_NAMES,
    );
  });
});
