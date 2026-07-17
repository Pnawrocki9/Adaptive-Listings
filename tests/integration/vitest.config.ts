import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Integration config — runs both (a) live-network smoke specs that hit real
 * production or staging endpoints (`*.smoke.test.ts`) and (b) offline
 * cross-package parity/drift specs that need no secrets and always run
 * (`*.test.ts`, e.g. `archetype-id-parity.test.ts`, FOLLOW-561).
 *
 * The live-network specs self-skip (via REQUIRE_LIVE_INTENT_SMOKE /
 * ESTALARA_SMOKE_API_KEY) when secrets are absent, so the config is safe to
 * invoke without secrets — those suites report "skipped" rather than failed.
 * The offline parity specs have no such gate and run unconditionally.
 *
 * Run locally with secrets injected via Doppler (only needed for the live specs):
 *   doppler run --config prd -- pnpm --filter @estalara/integration-smoke test
 *
 * Kept separate from unit + ClickHouse integration configs so standard
 * `pnpm test` never touches live production endpoints outside the smoke specs'
 * own skip-gate.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@estalara/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    coverage: {
      enabled: false,
    },
  },
});
