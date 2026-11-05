/**
 * @vitest-environment node
 *
 * R15, R19, R23 (FOLLOW-1316): the gate on who may read the buyer profile. Analytics, lead ranking,
 * agent summaries and admin must not, so the importers are an allow-list derived from the source on
 * every run. It runs in the control-plane test job, so it needs no required-check entry of its own.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/** Modules a production file may reach the store through, and who may import each. */
const ALLOWED: Record<string, readonly string[]> = {
  'buyer-profile-store': [
    'app/api/adapt/route.ts',
    // FOLLOW-1308 (R32): DSR access/portability read the profile named by an xid header or body.
    'app/api/dsr/_capability.ts',
    'app/api/dsr/erase/route.ts',
    'lib/buyer-profile-route.ts',
  ],
  'buyer-profile-route': [
    'app/api/profile/access/route.ts',
    'app/api/profile/erase/route.ts',
    'app/api/profile/portability/route.ts',
  ],
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Files whose import, `export from` or dynamic `import()` names the module. */
function importersOf(moduleName: string): string[] {
  const pattern = new RegExp(
    `(from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)['"][^'"]*/${moduleName}(\\.js)?['"]`,
  );
  return sourceFiles(SRC)
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC, file))
    .sort();
}

describe('buyer profile store importers', () => {
  it.each(Object.entries(ALLOWED))(
    '%s is imported by the allow-list and nothing else',
    (name, allowed) => {
      expect(importersOf(name)).toEqual([...allowed].sort());
    },
  );

  it('the pattern is live: it finds a known importer of a known module', () => {
    expect(importersOf('after-response')).toContain('app/api/adapt/route.ts');
  });

  it('no package outside the control plane reaches the store', () => {
    const root = join(SRC, '../../..');
    for (const dir of [
      'packages/shared/src',
      'packages/db/src',
      'packages/auth/src',
      'apps/ingest/src',
    ]) {
      for (const file of sourceFiles(join(root, dir))) {
        expect(readFileSync(file, 'utf8'), file).not.toMatch(/buyer_profile:|buyer-profile-store/);
      }
    }
  });

  it('R23: the store reads no other store, so a profile cannot be rebuilt from one', () => {
    const source = readFileSync(join(SRC, 'lib/buyer-profile-store.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual([
      '@/lib/after-response',
      '@estalara/shared',
      '@sentry/nextjs',
      'node:crypto',
      'zod',
    ]);
  });
});
