// USSD screens (App Flow 9): every screen fits 182 characters even with the longest names,
// pages keep their numbers, and multi-select input is parsed the way voters type it.
import type { BallotCategory } from '@vote-kidigit/shared';
import {
  alreadyVotedScreen,
  categoryScreen,
  chooseEventScreen,
  helpScreen,
  identityScreen,
  invalidScreen,
  lockedScreen,
  notOpenScreen,
  pageLines,
  parseChoices,
  receivedScreen,
  REVIEW_FOOTER,
  screen,
  USSD_MAX,
} from './ussd-screens.js';

const LONG = 'Mwenyekiti wa Bodi ya Wakurugenzi wa Chama cha Ushirika'; // 56 characters
const PERSON = 'Bwana Mohamedi Abdallah Salim Mwakyusa Kilimanjaro'; // 51 characters

function category(count: number, change: Partial<BallotCategory['rules']> = {}): BallotCategory {
  return {
    id: '0190f0a1-2b3c-7d4e-8f90-000000000c01',
    name: LONG,
    pictureUrl: null,
    rules: {
      selectionMode: 'exact',
      exactCount: 1,
      minCount: null,
      maxCount: null,
      allowSkip: true,
      yesNo: false,
      ...change,
    },
    contesters: Array.from({ length: count }, (_, i) => ({
      id: `0190f0a1-2b3c-7d4e-8f90-${String(i).padStart(12, '0')}`,
      fullName: `${PERSON} ${i + 1}`,
      ussdName: null,
      party: null,
      photoUrl: null,
    })),
  };
}

/** Every page of a category, following "99. Zaidi". */
function pages(c: BallotCategory, retry: boolean): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < c.contesters.length) {
    const page = categoryScreen(c, { index: 12, total: 12 }, start, retry);
    out.push(page.screen.text);
    start = page.next;
  }
  return out;
}

describe('USSD screens', () => {
  it('keeps every category page within 182 characters with the longest names', () => {
    for (const c of [
      category(30),
      category(30, { selectionMode: 'range', exactCount: null, minCount: 1, maxCount: 3 }),
      category(1, { yesNo: true }),
    ]) {
      for (const retry of [false, true]) {
        for (const text of pages(c, retry)) expect(text.length).toBeLessThanOrEqual(USSD_MAX);
      }
    }
  });

  it('numbers contesters continuously across pages and shows at most 6 per page', () => {
    const c = category(14);
    c.name = 'Katibu';
    c.contesters = c.contesters.map((x, i) => ({ ...x, fullName: `Mgombea ${i + 1}` }));
    const all = pages(c, false);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all[0]).toContain('1. Mgombea 1');
    expect(all[0]).toContain('6. Mgombea 6');
    expect(all[0]).not.toContain('7. Mgombea 7');
    expect(all[1]).toContain('7. Mgombea 7');
    expect(all[0]).toContain('99. Zaidi');
    expect(all.at(-1)).not.toContain('99. Zaidi');
    expect(all[0]).toContain('0. Ruka');
    expect(all[0]).toContain('Katibu (12/12)\nChagua 1:');
  });

  it('uses the short USSD name, or cuts names to 20 characters', () => {
    const c = category(2);
    c.contesters[0] = {
      ...(c.contesters[0] as BallotCategory['contesters'][number]),
      ussdName: 'Bi. Asha',
    };
    const text = categoryScreen(c, { index: 1, total: 1 }, 0, false).screen.text;
    expect(text).toContain('1. Bi. Asha');
    expect(text).toMatch(/2\. .{19}…/);
  });

  it('says the rule, and re-prompts with it', () => {
    const range = category(4, {
      selectionMode: 'range',
      exactCount: null,
      minCount: 1,
      maxCount: 3,
      allowSkip: false,
    });
    range.name = 'Wajumbe';
    const first = categoryScreen(range, { index: 2, total: 3 }, 0, false).screen.text;
    expect(first).toContain('Chagua kati ya 1 na 3:');
    expect(first).not.toContain('Ruka');
    const exact = category(4, { exactCount: 3 });
    expect(categoryScreen(exact, { index: 1, total: 1 }, 0, true).screen.text).toMatch(
      /^Chagua wagombea 3\. Jaribu tena:/,
    );
  });

  it('asks Yes or No for a category with one contester', () => {
    const c = category(1, { yesNo: true, allowSkip: false });
    c.name = 'Katiba mpya';
    expect(categoryScreen(c, { index: 1, total: 1 }, 0, false).screen.text).toMatch(
      /^Katiba mpya \(1\/1\)\n.+\n1\. Ndiyo\n2\. Hapana$/,
    );
  });

  it('parses "1 4", "1,4" and "1, 4", and refuses anything else', () => {
    expect(parseChoices('1 4', 6)).toEqual([1, 4]);
    expect(parseChoices('1,4', 6)).toEqual([1, 4]);
    expect(parseChoices(' 1, 4 ', 6)).toEqual([1, 4]);
    expect(parseChoices('4 4', 6)).toEqual([4]);
    expect(parseChoices('7', 6)).toBeNull();
    expect(parseChoices('0', 6)).toBeNull();
    expect(parseChoices('a', 6)).toBeNull();
    expect(parseChoices('', 6)).toBeNull();
  });

  it('pages a long review and ends with Thibitisha / Rudi mwanzo', () => {
    const lines = Array.from(
      { length: 12 },
      (_, i) => `${LONG.slice(0, 30)}: ${PERSON.slice(0, 20)}, Mtu ${i}`,
    );
    const all = pageLines('Hakiki:', lines, REVIEW_FOOTER);
    expect(all.length).toBeGreaterThan(1);
    for (const text of all) expect(text.length).toBeLessThanOrEqual(USSD_MAX);
    expect(all[0]).toMatch(/99\. Zaidi$/);
    expect(all.at(-1)).toMatch(/1\. Thibitisha\n2\. Rudi mwanzo$/);
    expect(all.join('\n').match(/Mtu \d+/g)).toHaveLength(12);
  });

  it('fits every other screen with the longest names', () => {
    const tz = 'Africa/Dar_es_Salaam';
    for (const s of [
      identityScreen(LONG, LONG, PERSON),
      chooseEventScreen(Array.from({ length: 9 }, () => ({ name: LONG, organizationName: LONG }))),
      helpScreen('+255 754 000 222 ext 9999'),
      invalidScreen(4),
      lockedScreen('2026-11-20T10:15:00Z', tz),
      notOpenScreen('2026-11-20T05:00:00Z', tz),
      alreadyVotedScreen('2026-11-20T11:05:00Z', tz, '*150*00*123456#'),
      receivedScreen('2026-11-20T11:05:00Z', tz),
    ]) {
      expect(s.text.length).toBeLessThanOrEqual(USSD_MAX);
    }
    expect(receivedScreen('2026-11-20T11:05:00Z', tz).text).toBe(
      'Asante! Kura yako imepokelewa saa 14:05.',
    );
  });

  it('refuses to build a screen over 182 characters', () => {
    expect(() => screen('x'.repeat(USSD_MAX + 1))).toThrow(/USSD screen of 183/);
  });
});
