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
}
interface BuildVerdict {
  ok: boolean;
  verdict: 'FRESH-BUILD' | 'STALE-BUILD';
  stale: string[];
  reason: string;
}
interface Facts { packages: PkgFacts[]; served?: ServedFacts | null }

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
