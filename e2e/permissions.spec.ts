// Suite 5 (Implementation Plan step 30, App Flow 3.7): an observer sees a mapped event but every
// action is greyed out and staff pages are not found; a moderator mapped to nothing never finds the
// event, by list, link, search or API.
import { expect, test } from '@playwright/test';
import { STAFF_URL } from '../playwright.config';
import { seed, signIn, staffOf } from './support';

const NOT_FOUND = 'Hatukuweza kupata ukurasa huo';
/** The API through the staff dev server's proxy, so the session cookie goes with it. */
const API = new URL('/api/v1', STAFF_URL).href;

test('an observer sees the mapped event read-only and no staff pages', async ({ page }) => {
  const seeded = seed('--staff');
  const staff = staffOf(seeded);
  await signIn(page, staff.observer, staff.password);

  // DSH-04 lists the event; the event opens with its main action greyed out.
  await expect(page.getByTestId('card-my-events')).toContainText(seeded.eventName);
  await page.goto(`${STAFF_URL}events/${seeded.eventId}`);
  await expect(page.getByRole('heading', { name: seeded.eventName })).toBeVisible();
  await expect(page.locator('[data-main-action="closeNow"]')).toBeDisabled();

  // Menu items the observer cannot use are hidden, and their pages are ERR-03.
  await expect(page.getByRole('menuitem', { name: 'Watumiaji' })).toHaveCount(0);
  for (const path of ['users', 'roles', 'settings', 'audit']) {
    await page.goto(`${STAFF_URL}${path}`);
    await expect(page.getByText(NOT_FOUND)).toBeVisible();
  }

  // The API refuses the action itself, not just the button.
  const me = (await (await page.request.get(`${API}/me`)).json()) as { csrfToken: string };
  const close = await page.request.post(`${API}/events/${seeded.eventId}/close`, {
    headers: { 'X-CSRF-Token': me.csrfToken },
  });
  expect(close.status()).toBe(403);
});

test('a moderator mapped to nothing never finds the event', async ({ page }) => {
  const seeded = seed('--staff');
  const staff = staffOf(seeded);
  await signIn(page, staff.unmappedModerator, staff.password);

  await expect(page.getByTestId('card-my-events')).toContainText(
    'Bado hujapangiwa uchaguzi wowote. Wasiliana na msimamizi wako.',
  );
  await page.goto(`${STAFF_URL}events`);
  await expect(page.getByText(seeded.eventName)).toHaveCount(0);

  await page.goto(`${STAFF_URL}events/${seeded.eventId}`);
  await expect(page.getByText(NOT_FOUND)).toBeVisible();

  const api = await page.request.get(`${API}/events/${seeded.eventId}`);
  expect(api.status()).toBe(404);
  const search = await page.request.get(`${API}/search?q=${encodeURIComponent(seeded.eventName)}`);
  expect(((await search.json()) as { events: unknown[] }).events).toEqual([]);
});
