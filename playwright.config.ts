import { defineConfig, devices } from '@playwright/test';

export const STAFF_URL = 'http://localhost:5173/app/';
export const VOTER_URL = 'http://localhost:5174/';
export const API_HEALTH_URL = 'http://localhost:3000/api/health';

const isCI = Boolean(process.env.CI);
/** End-to-end runs never send a real SMS, whatever apps/api/.env says. */
const FAKE_SMS = { SMS_DRIVER: 'fake' };

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
      // The built API (pnpm build runs first in CI); locally a running `pnpm dev` is reused.
      command: 'pnpm --filter @vote-kidigit/api start',
      url: API_HEALTH_URL,
      reuseExistingServer: !isCI,
      env: FAKE_SMS,
    },
    {
      // The worker (CSV imports, code SMS, PDFs). It has no port: ready when it says so.
      command: 'pnpm --filter @vote-kidigit/api start:worker',
      wait: { stdout: /worker started/ },
      env: { ...FAKE_SMS, PROCESS_ROLE: 'worker' },
    },
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
