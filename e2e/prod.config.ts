import { defineConfig, devices } from '@playwright/test';

/** Post-deploy smoke test against production (no test-only auth exists there). */
export default defineConfig({
  testDir: './specs-prod',
  reporter: [['line']],
  use: { baseURL: process.env.PROD_URL ?? 'https://phaseplay.app' },
  projects: [{ name: 'prod-chromium', use: { ...devices['Pixel 7'] } }],
});
