import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Integration test config — runs ONLY `*.integration.test.ts` specs.
 *
 * These specs hit a live ClickHouse instance and self-skip (via
 * `test.skipIf(!process.env.CLICKHOUSE_URL)`) when no instance is configured,
 * so this config is safe to invoke in CI without secrets — it reports the
 * suite as skipped rather than failed.
 *
 * Run with:  pnpm --filter @estalara/control-plane test:integration:clickhouse
 *
 * Kept separate from `vitest.config.ts` so the standard `pnpm test` never
 * touches external services. The standard config explicitly excludes
 * `*.integration.test.ts`.
 *
 * No jsdom / React plugin: integration specs talk to ClickHouse over HTTP via
 * the production `clickhouse-dsr` helpers and need a plain `node` environment.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@estalara/auth': path.resolve(__dirname, '../../packages/auth/src/index.ts'),
      '@estalara/db': path.resolve(__dirname, '../../packages/db/src/index.ts'),
      '@estalara/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // Live mutations on ClickHouse Cloud can take seconds; give specs headroom.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // No coverage thresholds — integration specs are gated on a live instance
    // and skip in CI, so they must not pull down the unit coverage gate.
    coverage: {
      enabled: false,
    },
  },
});
