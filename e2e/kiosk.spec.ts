// A kiosk vote (Implementation Plan step 25, App Flow 10): membership ID, the code sent to the
// voter's phone, identity, ballot, review, confirmation and the automatic return to the start;
// then the same voter is told they already voted, and staff close the kiosk with the PIN.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { VOTER_URL } from '../playwright.config';

interface SeededKiosk {
  eventName: string;
  membershipId: string;
  code: string;
  voterName: string;
  categories: { name: string; contesters: string[]; choose: number }[];
  kiosk: { token: string; pin: string };
}

function seed(): SeededKiosk {
  const script = path.join(__dirname, '..', 'apps', 'api', 'dist', 'cli', 'seed-vote-e2e.js');
  const output = execFileSync('node', [script, '--kiosk'], {
    cwd: path.join(__dirname, '..', 'apps', 'api'),
    encoding: 'utf8',
  });
  return JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as SeededKiosk;
}

test('a voter votes at a kiosk, which then returns to the start', async ({ page }) => {
  test.setTimeout(90_000);
  const election = seed();
  await page.goto(`${VOTER_URL}vote/kiosk/${election.kiosk.token}`);

  // KSK-01 → KSK-02
  await expect(page.getByText('Gusa kuanza')).toBeVisible();
  await expect(page.getByText(election.eventName)).toBeVisible();
  await page.getByTestId('kiosk-welcome').click();
  // The keypad has capitals only; membership IDs are compared without case.
  for (const key of election.membershipId.toUpperCase().split('')) {
    await page
      .getByRole('group', { name: 'Kibodi' })
      .getByRole('button', { name: key, exact: true })
      .click();
  }
  await expect(page.getByLabel('Namba ya uanachama')).toHaveValue(
    election.membershipId.toUpperCase(),
  );
  await page.getByRole('button', { name: 'Nitumie msimbo' }).click();

  // KSK-03: the code goes to the voter's own phone (+255712000001).
  await expect(page.getByText('Tumetuma msimbo kwa simu inayoishia 001')).toBeVisible();
  await page.getByLabel('Weka msimbo wa uthibitisho').fill(election.code);
  await page.getByRole('button', { name: 'Endelea' }).click();

  // KSK-04, KSK-05
  await page.getByRole('button', { name: 'Huyu ni mimi' }).click();
  await page.getByRole('button', { name: 'Anza kupiga kura' }).click();
  const [chair, board] = election.categories;
  await page.getByRole('radio', { name: chair?.contesters[0] }).click();
  await page.getByRole('button', { name: 'Inayofuata' }).click();
  await page.getByRole('checkbox', { name: board?.contesters[1] }).click();
  await page.getByRole('checkbox', { name: board?.contesters[2] }).click();
  await page.getByRole('button', { name: 'Inayofuata' }).click();
  await page.getByRole('button', { name: 'Tuma kura' }).click();

  // KSK-06: thanks, then back to the start by itself.
  await expect(page.getByRole('heading', { name: 'Kura yako imepokelewa' })).toBeVisible();
  await expect(page.getByText('Asante! Skrini itarudi mwanzo')).toBeVisible();
  await expect(page.getByText('Gusa kuanza')).toBeVisible({ timeout: 15_000 });

  // The same voter again: no code, "Umeshapiga kura".
  await page.getByTestId('kiosk-welcome').click();
  await page.getByLabel('Namba ya uanachama').fill(election.membershipId);
  await page.getByRole('button', { name: 'Nitumie msimbo' }).click();
  await expect(page.getByText(/^Umeshapiga kura saa \d\d:\d\d$/)).toBeVisible();

  // Staff exit: five taps on the logo, then the PIN.
  for (let i = 0; i < 5; i += 1) await page.getByTestId('kiosk-logo').click();
  await page.getByLabel('PIN ya msimamizi').fill(election.kiosk.pin);
  await page.getByRole('button', { name: 'Funga kiosk' }).click();
  await expect(page.getByText('Kiosk hii imefungwa. Muone msimamizi wa uchaguzi.')).toBeVisible();
});

test('a voter without their phone gets the code on another phone, approved by the officer', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const election = seed();
  await page.goto(`${VOTER_URL}vote/kiosk/${election.kiosk.token}`);
  await page.getByTestId('kiosk-welcome').click();
  await page.getByLabel('Namba ya uanachama').fill(election.membershipId);
  await page.getByRole('button', { name: 'Nitumie msimbo' }).click();
  await expect(page.getByText('Tumetuma msimbo kwa simu inayoishia 001')).toBeVisible();

  // KSK-03a: the officer approves another number with the kiosk PIN.
  await page.getByRole('button', { name: 'Tumia simu nyingine' }).click();
  await expect(page.getByRole('heading', { name: 'Msimamizi athibitishe' })).toBeVisible();
  await page.getByLabel('PIN ya msimamizi').fill(election.kiosk.pin);
  await page.getByLabel('Namba ya simu nyingine').fill('0754123987');
  await page.getByRole('button', { name: 'Thibitisha' }).click();
  await expect(page.getByText('Tumetuma msimbo kwa simu inayoishia 987')).toBeVisible();

  // The same code arrives on the other phone; the vote goes on as usual.
  await page.getByLabel('Weka msimbo wa uthibitisho').fill(election.code);
  await page.getByRole('button', { name: 'Endelea' }).click();
  await page.getByRole('button', { name: 'Huyu ni mimi' }).click();
  await page.getByRole('button', { name: 'Anza kupiga kura' }).click();
  const [chair, board] = election.categories;
  await page.getByRole('radio', { name: chair?.contesters[2] }).click();
  await page.getByRole('button', { name: 'Inayofuata' }).click();
  await page.getByRole('checkbox', { name: board?.contesters[0] }).click();
  await page.getByRole('checkbox', { name: board?.contesters[1] }).click();
  await page.getByRole('button', { name: 'Inayofuata' }).click();
  await page.getByRole('button', { name: 'Tuma kura' }).click();
  await expect(page.getByRole('heading', { name: 'Kura yako imepokelewa' })).toBeVisible();
});
