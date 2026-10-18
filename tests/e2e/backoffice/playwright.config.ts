/**
 * Playwright config for the N2 backoffice smoke (FOLLOW-1343). LOCAL ONLY — no CI job runs it.
 *
 * Runs against an already-running control plane (`scripts/dev/localhost-up.sh`, :3000); it starts
 * nothing. `@playwright/test` is resolved from `packages/sdk` (the owner of the browser matrix), so
 * this file deliberately imports nothing: a plain object is a valid Playwright config.
 *
 * Env: BACKOFFICE_ORIGIN (default http://localhost:3000), N2_REPORT_DIR (JSON report + traces).
 */
const reportDir = process.env.N2_REPORT_DIR ?? 'test-results/backoffice';

export default {
  testDir: '.',
  testMatch: 'admin-smoke.spec.ts',
  // Cold `next dev` compiles each admin route on first hit; 30 s is the per-test ceiling.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1, // RAM: one headless browser at a time on the dev WSL
  retries: 0,
  outputDir: `${reportDir}/artifacts`,
  reporter: [['list'], ['json', { outputFile: `${reportDir}/n2-report.json` }]],
  use: {
    baseURL: process.env.BACKOFFICE_ORIGIN ?? 'http://localhost:3000',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
};
