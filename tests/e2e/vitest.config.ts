import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 30_000,
    reporters: ['verbose'],
    // *.spec.ts added for the demo integration spec (FOLLOW-055)
    include: ['**/*.test.ts', '**/*.spec.ts'],
    environment: 'jsdom',
  },
});
