import { defineConfig, devices } from '@playwright/test';

const chromium = { browserName: 'chromium', launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined } };

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    ignoreHTTPSErrors: true,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...chromium, viewport: { width: 1280, height: 860 } }, testIgnore: /mobile|api/ },
    { name: 'iphone', use: { ...devices['iPhone 15 Pro'], ...chromium }, testMatch: /mobile/ },
    { name: 'ipad', use: { ...devices['iPad Pro 11'], ...chromium }, testMatch: /mobile|drawing/ },
    { name: 'api', use: { ...chromium, baseURL: 'http://localhost:8788', viewport: { width: 1280, height: 860 } }, testMatch: /api/ },
  ],
  webServer: [
    { command: 'node scripts/serve.mjs', port: 4173, reuseExistingServer: true },
    {
      command: 'rm -rf .wrangler/test-state && npx wrangler d1 execute notizen --local --file schema.sql --persist-to .wrangler/test-state >/dev/null && npx wrangler dev --local --port 8788 --persist-to .wrangler/test-state --var ACCESS_AUD: --var DEV_NO_AUTH:1',
      port: 8788,
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
