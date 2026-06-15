import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Integration smoke config — runs live-network specs that hit real production
 * or staging endpoints.
 *
 * These specs self-skip (via REQUIRE_LIVE_INTENT_SMOKE / ESTALARA_SMOKE_API_KEY)
 * when secrets are absent, so the config is safe to invoke without secrets —
 * the suite reports "skipped" rather than failed.
 *
 * Run locally with secrets injected via Doppler:
 *   doppler run --config prd -- pnpm --filter @estalara/integration-smoke test
 *
 * Kept separate from unit + ClickHouse integration configs so standard
 * `pnpm test` never touches live production endpoints.
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
    include: ['**/*.smoke.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    coverage: {
      enabled: false,
    },
  },
});
