import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Point workspace packages at their source during tests (no dist build needed)
      '@estalara/auth': path.resolve(__dirname, '../../packages/auth/src/index.ts'),
      '@estalara/db': path.resolve(__dirname, '../../packages/db/src/index.ts'),
      '@estalara/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@estalara/sdk/playbooks': path.resolve(
        __dirname,
        '../../packages/sdk/src/core/playbooks/index.ts',
      ),
      '@estalara/sdk/auto-detect': path.resolve(
        __dirname,
        '../../packages/sdk/src/auto-detect/pipeline.ts',
      ),
      '@estalara/sdk/auto-detect/ai-vision': path.resolve(
        __dirname,
        '../../packages/sdk/src/auto-detect/techniques/ai-vision.ts',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
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
