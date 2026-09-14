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

import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

// ─── FOLLOW-1208: freshness on a REAL git history ────────────────────────────────────────────
//
// Every row below builds a throwaway git repository, makes real commits (and, for the squash
// rows, a real `git merge --squash`), writes an artefact whose `harnessSha` is a commit of THAT
// repository, and runs the harness's own `--check-staleness` CLI as a child process with
// `GIT_DIR`/`GIT_WORK_TREE` pointed at it. No git fact is typed in: `isAncestorOfHead`,
// `commitsBehind` and the measured-path diff are all read by the harness from the repository,
// exactly as a grader's invocation reads them from this one. The assertion is the CLI's printed
// verdict word and its exit code (Rule Q amendment 1 clause 7).

const HARNESS_PATH = fileURLToPath(new URL('./differentiator-e2e.mjs', import.meta.url));

/** Every file a temp repository starts with: one per measured path, plus unmeasured neighbours. */
const TEMP_REPO_FILES = [
  'apps/control-plane/src/app/api/adapt/route.ts',
  'apps/control-plane/scripts/seed-local-tenant.mts',
  'packages/shared/src/ab-holdout.ts',
  'infra/clickhouse/migrations/0001_init.sql',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tests/e2e/follow-819/differentiator-e2e.mjs',
  'tests/e2e/follow-819/bandit-probe.mjs',
  'tests/e2e/follow-819/fixture-listing.html',
  'tests/e2e/follow-819/README.md',
  'tests/e2e/follow-819/harness-preflight.test.ts',
  'tests/e2e/smoke-ingest.test.ts',
  'backlog/RETROSPECTIVES.md',
  'docs/MASTER_DESIGN.md',
  'CONVENTIONS_PATCH.md',
] as const;

const execFileP = promisify(execFile);

/** A child environment bound to ONE temp repository, with no inherited git state or config. */
function tempRepoEnv(dir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return {
    ...env,
    GIT_DIR: path.join(dir, '.git'),
    GIT_WORK_TREE: dir,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'follow-1208',
    GIT_AUTHOR_EMAIL: 'follow-1208@example.invalid',
    GIT_COMMITTER_NAME: 'follow-1208',
    GIT_COMMITTER_EMAIL: 'follow-1208@example.invalid',
    GIT_AUTHOR_DATE: '2026-09-14T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-09-14T00:00:00Z',
  };
}

interface CliResult {
  exit: number;
  verdict: string | null;
  out: string;
}

class TempRepo {
  private artefacts = 0;
  private constructor(readonly dir: string) {}

  static async create(): Promise<TempRepo> {
    const repo = new TempRepo(await mkdtemp(path.join(tmpdir(), 'follow-1208-')));
    await repo.git('init', '-q', '-b', 'main');
    await repo.commit('base', Object.fromEntries(TEMP_REPO_FILES.map((f) => [f, 'v1\n'])));
    return repo;
  }

  async git(...args: string[]): Promise<string> {
    const { stdout } = await execFileP('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: this.dir,
      env: tempRepoEnv(this.dir),
    });
    return stdout.trim();
  }

  /** Append a line to each named file (creating it when absent), commit, return the new SHA. */
  async commit(message: string, files: Record<string, string>): Promise<string> {
    for (const [file, line] of Object.entries(files)) {
      const abs = path.join(this.dir, file);
      await mkdir(path.dirname(abs), { recursive: true });
      await appendFile(abs, line);
    }
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', message);
    return this.git('rev-parse', 'HEAD');
  }

  async isAncestorOfHead(sha: string): Promise<boolean> {
    return this.git('merge-base', '--is-ancestor', sha, 'HEAD').then(
      () => true,
      () => false,
    );
  }

  /** Write an artefact OUTSIDE the work tree (inside `.git`), so it cannot dirty the repository. */
  async artefact(fields: Record<string, unknown>): Promise<string> {
    this.artefacts += 1;
    const file = path.join(this.dir, '.git', `artefact-${this.artefacts}.json`);
    await writeFile(
      file,
      JSON.stringify({
        startedAt: '2026-09-14T00:00:00.000Z',
        harnessTree: { dirty: false, dirtyPaths: [] },
        ...fields,
      }),
    );
    return file;
  }

  /** Run the REAL `--check-staleness` CLI against this repository. */
  async check(artefactPath: string, ...flags: string[]): Promise<CliResult> {
    const args = [HARNESS_PATH, '--check-staleness', artefactPath, ...flags];
    const env = tempRepoEnv(this.dir);
    const done = await execFileP(process.execPath, args, { env }).then(
      ({ stdout, stderr }) => ({ exit: 0, out: stdout + stderr }),
      (err: { code?: number; stdout?: string; stderr?: string }) => ({
        exit: typeof err.code === 'number' ? err.code : -1,
        out: `${err.stdout ?? ''}${err.stderr ?? ''}`,
      }),
    );
    const m = /\[(FRESH|STALE|ABORTED|DIRTY|ALLOW-STALE)\]/.exec(done.out);
    return { ...done, verdict: m ? m[1] : null };
  }

  async remove(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}

const repos: TempRepo[] = [];
const newRepo = async () => {
  const r = await TempRepo.create();
  repos.push(r);
  return r;
};
afterAll(async () => {
  await Promise.all(repos.map((r) => r.remove()));
});

/** `commitsBehind=<digits>`: a rev-list count. A non-ancestor's verdict line must never carry one. */
const COMMITS_BEHIND_AS_DISTANCE = /commitsBehind=\d/;

/**
 * One commit touching `changed` lands after the run's commit. Measured → still STALE (and
 * `--allow-stale` grades it loudly); unmeasured → FRESH, because no byte the run executed moved.
 */
const AFTER_RUN: ReadonlyArray<{ changed: string; measured: boolean }> = [
  { changed: 'apps/control-plane/src/app/api/adapt/route.ts', measured: true },
  { changed: 'apps/control-plane/scripts/seed-local-tenant.mts', measured: true },
  { changed: 'packages/shared/src/ab-holdout.ts', measured: true },
  { changed: 'infra/clickhouse/migrations/0001_init.sql', measured: true },
  { changed: 'package.json', measured: true },
  { changed: 'pnpm-lock.yaml', measured: true },
  { changed: 'pnpm-workspace.yaml', measured: true },
  { changed: 'turbo.json', measured: true },
  { changed: 'tests/e2e/follow-819/differentiator-e2e.mjs', measured: true },
  { changed: 'tests/e2e/follow-819/bandit-probe.mjs', measured: true },
  { changed: 'tests/e2e/follow-819/fixture-listing.html', measured: true },
  { changed: 'tests/e2e/follow-819/README.md', measured: false },
  { changed: 'tests/e2e/follow-819/harness-preflight.test.ts', measured: false },
  { changed: 'tests/e2e/smoke-ingest.test.ts', measured: false },
  { changed: 'backlog/RETROSPECTIVES.md', measured: false },
  { changed: 'docs/MASTER_DESIGN.md', measured: false },
  { changed: 'CONVENTIONS_PATCH.md', measured: false },
];

describe('FOLLOW-1208 — path-aware freshness on a real linear history', () => {
  it.each(AFTER_RUN)('run, then one commit to $changed → measured=$measured', async (r) => {
    const repo = await newRepo();
    const run = await repo.git('rev-parse', 'HEAD');
    await repo.commit(`touch ${r.changed}`, { [r.changed]: 'v2\n' });
    const art = await repo.artefact({ harnessSha: run });

    const plain = await repo.check(art);
    expect(plain.verdict, plain.out).toBe(r.measured ? 'STALE' : 'FRESH');
    expect(plain.exit, plain.out).toBe(r.measured ? 1 : 0);

    const allow = await repo.check(art, '--allow-stale');
    expect(allow.verdict, allow.out).toBe(r.measured ? 'ALLOW-STALE' : 'FRESH');
    expect(allow.exit, allow.out).toBe(0);
  });

  it('the #899 → #900 → #901 shape: a docs commit then a retro commit → FRESH, printing both numbers', async () => {
    const repo = await newRepo();
    const run = await repo.git('rev-parse', 'HEAD');
    await repo.commit('docs: master design', { 'docs/MASTER_DESIGN.md': 'v2\n' });
    await repo.commit('docs: retro', { 'backlog/RETROSPECTIVES.md': 'v2\n' });
    expect(await repo.isAncestorOfHead(run)).toBe(true);

    const v = await repo.check(await repo.artefact({ harnessSha: run }));
    expect(v.verdict, v.out).toBe('FRESH');
    expect(v.exit).toBe(0);
    expect(v.out).toContain('commitsBehind=2');
    expect(v.out).toContain('measuredPathsChanged=0');
  });
});

describe('FOLLOW-1208 — squash topology on a real `git merge --squash`', () => {
  let repo: TempRepo;
  /** A branch commit that changed product code; a LATER branch commit then changed the harness. */
  let branchEarly: string;
  /** The branch head: where a worker runs the harness before the PR squash-merges. */
  let branchHead: string;
  let squash: string;

  beforeAll(async () => {
    repo = await newRepo();
    await repo.git('checkout', '-q', '-b', 'feature');
    branchEarly = await repo.commit('feat: route', {
      'apps/control-plane/src/app/api/adapt/route.ts': 'branch\n',
    });
    branchHead = await repo.commit('test: harness', {
      'tests/e2e/follow-819/differentiator-e2e.mjs': 'branch\n',
    });
    await repo.git('checkout', '-q', 'main');
    await repo.commit('docs: design', { 'docs/MASTER_DESIGN.md': 'main\n' });
    await repo.git('merge', '-q', '--squash', 'feature');
    await repo.git('commit', '-q', '-m', 'test: harness (#1)');
    squash = await repo.git('rev-parse', 'HEAD');
    await repo.commit('docs: retro for #1', { 'backlog/RETROSPECTIVES.md': 'retro\n' });
  });

  it('the topology is real: a one-parent squash commit, and no branch commit is an ancestor of HEAD', async () => {
    const parents = (await repo.git('rev-list', '--parents', '-n', '1', squash)).split(' ');
    expect(parents).toHaveLength(2); // the commit itself + exactly one parent
    expect(await repo.isAncestorOfHead(branchHead)).toBe(false);
    expect(await repo.isAncestorOfHead(branchEarly)).toBe(false);
  });

  it('branch head whose measured tree equals HEAD’s → FRESH-by-content, no rev-list count posing as a distance', async () => {
    const v = await repo.check(await repo.artefact({ harnessSha: branchHead }));
    expect(v.verdict, v.out).toBe('FRESH');
    expect(v.exit).toBe(0);
    expect(v.out).toContain('FRESH-by-content');
    expect(v.out).toContain('measuredPathsChanged=0');
    expect(v.out).not.toMatch(COMMITS_BEHIND_AS_DISTANCE);
  });

  it('the same artefact under --allow-stale is still plain FRESH (the flag has nothing to relax)', async () => {
    const v = await repo.check(await repo.artefact({ harnessSha: branchHead }), '--allow-stale');
    expect(v.verdict, v.out).toBe('FRESH');
    expect(v.exit).toBe(0);
  });

  it('an EARLIER branch commit (the harness changed after it) → STALE, naming the path, no distance', async () => {
    const v = await repo.check(await repo.artefact({ harnessSha: branchEarly }));
    expect(v.verdict, v.out).toBe('STALE');
    expect(v.exit).toBe(1);
    expect(v.out).toContain('tests/e2e/follow-819/differentiator-e2e.mjs');
    expect(v.out).not.toMatch(COMMITS_BEHIND_AS_DISTANCE);
  });

  it('the earlier branch commit stays STALE under --allow-stale: a non-ancestor is never relaxed', async () => {
    const v = await repo.check(await repo.artefact({ harnessSha: branchEarly }), '--allow-stale');
    expect(v.verdict, v.out).toBe('STALE');
    expect(v.exit).toBe(1);
  });

  it('content-equal is not a pass for an ABORT artefact', async () => {
    const v = await repo.check(await repo.artefact({ harnessSha: branchHead, aborted: true }));
    expect(v.verdict, v.out).toBe('ABORTED');
    expect(v.exit).toBe(1);
  });

  it('content-equal is not a pass for a DIRTY run, even with --allow-stale', async () => {
    const art = await repo.artefact({
      harnessSha: branchHead,
      harnessTree: { dirty: true, dirtyPaths: ['tests/e2e/follow-819/fixture-listing.html'] },
    });
    const v = await repo.check(art, '--allow-stale');
    expect(v.verdict, v.out).toBe('DIRTY');
    expect(v.exit).toBe(1);
  });

  it('content-equal is not a pass for an artefact with no tree record', async () => {
    const v = await repo.check(await repo.artefact({ harnessSha: branchHead, harnessTree: null }));
    expect(v.verdict, v.out).toBe('STALE');
    expect(v.exit).toBe(1);
  });
});

describe('FOLLOW-1208 — squash topology where main moved product code under the branch', () => {
  it('branch head lacks a product commit main gained before the squash → STALE, naming it', async () => {
    const repo = await newRepo();
    await repo.git('checkout', '-q', '-b', 'feature');
    const branchHead = await repo.commit('feat: route', {
      'apps/control-plane/src/app/api/adapt/route.ts': 'branch\n',
    });
    await repo.git('checkout', '-q', 'main');
    await repo.commit('feat: holdout', { 'packages/shared/src/ab-holdout.ts': 'main\n' });
    await repo.git('merge', '-q', '--squash', 'feature');
    await repo.git('commit', '-q', '-m', 'feat: route (#2)');
    expect(await repo.isAncestorOfHead(branchHead)).toBe(false);

    const v = await repo.check(await repo.artefact({ harnessSha: branchHead }), '--allow-stale');
    expect(v.verdict, v.out).toBe('STALE');
    expect(v.exit).toBe(1);
    expect(v.out).toContain('packages/shared/src/ab-holdout.ts');
    expect(v.out).not.toMatch(COMMITS_BEHIND_AS_DISTANCE);
  });

  it('a harnessSha this clone does not have → STALE, even with --allow-stale', async () => {
    const repo = await newRepo();
    const art = await repo.artefact({ harnessSha: 'f'.repeat(40) });
    const v = await repo.check(art, '--allow-stale');
    expect(v.verdict, v.out).toBe('STALE');
    expect(v.exit).toBe(1);
  });
});
