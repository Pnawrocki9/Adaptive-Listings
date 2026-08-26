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
 * 17 distinct tokens ship across 16 of the 18 archetypes,
 * almost all of them on the `headline` slot — the highest-value surface. Exactly two of the
 * 17 have ANY emitter anywhere in non-test code, and that emitter is a DASHBOARD DEMO page
 * (`apps/control-plane/src/app/dashboard/demo/mockup/page.tsx`, hardcoded `MOCKUP_LISTINGS`),
 * not a tenant install path. The one real tenant integration that exists — the pilot listing
 * page, `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §1 — emits `headline` + `description`
 * slots and no fact attributes at all. See ESC-074 (the product ruling: who is supposed to
 * emit these, or should the templates stop demanding them) and FOLLOW-1140.
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
  // — the only two with any emitter at all, and it is a dashboard DEMO, not a tenant page —
  bedrooms: ['apps/control-plane/src/app/dashboard/demo/mockup/page.tsx'],
  yield: ['apps/control-plane/src/app/dashboard/demo/mockup/page.tsx'],
  // — no emitter anywhere in the repo: these 15 tokens delete their directive on every page —
  arv: [],
  climate: [],
  income: [],
  internet_speed: [],
  key_feature: [],
  key_luxury_feature: [],
  location_highlight: [],
  minutes: [],
  monthly_payment: [],
  neighborhood: [],
  nightly_rate: [],
  school_rating: [],
  sqm: [],
  threshold: [],
  university: [],
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
});
