import { expect, test } from '@playwright/test';
import { STAFF_URL, VOTER_URL } from '../playwright.config';

test('staff portal loads at /app/', async ({ page }) => {
  await page.goto(STAFF_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Vote-Kidigit' })).toBeVisible();
});

test('voter app loads at /', async ({ page }) => {
  await page.goto(VOTER_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Vote-Kidigit' })).toBeVisible();
});
