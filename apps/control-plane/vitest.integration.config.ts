import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Integration test config — runs ONLY `*.integration.test.ts` specs.
 *
 * These specs hit a live external service and self-skip (via `test.skipIf` on
 * the credential that service needs — `CLICKHOUSE_URL`, or `ANTHROPIC_API_KEY`
 * for the FOLLOW-1173 judge-rate spec) when it is not configured, so this
 * config is safe to invoke in CI without secrets: it reports the suite as
 * skipped rather than failed. A spec added here MUST self-skip the same way.
 *
 * Run with:  pnpm --filter @estalara/control-plane test:integration:clickhouse
 *            doppler run -c dev -- pnpm --filter @estalara/control-plane test:integration:judge-rate
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
      // FOLLOW-1173: the judge-rate spec reads the REAL playbook, never a fixture.
      '@estalara/sdk/playbooks': path.resolve(
        __dirname,
        '../../packages/sdk/src/core/playbooks/index.ts',
      ),
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
