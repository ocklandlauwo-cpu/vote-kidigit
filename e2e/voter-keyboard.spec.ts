// Keyboard-only web vote in both themes on a 320 px wide screen (Implementation Plan step 30,
// Design System 13.1): every step is reached with Tab, chosen with Space and confirmed with Enter,
// the focused element shows the focus ring (:focus-visible), buttons are at least 48 px tall, no
// screen scrolls sideways, and the page keeps lang="sw" and one h1.
import { expect, type Locator, type Page, test } from '@playwright/test';
import { VOTER_URL } from '../playwright.config';
import { seed } from './support';

/** Presses Tab until `target` has the focus; fails if it is not reachable. */
async function tabTo(page: Page, target: Locator, limit = 40): Promise<void> {
  for (let i = 0; i < limit; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) {
      // Reached by keyboard: the focus ring shows (Design System 13.1).
      expect(await target.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`not reachable by Tab: ${String(target)}`);
}

/** One h1, lang="sw", nothing wider than the screen, every button a 48 px tap target. */
async function screenRules(page: Page): Promise<void> {
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('lang', 'sw');
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(0);
  for (const button of await page.locator('button:visible').all()) {
    const box = await button.boundingBox();
    const name = (await button.getAttribute('aria-label')) ?? (await button.innerText());
    expect(box?.height ?? 0, `tap target height of "${name}"`).toBeGreaterThanOrEqual(48);
    expect(box?.width ?? 0, `tap target width of "${name}"`).toBeGreaterThanOrEqual(48);
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`a voter votes with the keyboard only (${theme})`, async ({ page }) => {
    test.setTimeout(90_000);
    const election = seed();
    await page.setViewportSize({ width: 320, height: 700 });
    await page.addInitScript((value) => localStorage.setItem('vk-theme', value), theme);
    await page.goto(`${VOTER_URL}vote/${election.eventId}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('heading', { level: 1, name: 'Ingia' })).toBeVisible();
    await screenRules(page);

    // VTR-WEB-01
    await tabTo(page, page.getByLabel('Namba ya uanachama'));
    await page.keyboard.type(election.membershipId);
    await tabTo(page, page.getByLabel('Msimbo wa uthibitisho'));
    await page.keyboard.type(election.code);
    await tabTo(page, page.getByRole('button', { name: 'Endelea' }));
    await page.keyboard.press('Enter');

    // VTR-WEB-02, 03
    const isMe = page.getByRole('button', { name: 'Huyu ni mimi' });
    await expect(isMe).toBeVisible();
    await screenRules(page);
    await tabTo(page, isMe);
    await page.keyboard.press('Enter');
    const start = page.getByRole('button', { name: 'Anza kupiga kura' });
    await expect(start).toBeVisible();
    await tabTo(page, start);
    await page.keyboard.press('Enter');

    // VTR-WEB-04: contester cards are radios / checkboxes chosen with Space.
    const [chair, board] = election.categories;
    const next = page.getByRole('button', { name: 'Inayofuata' });
    const chairChoice = page.getByRole('radio', { name: chair?.contesters[0] });
    await tabTo(page, chairChoice);
    await page.keyboard.press('Space');
    await expect(chairChoice).toHaveAttribute('aria-checked', 'true');
    await tabTo(page, next);
    await page.keyboard.press('Enter');

    for (const name of [board?.contesters[0], board?.contesters[1]]) {
      const box = page.getByRole('checkbox', { name });
      await tabTo(page, box);
      await page.keyboard.press('Space');
      await expect(box).toHaveAttribute('aria-checked', 'true');
    }
    await tabTo(page, next);
    await page.keyboard.press('Enter');

    // VTR-WEB-05, 06
    await expect(page.getByRole('heading', { level: 1, name: 'Hakiki kura yako' })).toBeVisible();
    await screenRules(page);
    await tabTo(page, page.getByRole('button', { name: 'Tuma kura' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Kura yako imepokelewa' })).toBeVisible();
    await screenRules(page);
  });
}
