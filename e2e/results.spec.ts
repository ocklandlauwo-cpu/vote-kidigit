// Suite 4 (Implementation Plan step 30): an Open event tied 1–1 for its only seat is closed with
// the typed name, the tie is resolved with a reason, results are published, the public page shows
// the winner, and the results PDF downloads from the Results tab.
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { STAFF_URL } from '../playwright.config';
import { seed, signIn, staffOf } from './support';

test('close, resolve the tie, publish, see the public page and download the PDF', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const seeded = seed('--staff', '--tie');
  const staff = staffOf(seeded);
  const tie = seeded.tie;
  if (!tie) throw new Error('seed without --tie');
  const [halima] = tie.contesters;
  await signIn(page, staff.superAdmin, staff.password);

  // Close now, confirmed with the event name
  await page.goto(`${STAFF_URL}events/${tie.eventId}`);
  await page.locator('[data-main-action="closeNow"]').click();
  const closeDialog = page.locator('.ant-modal').last();
  await closeDialog.locator('input').first().fill(tie.eventName);
  await closeDialog.locator('button.ant-btn-dangerous').last().click();

  // RES-01 with the tie banner; publishing is blocked until the tie is resolved
  await expect(page.getByTestId('results')).toBeVisible();
  await expect(
    page.getByText('Sare 1 inahitaji uamuzi kabla ya kutangaza matokeo').first(),
  ).toBeVisible();
  await expect(page.getByTestId('publish-results')).toBeDisabled();

  // RES-03
  await page.getByRole('button', { name: 'Amua sare' }).click();
  const tieDialog = page.getByRole('dialog');
  await tieDialog.getByRole('checkbox', { name: halima }).check();
  await tieDialog.getByLabel('Sababu (inahitajika)').fill('Kura ya bahati mbele ya wagombea wote');
  await tieDialog.getByRole('button', { name: 'Hifadhi uamuzi' }).click();
  await expect(page.getByTestId('publish-results')).toBeEnabled();

  // Publish with the typed name
  await page.getByTestId('publish-results').click();
  const publishDialog = page.locator('.ant-modal').last();
  await publishDialog.locator('input').first().fill(tie.eventName);
  await publishDialog.getByRole('button', { name: 'Tangaza matokeo' }).click();
  const publicUrl = (await page.getByTestId('public-url').textContent())?.trim() ?? '';
  expect(publicUrl).toMatch(/\/results\/[\w-]+$/);

  // REP-01: the PDF, generated at once for a small event
  const download = page.waitForEvent('download');
  await page.getByTestId('download-pdf').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^matokeo-sare-e2e-.*\.pdf$/);
  const bytes = await readFile((await file.path()) ?? '');
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

  // RES-04: the public page, no sign-in
  const visitor = await page.context().browser()?.newPage();
  if (!visitor) throw new Error('no browser');
  await visitor.goto(publicUrl);
  const view = visitor.getByTestId('results-view');
  await expect(view).toBeVisible();
  await expect(view.getByText(halima ?? '')).toBeVisible();
  await expect(view.getByText('Mshindi')).toBeVisible();
  await visitor.close();
});
