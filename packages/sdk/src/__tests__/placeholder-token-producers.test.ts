/**
 * FOLLOW-1139 — CI gate: every `{token}` a playbook SHIPS is registered, and its producer
 * status is machine-checked rather than assumed.
 *
 * THE FAILURE THIS EXISTS TO MAKE LOUD. `slots[].en` copy may carry `{token}` placeholders;
 * `template-purity.test.ts` says so in as many words and deliberately exempts them from its
 * scan ("resolved at render time by the SDK, not by Sonnet"). What nothing enforced is the
 * OTHER half of that sentence: the SDK resolves `{token}` from a `data-estalara-<token>`
 * attribute on the matched slot element (`interpolatePlaceholders`, `core/adapt.ts`), and
 * since FOLLOW-1018 a single unresolved token discards the WHOLE directive — correctly, so
 * buyers never see raw braces. A token that no page can satisfy therefore does not degrade,
 * it DELETES the adaptation, silently, on every page and for every tenant, leaving only an
 * `adapt.skipped {unresolved_token_<name>}` row nobody queries.
 *
 * MEASURED BY THE REGISTER BELOW, WHICH THIS TEST RE-DERIVES ON EVERY RUN (FOLLOW-1139):
 * 5 distinct tokens ship across 6 of the 18 archetypes, all on the `headline` slot bar one.
 * Exactly one of the 5 has ANY emitter in non-test code, and that emitter is a DASHBOARD DEMO
 * page (`apps/control-plane/src/app/dashboard/demo/mockup/page.tsx`, hardcoded
 * `MOCKUP_LISTINGS`), not a tenant install path. The one real tenant integration that exists —
 * the pilot listing page, `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §1 — emits `headline` +
 * `description` slots and no fact attributes at all. That no longer deletes anything: all 5
 * resolve SERVER-side (FOLLOW-1140 (b)).
 *
 * IT WAS 17 TOKENS ACROSS 16 ARCHETYPES, AND THE DIFFERENCE IS NOT PLUMBING. ESC-074 asked who
 * was supposed to emit these; the answer for twelve of them was nobody, because the value was
 * not a fact of the listing at all. Under the ESC-075 ruling those twelve were written OUT of
 * the copy rather than given an invented source. The five that remain are the five the listing
 * backend actually carries.
 *
 * SECOND AXIS, ADDED BY FOLLOW-1140 (b). ESC-074 was ruled (b) + (c): `/api/adapt` now fills
 * what it can SERVER-side from the listing's own facts, so a page attribute is no longer the
 * only way a token can resolve. A token is therefore satisfiable if EITHER axis covers it, and
 * the register below carries both — the DOM-producer axis (`SHIPPED_TOKEN_PRODUCERS`, scanned)
 * and the server axis (`SERVER_RESOLVED_PLACEHOLDER_TOKENS`, imported from `@estalara/shared`,
 * which is the same list the route's resolver table is keyed by, so the two cannot drift).
 *
 * The residual is what the third test below computes rather than asserts from prose: tokens
 * with NO producer and NO server resolver. It is now ZERO, and the count stays pinned so it can
 * only move deliberately. `{bedrooms}` sits in the register's producer column but that producer
 * is still only the dashboard demo — it survives because it is server-resolved, not because the
 * demo emits it. ESC-075 is RESOLVED; the twelve tokens (b) could not reach are gone from the
 * copy, not waiting on a source.
 *
 * These counts are deliberately NOT a `[MP-NNN]` premise: the register is for claims this
 * repo cannot verify from its own contents, and this one it re-derives from source on every
 * CI run. That is why the paragraph above carries no measurement date — there is nothing
 * here that can go stale without the test below going red.
 *
 * WHAT THIS GATE DOES AND DOES NOT CLAIM. It does NOT claim the register's contents are
 * acceptable — they are not, which is what ESC-074 is for. It claims the register is TRUE:
 * a new placeholder token cannot be shipped without appearing here, and a producer cannot
 * appear or disappear without this test naming it. That is the ratchet. Per Rule AP the
 * residual gap is a machine-checked register the gate executes, never prose.
 *
 * @see packages/sdk/src/core/adapt.ts `interpolatePlaceholders`
 * @see packages/sdk/src/__tests__/template-purity.test.ts (the complementary invariant)
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative, dirname, sep } from 'path';
import { fileURLToPath } from 'url';

import { SERVER_RESOLVED_PLACEHOLDER_TOKENS } from '@estalara/shared';

import { getAllPlaybooks } from '../core/playbooks/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Repo root: `<root>/packages/sdk/src/__tests__` → four levels up. */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

/**
 * Non-test producers of `data-estalara-<token>` for every token the playbooks ship, as
 * measured by `scanProducers()`. `[]` means NOTHING in the repo can satisfy that token, so
 * every directive carrying it is discarded before it reaches the DOM.
 *
 * Updating this register by hand to make the test pass is the intended workflow ONLY when
 * the change is deliberate — adding a token here without an emitter is adding a directive
 * that will never paint.
 */
const SHIPPED_TOKEN_PRODUCERS: Readonly<Record<string, readonly string[]>> = {
  // — the only token with any DOM emitter at all, and it is a dashboard DEMO, not a tenant page.
  //   It no longer matters for satisfiability: since ESC-075 every shipped token is server-
  //   resolvable, so this column records where the DOM axis stands, not whether copy survives. —
  bedrooms: ['apps/control-plane/src/app/dashboard/demo/mockup/page.tsx'],
  // — no DOM emitter anywhere in the repo, and since FOLLOW-1140 (b) that is not the same thing
  //   as unsatisfiable: all four are filled server-side from the listing's own facts. —
  key_feature: [],
  location_highlight: [],
  neighborhood: [],
  sqm: [],
};

/** Directory names that are not production source and must not count as producers. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.git',
  '__tests__',
  '__mocks__',
  'e2e',
  'fixtures',
]);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|svelte|vue|html)$/;

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(join(dir, entry.name), out);
      continue;
    }
    if (!SOURCE_EXT.test(entry.name)) continue;
    if (/\.(test|spec)\./.test(entry.name)) continue;
    out.push(join(dir, entry.name));
  }
}

/**
 * Repo-wide map of `data-estalara-<kebab>` → the non-test files that EMIT it.
 *
 * The `=` is load-bearing: it separates an emission (`data-estalara-yield="7.2"`,
 * `data-estalara-yield={…}`) from a mention in prose or a selector
 * (`` `data-estalara-school-rating` attribute ``, `'[data-estalara-listing]'`). Without it
 * `core/adapt.ts`'s own docblock counts as a producer of two tokens it merely names — the
 * exact "the repo wearing the costume of a producer" shape Rule AU is about.
 */
function scanProducers(): Map<string, string[]> {
  const files: string[] = [];
  for (const top of ['apps', 'packages']) collectSourceFiles(join(REPO_ROOT, top), files);

  const producers = new Map<string, string[]>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/data-estalara-([a-z][a-z0-9-]*)\s*=/g)) {
      const key = match[1]!;
      const rel = relative(REPO_ROOT, file).split(sep).join('/');
      const list = producers.get(key) ?? [];
      if (!list.includes(rel)) list.push(rel);
      producers.set(key, list);
    }
  }
  return producers;
}

/** Every distinct `{token}` in every locale and every bandit variant of every playbook slot. */
function shippedTokens(): string[] {
  const tokens = new Set<string>();
  for (const playbook of getAllPlaybooks().values()) {
    for (const slot of playbook.slots) {
      const copies = [
        slot.en,
        slot.pl,
        slot.es,
        ...(slot.variants?.en ?? []),
        ...(slot.variants?.pl ?? []),
        ...(slot.variants?.es ?? []),
      ].filter((c): c is string => typeof c === 'string');
      for (const copy of copies) {
        for (const match of copy.matchAll(/\{([a-z][a-z0-9_]*)\}/gi)) {
          tokens.add(match[1]!.toLowerCase());
        }
      }
    }
  }
  return [...tokens].sort();
}

/**
 * Shipped tokens that NOTHING can satisfy — no `data-estalara-<token>` emitter anywhere in
 * non-test source, and no server-side resolver either. Each one would still DELETE its directive
 * on every page, for every tenant (FOLLOW-1018).
 *
 * **Zero, as of the ESC-075 ruling.** It was eleven. The twelve tokens no data could reach were
 * not given a source — they were removed from the copy, which is the option ESC-074 had listed
 * as (a) and refused when (b) was believed to cover everything. What replaced each one is the
 * qualitative phrasing that archetype's OWN `copy_template` HARD RULES already name as
 * acceptable, so the slot templates now agree with the anti-hallucination contract they used to
 * contradict.
 *
 * This going UP means a token shipped that nothing can fill.
 */
const ZERO_SOURCE_TOKEN_COUNT = 0;

/**
 * Shipped tokens `POST /api/adapt` cannot resolve from any data it holds (FOLLOW-1140 (b)).
 *
 * **Zero, and this is the number ESC-075 was opened to move.** It was twelve: rent, renovation
 * and mortgage inputs the listing backend does not carry (`{yield}`, `{income}`,
 * `{nightly_rate}`, `{arv}`, `{monthly_payment}`); third-party datasets (`{school_rating}`,
 * `{university}`, `{minutes}`, `{climate}`, `{internet_speed}`); one legal constant
 * (`{threshold}`); and one needing an editorial ruling on which amenities read as luxury
 * (`{key_luxury_feature}`). None was given a fabricated source. All twelve were written out of
 * the copy under the CEO ruling on ESC-075, option 1.
 *
 * With this at zero, no playbook directive can be discarded for an unresolvable token on the
 * playbook path. `fallback_reason: 'unresolved_placeholder_tokens'` therefore becomes a signal
 * that something REGRESSED — a new token shipped, or a listing lacks a fact a shipped token
 * needs — rather than the steady-state it was when this file was written.
 */
const SERVER_UNREACHABLE_TOKEN_COUNT = 0;

describe('FOLLOW-1139 — playbook placeholder tokens vs. their producers', () => {
  it('every shipped token is in the register (a new token cannot ship unnoticed)', () => {
    expect(shippedTokens()).toEqual(Object.keys(SHIPPED_TOKEN_PRODUCERS).sort());
  });

  it('the register matches a live scan of non-test producers', () => {
    const scanned = scanProducers();
    const actual: Record<string, string[]> = {};
    for (const token of Object.keys(SHIPPED_TOKEN_PRODUCERS).sort()) {
      actual[token] = (scanned.get(token.replace(/_/g, '-')) ?? []).sort();
    }
    const expected: Record<string, string[]> = {};
    for (const token of Object.keys(SHIPPED_TOKEN_PRODUCERS).sort()) {
      expected[token] = [...SHIPPED_TOKEN_PRODUCERS[token]!].sort();
    }
    expect(actual).toEqual(expected);
  });

  it('the count of tokens NOTHING can satisfy is pinned (FOLLOW-1140 (b))', () => {
    const serverResolved = new Set<string>(SERVER_RESOLVED_PLACEHOLDER_TOKENS);
    const zeroSource = shippedTokens().filter(
      (token) => SHIPPED_TOKEN_PRODUCERS[token]!.length === 0 && !serverResolved.has(token),
    );
    expect(zeroSource).toHaveLength(ZERO_SOURCE_TOKEN_COUNT);
  });

  it('the count of tokens the SERVER cannot reach is pinned (ESC-075)', () => {
    const serverResolved = new Set<string>(SERVER_RESOLVED_PLACEHOLDER_TOKENS);
    const unreachable = shippedTokens().filter((token) => !serverResolved.has(token));
    expect(unreachable).toHaveLength(SERVER_UNREACHABLE_TOKEN_COUNT);
  });

  it('every server-resolvable token is one the playbooks actually ship', () => {
    // The reverse direction of the contract: a resolver for a token no playbook uses is code
    // that can never run, and the route's resolver table is keyed by this same list.
    const shipped = new Set(shippedTokens());
    const orphans = SERVER_RESOLVED_PLACEHOLDER_TOKENS.filter((t) => !shipped.has(t));
    expect(orphans).toEqual([]);
  });
});
