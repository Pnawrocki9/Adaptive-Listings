import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Resolve workspace packages from source so Vitest doesn't require built dists.
      '@estalara/auth': path.resolve(__dirname, '../../packages/auth/src/index.ts'),
      '@estalara/db': path.resolve(__dirname, '../../packages/db/src/index.ts'),
      '@estalara/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      // SDK sub-path exports — mapped to source so tests don't need a built dist.
      // More-specific aliases first (Vite alias is first-match).
      '@estalara/sdk/auto-detect/ai-vision': path.resolve(
        __dirname,
        '../../packages/sdk/src/auto-detect/techniques/ai-vision.ts',
      ),
      '@estalara/sdk/auto-detect': path.resolve(
        __dirname,
        '../../packages/sdk/src/auto-detect/pipeline.ts',
      ),
      '@estalara/sdk/playbooks': path.resolve(
        __dirname,
        '../../packages/sdk/src/core/playbooks/index.ts',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // FOLLOW-450 AC2: scripts/**/*.test.ts covers pure helper functions in
    // operator scripts (e.g. scripts/feedback-canary.mts) that CI cannot run
    // end-to-end (they need live prod credentials + a live deployment).
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    // Integration tests (*.integration.test.ts) hit live external services
    // (ClickHouse) and are run via the dedicated vitest.integration.config.ts.
    // Never let the standard suite pick them up.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
