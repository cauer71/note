import { defineConfig, devices } from '@playwright/test';

// Ports per Umgebung änderbar (z. B. zwei Testläufe parallel in verschiedenen Arbeitskopien)
const PORT = Number(process.env.PW_PORT || 4173);
const API_PORT = Number(process.env.PW_API_PORT || 8788);

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
    baseURL: `http://localhost:${PORT}`,
    ignoreHTTPSErrors: true,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...chromium, viewport: { width: 1280, height: 860 } }, testIgnore: /mobile|api/ },
    { name: 'iphone', use: { ...devices['iPhone 15 Pro'], ...chromium }, testMatch: /mobile|tour\.spec/ },
    { name: 'ipad', use: { ...devices['iPad Pro 11'], ...chromium }, testMatch: /mobile|drawing|tour\.spec/ },
    { name: 'api', use: { ...chromium, baseURL: `http://localhost:${API_PORT}`, viewport: { width: 1280, height: 860 } }, testMatch: /api/ },
  ],
  webServer: [
    { command: 'node scripts/serve.mjs', port: PORT, env: { PORT: String(PORT) }, reuseExistingServer: true },
    {
      command: `rm -rf .wrangler/test-state && npx wrangler d1 execute notizen --local --file schema.sql --persist-to .wrangler/test-state >/dev/null && npx wrangler d1 execute notizen --local --file tests/fixtures/legacy.sql --persist-to .wrangler/test-state >/dev/null && npx wrangler dev --local --port ${API_PORT} --persist-to .wrangler/test-state --var ACCESS_AUD: --var DEV_NO_AUTH:1 --var LEGACY_WORKSPACE:legacy-ws`,
      port: API_PORT,
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
