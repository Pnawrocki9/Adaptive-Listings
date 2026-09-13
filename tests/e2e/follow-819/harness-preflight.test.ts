// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason ac1-verdict.test.ts pins this)

/**
 * FOLLOW-1200 / FOLLOW-1196 / FOLLOW-1205 — the FOLLOW-819 harness's artefact-freshness verdict
 * must not grade an artefact that is not a result of HEAD.
 *
 * Drives the REAL `evaluateArtefactStaleness()` out of `differentiator-e2e.mjs` (imported, not
 * copied) over every axis its docblock defines FRESH on: SHA present, run completed (not an abort
 * artefact), clean working tree, ancestor of HEAD, and zero commits behind. `--allow-stale` relaxes
 * the last axis only.
 *
 * The preflight PROBE and the origin check that used to live here moved to
 * `control-plane-probe.test.ts` (FOLLOW-1205/1206), which drives them through the real
 * `POST /api/adapt` handler and middleware. This file previously claimed to read the CORS
 * allowlist "at HEAD, not a copy hardcoded into a test" while testing a hardcoded copy; that reader
 * no longer exists, and neither does the copy.
 *
 * Red-first: `legacyStalenessOk()` below is the #898 predicate (ancestry only), carried as a column
 * so the table shows which rows it passed. The pre-FOLLOW-1205 `evaluateArtefactStaleness()` had no
 * input for the aborted or tree axes at all; the CLI transcript of it printing `[FRESH]`, exit 0, for
 * an abort artefact at HEAD is in the FOLLOW-1205 PR body.
 *
 * Collected by `tests/e2e/vitest.config.ts` (`**\/*.test.ts`); run by `pnpm e2e:smoke`, which
 * `.github/workflows/e2e-smoke.yml` executes nightly. It needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/harness-preflight.test
 */

import { beforeAll, describe, expect, it } from 'vitest';

interface Tree {
  dirty: boolean | null;
  dirtyPaths: string[] | null;
}
interface StalenessFacts {
  harnessSha: string | null;
  isAncestorOfHead: boolean | null;
  commitsBehind: number | null;
  aborted?: boolean;
  harnessTree?: Tree | null;
}
type Verdict = 'FRESH' | 'ALLOW_STALE' | 'STALE' | 'ABORTED' | 'DIRTY';
interface StalenessVerdict {
  ok: boolean;
  verdict: Verdict;
  allowedStale: boolean;
  commitsBehind: number | null;
  reason: string;
}
type EvaluateArtefactStaleness = (
  facts: StalenessFacts,
  options?: { allowStale?: boolean },
) => StalenessVerdict;

type EvaluateControlArmCredential = (adaptApiKey: string) => { ok: boolean; reason: string };

let evaluateArtefactStaleness: EvaluateArtefactStaleness;
let evaluateControlArmCredential: EvaluateControlArmCredential;

beforeAll(async () => {
  // The harness runs main() at import unless told not to — see the guard at its foot.
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as {
    evaluateArtefactStaleness: EvaluateArtefactStaleness;
    evaluateControlArmCredential: EvaluateControlArmCredential;
  };
  evaluateArtefactStaleness = mod.evaluateArtefactStaleness;
  evaluateControlArmCredential = mod.evaluateControlArmCredential;
});

/**
 * FOLLOW-1201 handoff: after #902 only the `ADAPT_API_KEY` ops bearer's `holdout_pct` is honoured,
 * so the harness must refuse to start without it, and say why. The route-side consequence lives in
 * #902's own `route.forgery-canary.test.ts` ("the ADAPT_API_KEY caller (FOLLOW-819 harness control
 * arm) CAN set holdout_pct: 1"), not here: this file cannot import a handler that is not on `main`
 * yet.
 */
describe('FOLLOW-1201 handoff — the control-arm credential preflight', () => {
  it.each([
    ['unset', ''],
    ['whitespace only', '   '],
  ])('%s → refuses, naming FOLLOW-1201', (_name, value) => {
    const v = evaluateControlArmCredential(value);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('FOLLOW-1201');
    expect(v.reason).toContain('ADAPT_API_KEY');
  });

  it('set → proceeds', () => {
    expect(evaluateControlArmCredential('local-follow819-key').ok).toBe(true);
  });
});

/**
 * The #898 staleness predicate, reproduced so the table below carries its column. It read ancestry
 * only.
 */
function legacyStalenessOk(harnessSha: string | null, isAncestorOfHead: boolean | null): boolean {
  if (typeof harnessSha !== 'string' || harnessSha.length === 0) return false;
  return isAncestorOfHead === true;
}

const SHA = 'fixture-sha-not-a-real-commit';
const CLEAN: Tree = { dirty: false, dirtyPaths: [] };

interface StalenessRow {
  name: string;
  facts: StalenessFacts;
  allowStale: boolean;
  legacyOk: boolean;
  ok: boolean;
  verdict: Verdict;
}

const row = (
  name: string,
  facts: StalenessFacts,
  expected: { ok: boolean; verdict: Verdict; legacyOk: boolean; allowStale?: boolean },
): StalenessRow => ({
  name,
  facts,
  allowStale: expected.allowStale ?? false,
  legacyOk: expected.legacyOk,
  ok: expected.ok,
  verdict: expected.verdict,
});

const at = (over: Partial<StalenessFacts> = {}): StalenessFacts => ({
  harnessSha: SHA,
  isAncestorOfHead: true,
  commitsBehind: 0,
  aborted: false,
  harnessTree: CLEAN,
  ...over,
});

const STALENESS: readonly StalenessRow[] = [
  row('produced AT HEAD, clean tree, completed', at(), {
    ok: true,
    verdict: 'FRESH',
    legacyOk: true,
  }),
  row(
    'no harnessSha at all',
    at({ harnessSha: null, isAncestorOfHead: null, commitsBehind: null }),
    {
      ok: false,
      verdict: 'STALE',
      legacyOk: false,
    },
  ),
  row('not an ancestor of HEAD', at({ isAncestorOfHead: false, commitsBehind: null }), {
    ok: false,
    verdict: 'STALE',
    legacyOk: false,
  }),
  row('ancestry unresolved', at({ isAncestorOfHead: null, commitsBehind: null }), {
    ok: false,
    verdict: 'STALE',
    legacyOk: false,
  }),
  // FOLLOW-1196: every earlier commit on a branch is an ancestor of its HEAD.
  row('same-branch artefact 27 commits behind HEAD', at({ commitsBehind: 27 }), {
    ok: false,
    verdict: 'STALE',
    legacyOk: true,
  }),
  row('ancestor, but the distance could not be counted', at({ commitsBehind: null }), {
    ok: false,
    verdict: 'STALE',
    legacyOk: true,
  }),
  row('27 commits behind with --allow-stale', at({ commitsBehind: 27 }), {
    ok: true,
    verdict: 'ALLOW_STALE',
    legacyOk: true,
    allowStale: true,
  }),
  row(
    'not an ancestor, even with --allow-stale',
    at({ isAncestorOfHead: false, commitsBehind: 27 }),
    {
      ok: false,
      verdict: 'STALE',
      legacyOk: false,
      allowStale: true,
    },
  ),
  row('uncountable distance, even with --allow-stale', at({ commitsBehind: null }), {
    ok: false,
    verdict: 'STALE',
    legacyOk: true,
    allowStale: true,
  }),
  // FOLLOW-1205, from the RETRO-326 amendment to FOLLOW-1196: the three axes ancestry cannot see.
  row('ABORT artefact at HEAD (the crashed run that read [FRESH])', at({ aborted: true }), {
    ok: false,
    verdict: 'ABORTED',
    legacyOk: true,
  }),
  row('ABORT artefact, even with --allow-stale', at({ aborted: true, commitsBehind: 3 }), {
    ok: false,
    verdict: 'ABORTED',
    legacyOk: true,
    allowStale: true,
  }),
  row(
    'dirty working tree at HEAD',
    at({ harnessTree: { dirty: true, dirtyPaths: ['tests/e2e/follow-819/fixture-listing.html'] } }),
    { ok: false, verdict: 'DIRTY', legacyOk: true },
  ),
  row(
    'dirty working tree, even with --allow-stale',
    at({ commitsBehind: 2, harnessTree: { dirty: true, dirtyPaths: ['apps/control-plane/x.ts'] } }),
    { ok: false, verdict: 'DIRTY', legacyOk: true, allowStale: true },
  ),
  row('no tree record (every artefact written before FOLLOW-1205)', at({ harnessTree: null }), {
    ok: false,
    verdict: 'STALE',
    legacyOk: true,
  }),
  row(
    'tree state unreadable at run time (git unavailable)',
    at({ harnessTree: { dirty: null, dirtyPaths: null } }),
    { ok: false, verdict: 'STALE', legacyOk: true },
  ),
];

const staleness = (r: StalenessRow) =>
  evaluateArtefactStaleness(r.facts, { allowStale: r.allowStale });

describe('artefact freshness — FRESH only for a completed, clean run AT HEAD', () => {
  it.each(STALENESS)('$name → $verdict (ok=$ok)', (r) => {
    const v = staleness(r);
    expect(v.ok).toBe(r.ok);
    expect(v.verdict).toBe(r.verdict);
    expect(v.allowedStale).toBe(r.verdict === 'ALLOW_STALE');
  });

  it.each(STALENESS)('$name → the #898 ancestry-only predicate said $legacyOk', (r) => {
    expect(legacyStalenessOk(r.facts.harnessSha, r.facts.isAncestorOfHead)).toBe(r.legacyOk);
  });
});

describe('artefact freshness — reporting names the axis that failed', () => {
  it('no harnessSha names the missing SHA', () => {
    expect(evaluateArtefactStaleness(at({ harnessSha: null })).reason).toContain('no harnessSha');
  });

  it('a non-ancestor names the ancestry failure', () => {
    expect(evaluateArtefactStaleness(at({ isAncestorOfHead: false })).reason).toContain(
      'not a verified ancestor of HEAD',
    );
  });

  it('a behind-HEAD refusal prints the SHA and commitsBehind, and names the escape hatch', () => {
    const v = evaluateArtefactStaleness(at({ commitsBehind: 27 }));
    expect(v.commitsBehind).toBe(27);
    expect(v.reason).toContain(SHA);
    expect(v.reason).toContain('commitsBehind=27');
    expect(v.reason).toContain('--allow-stale');
  });

  it('an allowed-stale grade still says STALE and commitsBehind in its reason', () => {
    const v = evaluateArtefactStaleness(at({ commitsBehind: 27 }), { allowStale: true });
    expect(v.reason).toContain('STALE');
    expect(v.reason).toContain('commitsBehind=27');
  });

  it('an abort artefact says it is not a result, not merely old', () => {
    const v = evaluateArtefactStaleness(at({ aborted: true }));
    expect(v.reason).toContain('ABORT artefact');
    expect(v.reason).toContain('UNMEASURED');
  });

  it('a dirty run lists the dirty paths it ran with', () => {
    const v = evaluateArtefactStaleness(
      at({
        harnessTree: { dirty: true, dirtyPaths: ['tests/e2e/follow-819/fixture-listing.html'] },
      }),
    );
    expect(v.reason).toContain('tests/e2e/follow-819/fixture-listing.html');
    expect(v.reason).toContain('does not name the bytes that ran');
  });

  it('an artefact at HEAD reads FRESH and names the SHA and commitsBehind=0', () => {
    const v = evaluateArtefactStaleness(at());
    expect(v.reason).toContain(SHA);
    expect(v.reason).toContain('commitsBehind=0');
  });
});
