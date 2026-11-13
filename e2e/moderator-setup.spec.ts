// Suite 1 (Implementation Plan step 30): a moderator creates an event, adds a category and its
// contesters, imports voters from a CSV file, publishes with "Open now" and "Send codes now", and
// the worker sends every code (fake SMS adapter).
import { expect, test } from '@playwright/test';
import { STAFF_URL } from '../playwright.config';
import { pickerText, seed, signIn, staffOf } from './support';

const DAY = 86_400_000;

function votersCsv(tag: string): Buffer {
  const rows = ['full_name,membership_id,phone,gender,email,photo_file,categories'];
  for (let i = 1; i <= 3; i += 1) {
    rows.push(`Mwanachama ${i},${tag}-${i},073000000${i},${i % 2 ? 'Female' : 'Male'},,,`);
  }
  return Buffer.from(rows.join('\n'), 'utf8');
}

test('a moderator sets up an event, imports voters, publishes and sends the codes', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const staff = staffOf(seed('--staff'));
  await signIn(page, staff.moderator, staff.password);
  const tag = `M${Date.now() % 1_000_000}`;
  const name = `Mkutano ${tag}`;

  // EVT-02: create
  await page.goto(`${STAFF_URL}events?create=1`);
  const dialog = page.locator('.ant-modal');
  await dialog.locator('input').first().fill(name);
  const pickers = dialog.locator('.ant-picker input');
  const start = new Date(Date.now() + DAY);
  for (const [i, at] of [start, new Date(start.getTime() + 8 * 3_600_000)].entries()) {
    await pickers.nth(i).click();
    await pickers.nth(i).fill(pickerText(at));
    await pickers.nth(i).press('Enter');
  }
  await dialog.locator('button.ant-btn-primary').click();
  await expect(page.getByTestId('setup-checklist')).toBeVisible();
  const eventUrl = page.url().replace(/\/$/, '');

  // EVT-04: a category with two contesters
  const drawer = page.locator('.ant-drawer-open');
  await page.goto(`${eventUrl}/categories`);
  await page
    .getByRole('button', { name: /Ongeza nafasi/ })
    .first()
    .click();
  await drawer.locator('input').first().fill('Mwenyekiti');
  await drawer.locator('.ant-drawer-footer button.ant-btn-primary').click();
  const card = page.locator('.vk-category-card', { hasText: 'Mwenyekiti' });
  await expect(card).toBeVisible();
  for (const contester of ['Asha Mollel', 'Juma Ali']) {
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await card.getByRole('button', { name: /Ongeza mgombea/ }).click();
    await drawer.getByLabel('Jina kamili').fill(contester);
    await drawer.locator('.ant-drawer-footer button.ant-btn-primary').click();
    await expect(card.getByText(contester)).toBeVisible();
  }
  await page.keyboard.press('Escape');

  // EVT-06: CSV import, validated and inserted by the worker
  await page.goto(`${eventUrl}/voters`);
  await page
    .getByRole('button', { name: /Pakia CSV/ })
    .first()
    .click();
  await page
    .locator('.vk-dropzone input[type=file]')
    .setInputFiles({ name: 'wapiga.csv', mimeType: 'text/csv', buffer: votersCsv(tag) });
  await expect(page.getByTestId('import-counters')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Ingiza wapiga kura 3' }).click();
  await expect(page.locator('.ant-result-success')).toBeVisible({ timeout: 60_000 });
  await page.locator('.ant-result .ant-btn-primary').click();
  await expect(page.getByText('Mwanachama 3', { exact: true })).toBeVisible();

  // EVT-08: publish, open now, send codes now
  await page.goto(eventUrl);
  await page.locator('[data-main-action="publish"]').click();
  await page.locator('input[type=radio][value=open_now]').check();
  await page.getByTestId('publish-send-codes').click();
  await page.getByTestId('publish-confirm').click();
  await expect(page.getByTestId('open-summary')).toBeVisible();
  await expect(page.locator('[data-main-action="closeNow"]')).toBeVisible();

  // EVT-07: the worker sends the three codes
  await page.goto(`${eventUrl}/messages`);
  const batches = page.getByTestId('batch-table');
  await expect(async () => {
    await page.reload();
    await expect(batches).toContainText('Imekamilika', { timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
});
