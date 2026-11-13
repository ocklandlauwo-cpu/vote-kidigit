// Shared helpers of the end-to-end suites (Implementation Plan step 30): the API's e2e seed,
// staff sign-in and the date text the event date pickers accept.
import { expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { STAFF_URL } from '../playwright.config';

export interface Seeded {
  organizationId: string;
  eventId: string;
  eventName: string;
  membershipId: string;
  code: string;
  voterName: string;
  categories: { name: string; contesters: string[]; choose: number }[];
  kiosk?: { token: string; pin: string };
  staff?: {
    superAdmin: string;
    moderator: string;
    observer: string;
    unmappedModerator: string;
    password: string;
  };
  tie?: { eventId: string; eventName: string; contesters: string[] };
}

/** A fresh organization with an Open event; options add a kiosk, staff accounts, a tied event. */
export function seed(...options: ('--kiosk' | '--staff' | '--tie')[]): Seeded {
  const api = path.join(__dirname, '..', 'apps', 'api');
  const output = execFileSync(
    'node',
    [path.join(api, 'dist', 'cli', 'seed-vote-e2e.js'), ...options],
    {
      cwd: api,
      encoding: 'utf8',
    },
  );
  return JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as Seeded;
}

export function staffOf(seeded: Seeded): NonNullable<Seeded['staff']> {
  if (!seeded.staff) throw new Error('seed without --staff');
  return seeded.staff;
}

/** AUTH-01 sign-in; waits for the portal frame. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${STAFF_URL}login`);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page.locator('.ant-layout-sider').first()).toBeVisible();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "21 Nov 2026, 08:00" in Africa/Dar_es_Salaam: the format of the event date pickers. */
export function pickerText(at: Date): string {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Dar_es_Salaam',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)) {
    parts[part.type] = part.value;
  }
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}, ${parts.hour}:${parts.minute}`;
}
