import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve @estalara/shared from source so Vitest doesn't require a built dist.
      // Added in FOLLOW-179 when upsert-conversion-label.ts introduced the first
      // cross-package import from @estalara/shared into @estalara/db.
      '@estalara/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Use forks pool for process-level isolation (good practice for env manipulation).
    // No longer need singleFork/fileParallelism — test now uses vi.mock() at module level.
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Only measure coverage for implementation files — schema definitions are
      // declarative (Drizzle table builder calls) and seed files require a live DB.
      // The 80% threshold applies to the application logic: client + upsert helper.
      include: ['src/client.ts', 'src/upsert-conversion-label.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
