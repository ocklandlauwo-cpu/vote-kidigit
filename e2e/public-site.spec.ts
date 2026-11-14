// Public website (Implementation Plan step 38): every page at 320 px in both themes passes the
// accessibility checks of Design System 13 (one h1, page language, no sideways scrolling, 48 px
// tap targets, keyboard reachable with a visible focus ring), and the demo and contact forms
// validate and send through the real API in Swahili and in English.
import { expect, type Locator, type Page, test } from '@playwright/test';
import { VOTER_URL } from '../playwright.config';

const PAGES = [
  ['', 'Uchaguzi wa siri, matokeo ya uhakika'],
  ['features', 'Vipengele'],
  ['pricing', 'Bei'],
  ['contact', 'Wasiliana nasi'],
  ['demo', 'Omba onyesho'],
] as const;

/** Presses Tab until `target` has the focus, which must show the focus ring. */
async function tabTo(page: Page, target: Locator, limit = 60): Promise<void> {
  for (let i = 0; i < limit; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) {
      expect(await target.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`not reachable by Tab: ${String(target)}`);
}

async function pageRules(page: Page, lang: 'sw' | 'en'): Promise<void> {
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(0);
  for (const target of await page.locator('main button:visible, main a.vk-btn:visible').all()) {
    const box = await target.boundingBox();
    const name = await target.innerText();
    expect(box?.height ?? 0, `tap target height of "${name}"`).toBeGreaterThanOrEqual(48);
  }
  // Every form control has a name people and screen readers can use.
  for (const field of await page.locator('main input:visible, main textarea:visible').all()) {
    expect(await field.evaluate((el) => (el as HTMLInputElement).labels?.length ?? 0)).toBe(1);
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`every public page passes the screen rules at 320 px (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.addInitScript((value) => localStorage.setItem('vk-theme', value), theme);
    for (const [path, title] of PAGES) {
      await page.goto(`${VOTER_URL}${path}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await pageRules(page, 'sw');
    }
    // The menu opens by keyboard and its links lead on.
    await page.goto(VOTER_URL);
    await tabTo(page, page.getByRole('button', { name: 'Fungua menyu' }));
    await page.keyboard.press('Enter');
    const pricing = page.locator('#site-menu').getByRole('link', { name: 'Bei' });
    await tabTo(page, pricing);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Bei' })).toBeVisible();
    await expect(page.locator('#site-menu')).toHaveCount(0);
  });
}

test('a demo request is checked field by field and sent, by keyboard (Swahili)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`${VOTER_URL}demo`);
  const submit = page.getByRole('button', { name: 'Tuma ombi' });
  await tabTo(page, submit);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Rekebisha sehemu zilizowekwa alama.');
  await expect(page.getByLabel('Jina kamili')).toBeFocused();
  await expect(page.getByLabel('Jina kamili')).toHaveAttribute('aria-invalid', 'true');

  await page.keyboard.type('Asha Mwinyi');
  await page.getByLabel('Taasisi').fill('SACCO ya Walimu E2E');
  await page.getByLabel('Namba ya simu').fill('0754 123 456');
  await page.getByLabel('Barua pepe').fill('asha@example.test');
  await page.getByLabel('Idadi ya wapiga kura inayotarajiwa').fill('850');
  await page.getByLabel('Tarehe unayopendelea').fill('2099-12-03');
  const sent = page.waitForResponse((r) => r.url().endsWith('/api/v1/public/contact'));
  await tabTo(page, submit);
  await page.keyboard.press('Enter');
  expect((await sent).status()).toBe(202);
  await expect(page.getByRole('heading', { level: 1, name: 'Ombi limepokelewa' })).toBeVisible();
  await pageRules(page, 'sw');
});

test('the contact form works in English and the choice of language is kept', async ({ page }) => {
  await page.goto(`${VOTER_URL}contact`);
  await page.getByRole('button', { name: 'Badili lugha kuwa Kiingereza' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Contact us' })).toBeVisible();
  await expect(page).toHaveTitle('Contact us — Vote-Kidigit');
  await pageRules(page, 'en');

  await page.getByLabel('Full name').fill('John Kim');
  await page.getByLabel('Email').fill('john@example');
  await page.getByLabel(/^Message/).fill('Hi');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await expect(page.getByText('Write a message of 10 to 2,000 characters.')).toBeVisible();

  await page.getByLabel('Email').fill('john@example.test');
  await page.getByLabel(/^Message/).fill('Please call me about an election in March.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Thank you, we will be in touch')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Contact us' })).toBeVisible();
  // The voter screens stay Swahili whatever the site's language.
  await page.goto(`${VOTER_URL}vote`);
  await expect(page.getByRole('heading', { level: 1, name: 'Ingia' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sw');
});
