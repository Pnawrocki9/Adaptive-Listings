import { defineConfig } from 'vitest/config';

/**
 * Integration test config for apps/ingest — runs ONLY `*.integration.test.ts`.
 *
 * These specs hit a live ClickHouse over HTTP. Kept separate from
 * `vitest.config.ts` (whose `include` glob explicitly excludes this suffix) so
 * the standard `pnpm test` never touches an external service and never
 * silently reports these as passing when no engine is present.
 *
 * Run with:
 *   CLICKHOUSE_URL=http://localhost:8123 REQUIRE_CLICKHOUSE=1 \
 *     pnpm --filter @estalara/ingest exec vitest run --config vitest.integration.config.ts
 *
 * The `clickhouse-smoke` CI job invokes exactly that (FOLLOW-853 AC(2)).
 *
 * No coverage thresholds: these specs are gated on a live instance, so counting
 * them would let an absent container quietly drag the unit coverage gate.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // ClickHouse DELETE mutations and container cold-start are slow; give headroom.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      enabled: false,
    },
  },
});
