import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // FOLLOW-853: `*.integration.test.ts` needs a live ClickHouse and runs under
    // `vitest.integration.config.ts` in the `clickhouse-smoke` CI job. Without this
    // exclusion the offline unit run would collect it and fail (or, worse, pass by
    // skipping) — the unit gate must never depend on an external service.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.integration.test.ts'],
    server: {
      deps: {
        // FOLLOW-513: `@microlabs/otel-cf-workers` is imported by `src/index.ts` (the real Worker
        // default export) and itself imports the `cloudflare:workers` built-in module — only
        // available inside the actual Workers runtime. Left externalized (vitest's default for
        // node_modules deps), that nested import bypasses vite-node's module graph entirely, so
        // `index-queue-sentry.test.ts`'s `vi.mock('cloudflare:workers', ...)` (needed to import
        // the real `index.ts` default export at all) would never take effect. Inlining just this
        // one dependency routes it through vite-node, where the mock IS honored.
        inline: [/@microlabs\/otel-cf-workers/],
      },
    },
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
