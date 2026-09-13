import path from 'node:path';

import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  resolve: {
    // FOLLOW-1205: `follow-819/control-plane-probe.test.ts` imports the REAL `POST /api/adapt`
    // handler and the REAL middleware, so their imports must resolve the way the control plane's
    // own vitest config resolves them (`apps/control-plane/vitest.config.ts`). Only additive: no
    // other file under tests/e2e imports these specifiers.
    alias: {
      '@/': `${path.join(repoRoot, 'apps/control-plane/src')}/`,
      '@estalara/auth': path.join(repoRoot, 'packages/auth/src/index.ts'),
      '@estalara/db': path.join(repoRoot, 'packages/db/src/index.ts'),
      '@estalara/shared': path.join(repoRoot, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    testTimeout: 60_000,
    hookTimeout: 30_000,
    reporters: ['verbose'],
    // *.spec.ts added for the demo integration spec (FOLLOW-055)
    include: ['**/*.test.ts', '**/*.spec.ts'],
    environment: 'jsdom',
  },
});
