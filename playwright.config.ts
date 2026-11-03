import { defineConfig, devices } from '@playwright/test';

export const STAFF_URL = 'http://localhost:5173/app/';
export const VOTER_URL = 'http://localhost:5174/';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? 'github' : 'list',
  use: { trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @vote-kidigit/staff dev',
      url: STAFF_URL,
      reuseExistingServer: !isCI,
    },
    {
      command: 'pnpm --filter @vote-kidigit/voter dev',
      url: VOTER_URL,
      reuseExistingServer: !isCI,
    },
  ],
});
