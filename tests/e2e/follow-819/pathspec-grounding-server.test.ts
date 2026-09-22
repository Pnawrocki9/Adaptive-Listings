// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason harness-preflight.test.ts pins this)

/**
 * FOLLOW-1244 / RETRO-339 — `HARNESS_TREE_PATHSPEC` (FOLLOW-1208) claims to list "every tracked
 * path whose bytes a run executes, or that decides which bytes run", but `harness-preflight.test.ts`
 * only proves this for files the harness process itself `import()`s or opens via `new URL(...,
 * import.meta.url)`. `scripts/dev/fixture-listing-details-server.mjs` (added by #917) is never
 * imported — README §3.3b starts it as a SEPARATE `node` process — yet its `extractFixtureFacts()`
 * decides which facts enter the LLM prompt. Before this fix, editing that file locally left
 * `git status --porcelain` over the pathspec empty, so a run graded `[FRESH] … clean tree` while
 * grounded on facts the fixture page never published — the injection CEO ruling #1 (tamper-evidence
 * BEFORE the harness, 2026-09-13) exists to catch (ESC-076 / MASTER_DESIGN §E.7.0).
 *
 * Two independent checks, both driving REAL exported harness functions/data (never a hand-typed
 * stand-in for what they should return):
 *
 * 1. A real-git test in the FOLLOW-1208 fixture style (`harness-preflight.test.ts`'s "uncommitted
 *    edit → dirty=" rows): an uncommitted edit to the grounding server in a real temp git
 *    repository, read back through the REAL `readHarnessTreeState()` and the REAL
 *    `evaluateArtefactStaleness()`. Before this ticket's fix the edit was invisible
 *    (`dirty: false` → verdict `FRESH`) — RED. After adding the path to `HARNESS_TREE_PATHSPEC` the
 *    same edit reads `dirty: true` → verdict `DIRTY` — GREEN. No git fact here is typed in.
 * 2. A parity test that parses `tests/e2e/follow-819/README.md` §3 for every `node <path>` /
 *    `npx serve <path>` line — the commands the runbook tells the operator to START — and asserts
 *    each extracted path is covered by the REAL `HARNESS_TREE_PATHSPEC`. Guarded against passing
 *    vacuously (a broken parser finding nothing) by first asserting it found the three starts known
 *    at authoring time. This is how `scripts/dev/mock-decision-server.mjs` (FOLLOW-1216 — the mock
 *    `:9100` static host, also never `import()`ed) was found missing and added alongside the
 *    grounding server.
 *
 * Collected by `tests/e2e/vitest.config.ts` (`**\/*.test.ts`); run by `pnpm e2e:smoke`, which
 * `.github/workflows/e2e-smoke.yml` executes nightly (cron) and on `workflow_dispatch` — the same
 * job `harness-preflight.test.ts` already runs under. No flag gates this file; it needs no
 * substrate.
 *
 * @module tests/e2e/follow-819/pathspec-grounding-server.test
 */

import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);

const README_PATH = new URL('./README.md', import.meta.url);

interface Tree {
  dirty: boolean | null;
  dirtyPaths: string[] | null;
}
type ReadHarnessTreeState = (options?: { cwd?: string }) => Promise<Tree>;
type EvaluateArtefactStaleness = (
  facts: Record<string, unknown>,
  options?: { allowStale?: boolean },
) => { verdict: string };

let HARNESS_TREE_PATHSPEC: readonly string[];
let readHarnessTreeState: ReadHarnessTreeState;
let evaluateArtefactStaleness: EvaluateArtefactStaleness;

beforeAll(async () => {
  // The harness runs main() at import unless told not to — see the guard at its foot.
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as {
    HARNESS_TREE_PATHSPEC: readonly string[];
    readHarnessTreeState: ReadHarnessTreeState;
    evaluateArtefactStaleness: EvaluateArtefactStaleness;
  };
  HARNESS_TREE_PATHSPEC = mod.HARNESS_TREE_PATHSPEC;
  readHarnessTreeState = mod.readHarnessTreeState;
  evaluateArtefactStaleness = mod.evaluateArtefactStaleness;
});

const GROUNDING_SERVER = 'scripts/dev/fixture-listing-details-server.mjs';

describe('FOLLOW-1244 — the grounding stand-in server is inside HARNESS_TREE_PATHSPEC', () => {
  it('HARNESS_TREE_PATHSPEC lists it', () => {
    expect(HARNESS_TREE_PATHSPEC).toContain(GROUNDING_SERVER);
  });

  it(
    'real temp repo, real git: an uncommitted edit to the grounding server is caught by ' +
      'readHarnessTreeState + evaluateArtefactStaleness — RETRO-339’s "clean tree" defect',
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'follow-1244-'));
      const env: NodeJS.ProcessEnv = { ...process.env };
      const git = async (...args: string[]) =>
        execFileP('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, env });

      try {
        await git('init', '-q', '-b', 'main');
        await git('config', 'user.email', 'follow-1244@example.invalid');
        await git('config', 'user.name', 'follow-1244');

        const serverFile = path.join(dir, GROUNDING_SERVER);
        await mkdir(path.dirname(serverFile), { recursive: true });
        await writeFile(serverFile, 'export function extractFixtureFacts() { return {}; }\n');
        await git('add', '-A');
        await git('commit', '-q', '-m', 'base');
        const runSha = (await git('rev-parse', 'HEAD')).stdout.trim();

        // The tamper RETRO-339 describes: a LOCAL, UNCOMMITTED edit to the file that decides
        // what grounds the prompt — never committed, so only the run-start tree recorder sees it.
        await appendFile(serverFile, '// tampered: hand-write a price the page never shows\n');

        const tree = await readHarnessTreeState({ cwd: dir });
        const verdict = evaluateArtefactStaleness({
          harnessSha: runSha,
          isAncestorOfHead: true,
          commitsBehind: 0,
          measuredPaths: { changed: false, changedPaths: [] },
          aborted: false,
          harnessTree: tree,
        });

        expect(tree.dirty, JSON.stringify(tree)).toBe(true);
        expect(tree.dirtyPaths ?? []).toEqual([GROUNDING_SERVER]);
        expect(verdict.verdict).toBe('DIRTY');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});

/**
 * Extracts every `node <path>` and `npx serve <path>` command from a markdown section — the forms
 * `tests/e2e/follow-819/README.md` §3 uses to tell the operator what to START. `npx serve`'s only
 * flag in §3 is `-l <port>`; that pair is dropped so the directory argument survives.
 */
function parseRunbookStarts(markdown: string): { nodeStarts: string[]; serveStarts: string[] } {
  const codeBlocks = [...markdown.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const nodeStarts: string[] = [];
  const serveStarts: string[] = [];
  for (const block of codeBlocks) {
    for (const line of block.split('\n')) {
      const nodeMatch = /\bnode\s+([^\s#]+\.(?:mjs|js|cjs|ts))\b/.exec(line);
      if (nodeMatch) nodeStarts.push(nodeMatch[1]);

      const serveMatch = /\bnpx\s+serve\b(.*)$/.exec(line);
      if (serveMatch) {
        const rest = serveMatch[1].split('#')[0].trim();
        const tokens = rest.split(/\s+/).filter(Boolean);
        const pathTokens: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
          const t = tokens[i];
          if (t.startsWith('-')) {
            if (i + 1 < tokens.length && /^[\d,]+$/.test(tokens[i + 1])) i++; // e.g. `-l 5173`
            continue;
          }
          pathTokens.push(t);
        }
        if (pathTokens.length > 0) serveStarts.push(pathTokens[0]);
      }
    }
  }
  return { nodeStarts, serveStarts };
}

/** `target` is covered when it, a parent directory of it, or a child of it is a pathspec entry. */
function isCovered(target: string, pathspec: readonly string[]): boolean {
  const includes = pathspec.filter((p) => !p.startsWith(':('));
  return includes.some(
    (inc) => inc === target || target.startsWith(`${inc}/`) || inc.startsWith(`${target}/`),
  );
}

describe('FOLLOW-1244 — README §3 "START" commands are all covered by HARNESS_TREE_PATHSPEC', () => {
  let section3: string;

  beforeAll(async () => {
    const readme = await readFile(README_PATH, 'utf8');
    const start = readme.indexOf('## 3. MANUAL runbook');
    if (start === -1) throw new Error('README §3 heading not found — has it been renamed?');
    const end = readme.indexOf('\n## 4. ', start);
    section3 = readme.slice(start, end === -1 ? undefined : end);
  });

  it('the parser is not vacuous: it finds the known §3 starts', () => {
    const { nodeStarts, serveStarts } = parseRunbookStarts(section3);
    expect(nodeStarts).toEqual(
      expect.arrayContaining([
        'scripts/dev/mock-decision-server.mjs', // §3.3, FOLLOW-1216
        GROUNDING_SERVER, // §3.3b, FOLLOW-1244
        'tests/e2e/follow-819/differentiator-e2e.mjs', // §3.6
      ]),
    );
    expect(serveStarts).toEqual(expect.arrayContaining(['tests/e2e/follow-819'])); // §3.3
  });

  it('every extracted start path is covered', () => {
    const { nodeStarts, serveStarts } = parseRunbookStarts(section3);
    const all = [...new Set([...nodeStarts, ...serveStarts])];
    const uncovered = all.filter((p) => !isCovered(p, HARNESS_TREE_PATHSPEC));
    expect(uncovered, `uncovered §3 starts: ${JSON.stringify(uncovered)}`).toEqual([]);
  });
});
