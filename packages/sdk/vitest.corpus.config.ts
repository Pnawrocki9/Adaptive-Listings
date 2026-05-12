import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/auto-detect/__tests__/corpus.test.ts'],
    environment: 'node',
    reporters: ['verbose', ['json', { outputFile: 'corpus-report.json' }]],
  },
});
