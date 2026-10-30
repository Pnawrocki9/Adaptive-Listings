// @vitest-environment node

/**
 * FOLLOW-1246 — the harness must not report a run as a result of HEAD when the control plane loads
 * a `dist` older than its `src` (or, in CP_MODE=prod, a `.next` build older than HEAD's last
 * relevant commit).
 *
 * Drives the REAL `evaluateBuildFreshness()` / `readBuildFreshnessFacts()` / the build axis of
 * `evaluateArtefactStaleness()` out of `differentiator-e2e.mjs`. The reader runs against a throwaway
 * git repository where `apps/control-plane/node_modules/@estalara/*` is a SYMLINK into another
 * checkout (the README 6.9 worktree shape), so the symlink-safe resolution is exercised, not typed in.
 *
 * Red-first: before FOLLOW-1246 none of these exports existed and a stale dist read `[FRESH]`.
 *
 * @module tests/e2e/follow-819/build-freshness.test
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);

interface PkgFacts {
  name: string;
  distMtimeMs: number | null;
  srcCommitMs: number | null;
}
interface ServedFacts {
  mode: string | null;
  buildIdMtimeMs: number | null;
  sourceCommitMs: number | null;
  buildSha?: string | null;
  changedSinceBuild?: boolean | null;
}
interface BuildVerdict {
  ok: boolean;
  verdict: 'FRESH-BUILD' | 'STALE-BUILD';
  stale: string[];
  reason: string;
}
interface Facts {
  packages: PkgFacts[];
  served?: ServedFacts | null;
}

let evaluateBuildFreshness: (facts: Facts) => BuildVerdict;
let readBuildFreshnessFacts: (o?: { repoRoot?: string; cpMode?: string }) => Promise<Facts>;
let evaluateArtefactStaleness: (
  facts: Record<string, unknown>,
  o?: { allowStale?: boolean },
) => { ok: boolean; verdict: string; reason: string };

beforeAll(async () => {
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as unknown as {
    evaluateBuildFreshness: typeof evaluateBuildFreshness;
    readBuildFreshnessFacts: typeof readBuildFreshnessFacts;
    evaluateArtefactStaleness: typeof evaluateArtefactStaleness;
  };
  evaluateBuildFreshness = mod.evaluateBuildFreshness;
  readBuildFreshnessFacts = mod.readBuildFreshnessFacts;
  evaluateArtefactStaleness = mod.evaluateArtefactStaleness;
});

const T0 = Date.UTC(2026, 9, 1);
const pkgs = (over: Partial<Record<string, Partial<PkgFacts>>> = {}): PkgFacts[] =>
  ['db', 'auth', 'shared'].map((name) => ({
    name,
    distMtimeMs: T0 + 1000,
    srcCommitMs: T0,
    ...over[name],
  }));

describe('evaluateBuildFreshness — the pure predicate', () => {
  it('every dist newer than its src → FRESH-BUILD', () => {
    expect(evaluateBuildFreshness({ packages: pkgs() })).toMatchObject({
      ok: true,
      verdict: 'FRESH-BUILD',
    });
  });

  it('a dist older than the last commit touching its src → STALE-BUILD naming the package', () => {
    const v = evaluateBuildFreshness({ packages: pkgs({ db: { distMtimeMs: T0 - 1000 } }) });
    expect(v.ok).toBe(false);
    expect(v.verdict).toBe('STALE-BUILD');
    expect(v.stale).toHaveLength(1);
    expect(v.stale[0]).toContain('@estalara/db');
  });

  it('a missing dist, or an unreadable commit time, is stale — never a silent pass', () => {
    expect(evaluateBuildFreshness({ packages: pkgs({ auth: { distMtimeMs: null } }) }).ok).toBe(
      false,
    );
    expect(evaluateBuildFreshness({ packages: pkgs({ shared: { srcCommitMs: null } }) }).ok).toBe(
      false,
    );
  });

  it("prod mode: a .next/BUILD_ID older than HEAD's last relevant commit is stale", () => {
    const served = { mode: 'prod', buildIdMtimeMs: T0 - 5, sourceCommitMs: T0 };
    const v = evaluateBuildFreshness({ packages: pkgs(), served });
    expect(v.ok).toBe(false);
    expect(v.stale.join(' ')).toContain('BUILD_ID');
    expect(
      evaluateBuildFreshness({ packages: pkgs(), served: { ...served, buildIdMtimeMs: T0 + 5 } })
        .ok,
    ).toBe(true);
    expect(
      evaluateBuildFreshness({ packages: pkgs(), served: { ...served, buildIdMtimeMs: null } }).ok,
    ).toBe(false);
  });

  describe('served build identity (ESTALARA_BUILD_SHA)', () => {
    const served = (o: Partial<ServedFacts>): ServedFacts => ({
      mode: 'prod',
      buildIdMtimeMs: T0 + 5,
      sourceCommitMs: T0,
      ...o,
    });
    const sha = 'a'.repeat(40);
    it('no sha file is stale; a sha whose build inputs changed (or are unknowable) is stale', () => {
      expect(
        evaluateBuildFreshness({ packages: pkgs(), served: served({ buildSha: null }) }).ok,
      ).toBe(false);
      for (const changedSinceBuild of [true, null]) {
        const v = evaluateBuildFreshness({
          packages: pkgs(),
          served: served({ buildSha: sha, changedSinceBuild }),
        });
        expect(v.ok).toBe(false);
        expect(v.reason).toContain(sha);
      }
    });
    it('a sha with unchanged build inputs passes; an unread sha (undefined) is not graded', () => {
      expect(
        evaluateBuildFreshness({
          packages: pkgs(),
          served: served({ buildSha: sha, changedSinceBuild: false }),
        }).ok,
      ).toBe(true);
      expect(evaluateBuildFreshness({ packages: pkgs(), served: served({}) }).ok).toBe(true);
    });
  });

  it('dev mode does not grade BUILD_ID', () => {
    const served = { mode: 'dev', buildIdMtimeMs: null, sourceCommitMs: T0 };
    expect(evaluateBuildFreshness({ packages: pkgs(), served }).ok).toBe(true);
  });
});

describe('evaluateArtefactStaleness — the build axis', () => {
  const base = {
    harnessSha: 'abc',
    isAncestorOfHead: true,
    commitsBehind: 0,
    measuredPaths: { changed: false, changedPaths: [] },
    harnessTree: { dirty: false, dirtyPaths: [] },
  };

  it('an artefact recording a stale build reads STALE-BUILD even on a clean tree at HEAD', () => {
    const stale = evaluateBuildFreshness({ packages: pkgs({ db: { distMtimeMs: T0 - 1 } }) });
    const v = evaluateArtefactStaleness({ ...base, buildFreshness: stale });
    expect(v.ok).toBe(false);
    expect(v.verdict).toBe('STALE-BUILD');
  });

  it('a fresh build record, and an artefact written before FOLLOW-1246, still read FRESH', () => {
    const fresh = evaluateBuildFreshness({ packages: pkgs() });
    expect(evaluateArtefactStaleness({ ...base, buildFreshness: fresh }).verdict).toBe('FRESH');
    expect(evaluateArtefactStaleness(base).verdict).toBe('FRESH');
  });
});

describe('readBuildFreshnessFacts — real files, real git, a symlinked package', () => {
  let main: string;
  let wt: string;

  const git = (cwd: string, date: string, ...args: string[]) =>
    execFileP('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: cwd,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    });

  const setDist = async (name: string, when: Date) => {
    const dist = path.join(main, 'packages', name, 'dist');
    await mkdir(dist, { recursive: true });
    const f = path.join(dist, 'index.js');
    await writeFile(f, 'x');
    await utimes(f, when, when);
  };

  beforeAll(async () => {
    main = await mkdtemp(path.join(tmpdir(), 'follow-1246-main-'));
    wt = await mkdtemp(path.join(tmpdir(), 'follow-1246-wt-'));
    await git(main, '2026-10-01T00:00:00Z', 'init', '-q', '-b', 'main');
    for (const n of ['db', 'auth', 'shared']) {
      await mkdir(path.join(main, 'packages', n, 'src'), { recursive: true });
      await writeFile(path.join(main, 'packages', n, 'src', 'index.ts'), 'export {};\n');
      // The worktree's control plane resolves the package to the MAIN checkout (README 6.9).
      await mkdir(path.join(wt, 'apps/control-plane/node_modules/@estalara'), { recursive: true });
      await symlink(
        path.join(main, 'packages', n),
        path.join(wt, 'apps/control-plane/node_modules/@estalara', n),
      );
    }
    await git(main, '2026-10-01T00:00:00Z', 'add', '-A');
    await git(main, '2026-10-01T00:00:00Z', 'commit', '-q', '-m', 'base');
  });

  afterAll(async () => {
    await rm(main, { recursive: true, force: true });
    await rm(wt, { recursive: true, force: true });
  });

  it('dist older than the src commit → refused; after a (simulated) build → passes', async () => {
    const old = new Date('2026-07-28T00:00:00Z');
    for (const n of ['db', 'auth', 'shared']) await setDist(n, old);
    const before = evaluateBuildFreshness(await readBuildFreshnessFacts({ repoRoot: wt }));
    expect(before.ok).toBe(false);
    expect(before.stale).toHaveLength(3);

    const built = new Date('2026-10-02T00:00:00Z');
    for (const n of ['db', 'auth', 'shared']) await setDist(n, built);
    const after = evaluateBuildFreshness(await readBuildFreshnessFacts({ repoRoot: wt }));
    expect(after).toMatchObject({ ok: true, verdict: 'FRESH-BUILD' });
  });

  it('a new commit touching only one src makes only that package stale (resolved through the link)', async () => {
    await writeFile(path.join(main, 'packages/auth/src/index.ts'), 'export const a = 1;\n');
    await git(main, '2026-10-03T00:00:00Z', 'add', '-A');
    await git(main, '2026-10-03T00:00:00Z', 'commit', '-q', '-m', 'auth change');
    const v = evaluateBuildFreshness(await readBuildFreshnessFacts({ repoRoot: wt }));
    expect(v.ok).toBe(false);
    expect(v.stale).toHaveLength(1);
    expect(v.stale[0]).toContain('@estalara/auth');
  });

  it('an incremental build that rewrites only a nested dist file is fresh (scan is recursive)', async () => {
    // After #1103 `tsc` rewrote only dist/playbooks/traits.js; dist/index.js kept its old mtime.
    const nested = path.join(main, 'packages/auth/dist/playbooks');
    await mkdir(nested, { recursive: true });
    const f = path.join(nested, 'traits.js');
    await writeFile(f, 'x');
    const built = new Date('2026-10-04T00:00:00Z');
    await utimes(f, built, built);
    // `tsc` rewrites the file in place, so the directory keeps its old mtime too.
    const old = new Date('2026-07-28T00:00:00Z');
    await utimes(nested, old, old);
    const v = evaluateBuildFreshness(await readBuildFreshnessFacts({ repoRoot: wt }));
    expect(v).toMatchObject({ ok: true, verdict: 'FRESH-BUILD' });
  });

  it('a link that does not resolve is stale, not a crash', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'follow-1246-empty-'));
    try {
      const v = evaluateBuildFreshness(await readBuildFreshnessFacts({ repoRoot: empty }));
      expect(v.ok).toBe(false);
      expect(v.stale).toHaveLength(3);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('readBuildFreshnessFacts - CP_MODE=prod reads .next/ESTALARA_BUILD_SHA against HEAD', () => {
  let repo: string;
  const run = (...args: string[]) =>
    execFileP('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: repo,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: repo,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    }).then((r) => r.stdout.trim());

  beforeAll(async () => {
    repo = await mkdtemp(path.join(tmpdir(), 'follow-1246-prod-'));
    await run('init', '-q', '-b', 'main');
    await mkdir(path.join(repo, 'apps/control-plane/.next'), { recursive: true });
    await writeFile(path.join(repo, 'apps/control-plane/page.ts'), 'v1\n');
    await writeFile(path.join(repo, 'README.md'), 'v1\n');
    await run('add', '-A');
    await run('commit', '-q', '-m', 'base');
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  const served = async () =>
    (await readBuildFreshnessFacts({ repoRoot: repo, cpMode: 'prod' })).served!;

  it('no sha file gives buildSha null (stale)', async () => {
    expect((await served()).buildSha).toBeNull();
  });

  it('sha = HEAD unchanged; a docs-only commit after it still unchanged; a control-plane commit changed', async () => {
    const built = await run('rev-parse', 'HEAD');
    await writeFile(path.join(repo, 'apps/control-plane/.next/ESTALARA_BUILD_SHA'), `${built}\n`);
    expect(await served()).toMatchObject({ buildSha: built, changedSinceBuild: false });

    await writeFile(path.join(repo, 'README.md'), 'v2\n');
    await run('commit', '-q', '-am', 'docs');
    expect(await served()).toMatchObject({ buildSha: built, changedSinceBuild: false });

    await writeFile(path.join(repo, 'apps/control-plane/page.ts'), 'v2\n');
    await run('commit', '-q', '-am', 'cp');
    const s = await served();
    expect(s).toMatchObject({ buildSha: built, changedSinceBuild: true });
    expect(evaluateBuildFreshness({ packages: [], served: s }).ok).toBe(false);
  });

  it('a sha the repository does not know is unknown (null), stale', async () => {
    await writeFile(path.join(repo, 'apps/control-plane/.next/ESTALARA_BUILD_SHA'), 'b'.repeat(40));
    expect((await served()).changedSinceBuild).toBeNull();
  });
});
