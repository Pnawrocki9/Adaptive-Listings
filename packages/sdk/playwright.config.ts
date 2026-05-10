import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'node e2e/serve.js',
    port: 4444,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
