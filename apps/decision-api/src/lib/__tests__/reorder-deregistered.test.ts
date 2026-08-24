/**
 * Proof mechanism for FOLLOW-1073's decision (b): `reorder.ts` is dead code
 * and is deliberately NOT registered as a Rule J mirror pair against
 * `apps/control-plane/src/app/api/adapt/route.ts` anymore.
 *
 * This does not depend on `scripts/check-mirror-files.sh` (old-buggy or
 * FOLLOW-1070-fixed) — it is a direct, TS-level check of the two facts that
 * justify de-registration, and it fails the moment either stops being true:
 *
 *   1. No non-test file under `apps/decision-api/src/` imports from
 *      `lib/reorder` — i.e. the decision-api Worker still has no live path
 *      that calls `buildReorderDirective()`/`affinityScore()`.
 *   2. `scripts/mirror-files.json` still does not register `reorder.ts` as a
 *      mirror of anything.
 *
 * If (1) or (2) ever flips — someone wires `reorder.ts` into a live route, or
 * re-adds it to the manifest — this test goes red, forcing a conscious
 * decision about the signature divergence recorded in this file's own
 * docblock, instead of the silent drift RETRO-298 found.
 *
 * @module apps/decision-api/src/lib/__tests__/reorder-deregistered.test
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const DECISION_API_SRC = path.resolve(REPO_ROOT, 'apps/decision-api/src');

/** Recursively list every `.ts` file under a directory, skipping `__tests__`. */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('reorder.ts — de-registered dead code (FOLLOW-1073)', () => {
  it('has no non-test importer anywhere under apps/decision-api/src', () => {
    const importers = listSourceFiles(DECISION_API_SRC)
      .filter((f) => path.basename(f) !== 'reorder.ts')
      .filter((f) => /from\s+['"][^'"]*\/reorder(\.js)?['"]/.test(readFileSync(f, 'utf8')));

    expect(importers).toEqual([]);
  });

  it('is not registered as a mirror pair in scripts/mirror-files.json', () => {
    const manifest = JSON.parse(
      readFileSync(path.resolve(REPO_ROOT, 'scripts/mirror-files.json'), 'utf8'),
    ) as { canonical: string; mirror: string }[];

    const reorderPairs = manifest.filter(
      (pair) => pair.canonical.includes('reorder.ts') || pair.mirror.includes('reorder.ts'),
    );

    expect(reorderPairs).toEqual([]);
  });
});
