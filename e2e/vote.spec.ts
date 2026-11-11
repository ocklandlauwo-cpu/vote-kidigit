// The full web vote (Implementation Plan step 24): sign in from the SMS link, confirm identity,
// vote in both categories, review, submit, and browser back returning to the confirmation.
// The election comes from the API's e2e seed (an Open event with one voter of known code).
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { VOTER_URL } from '../playwright.config';

interface SeededVote {
  eventId: string;
  eventName: string;
  membershipId: string;
  code: string;
  voterName: string;
  categories: { name: string; contesters: string[]; choose: number }[];
}

function seed(): SeededVote {
  const script = path.join(__dirname, '..', 'apps', 'api', 'dist', 'cli', 'seed-vote-e2e.js');
  const output = execFileSync('node', [script], {
    cwd: path.join(__dirname, '..', 'apps', 'api'),
    encoding: 'utf8',
  });
  return JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as SeededVote;
}

test('a voter votes from the SMS link to the confirmation', async ({ page }) => {
  const election = seed();
  await page.goto(`${VOTER_URL}vote/${election.eventId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Ingia' })).toBeVisible();
  await expect(page.getByText(election.eventName)).toBeVisible();

  // VTR-WEB-01: the code typed in lower case without the dash.
  await page.getByLabel('Namba ya uanachama').fill(election.membershipId);
  await page.getByLabel('Msimbo wa uthibitisho').fill(election.code.toLowerCase());
  await expect(page.getByLabel('Msimbo wa uthibitisho')).toHaveValue(
    `${election.code.slice(0, 4)}-${election.code.slice(4)}`,
  );
  await page.getByRole('button', { name: 'Endelea' }).click();

  // VTR-WEB-02
  await expect(page.getByRole('heading', { name: election.voterName })).toBeVisible();
  await page.getByRole('button', { name: 'Huyu ni mimi' }).click();

  // VTR-WEB-03
  await expect(page.getByRole('heading', { level: 1, name: 'Kura yako' })).toBeVisible();
  await expect(page.getByText('Utapiga kura katika nafasi 2 sasa')).toBeVisible();
  await page.getByRole('button', { name: 'Anza kupiga kura' }).click();

  // VTR-WEB-04: one, then two of three.
  const [chair, board] = election.categories;
  await expect(page.getByText('Nafasi 1 kati ya 2')).toBeVisible();
  const next = page.getByRole('button', { name: 'Inayofuata' });
  await expect(next).toBeDisabled();
  await page.getByRole('radio', { name: chair?.contesters[1] }).click();
  await next.click();

  await expect(page.getByText('Nafasi 2 kati ya 2')).toBeVisible();
  await page.getByRole('checkbox', { name: board?.contesters[0] }).click();
  await expect(next).toBeDisabled();
  await page.getByRole('checkbox', { name: board?.contesters[2] }).click();
  await expect(page.getByRole('checkbox', { name: board?.contesters[1] })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await next.click();

  // VTR-WEB-05
  await expect(page.getByRole('heading', { level: 1, name: 'Hakiki kura yako' })).toBeVisible();
  const review = page.getByTestId('review-card');
  for (const name of [chair?.contesters[1], board?.contesters[0], board?.contesters[2]]) {
    await expect(review.getByText(name ?? '')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Tuma kura' }).click();

  // VTR-WEB-06, and browser back stays there.
  await expect(page.getByRole('heading', { name: 'Kura yako imepokelewa' })).toBeVisible();
  await expect(page.getByText(/^Asante Amina, kura yako imepokelewa saa \d\d:\d\d$/)).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Kura yako imepokelewa' })).toBeVisible();

  // Maliza, then signing in again shows the voter's status (VTR-WEB-07).
  await page.getByRole('button', { name: 'Maliza' }).click();
  await page.getByLabel('Namba ya uanachama').fill(election.membershipId);
  await page.getByLabel('Msimbo wa uthibitisho').fill(election.code);
  await page.getByRole('button', { name: 'Endelea' }).click();
  await page.getByRole('button', { name: 'Huyu ni mimi' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hali yako' })).toBeVisible();
  await expect(page.getByText('Umeshapiga kura')).toHaveCount(2);
});
