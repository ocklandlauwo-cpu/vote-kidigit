import { expect, test } from '@playwright/test';
import { STAFF_URL, VOTER_URL } from '../playwright.config';

test('staff portal shows the sign-in screen at /app/login', async ({ page }) => {
  await page.goto(`${STAFF_URL}login`);
  // No API runs in this smoke test: the session check fails (with its retries) and the
  // signed-out sign-in screen (AUTH-01, Swahili by default) appears.
  await expect(page.getByRole('heading', { level: 1, name: 'Ingia' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByLabel('Barua pepe')).toBeVisible();
});

test('public website loads at /', async ({ page }) => {
  await page.goto(VOTER_URL);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Uchaguzi wa siri, matokeo ya uhakika' }),
  ).toBeVisible();
});
