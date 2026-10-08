import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../..');
export default defineConfig({
  root,
  resolve: {
    alias: {
      '@anthropic-ai/sdk': path.join(
        root,
        'apps/control-plane/node_modules/@anthropic-ai/sdk/index.mjs',
      ),
      '@': path.join(root, 'apps/control-plane/src'),
      '@estalara/auth': path.join(root, 'packages/auth/src/index.ts'),
      '@estalara/db': path.join(root, 'packages/db/src/index.ts'),
      '@estalara/shared/observability': path.join(
        root,
        'packages/shared/src/observability/index.ts',
      ),
      '@estalara/shared': path.join(root, 'packages/shared/src/index.ts'),
      '@estalara/sdk/playbooks': path.join(root, 'packages/sdk/src/core/playbooks/index.ts'),
    },
  },
  test: {
    include: ['docs/audits/revalidation-2026-10-08/probes/*.test.ts'],
    environment: 'node',
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
  },
});
