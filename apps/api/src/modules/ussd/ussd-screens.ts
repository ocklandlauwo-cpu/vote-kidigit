// USSD screens (App Flow 9.1–9.2, PRD VOT-04, VOT-05): the exact Swahili wording, one item per
// line, and every screen at most 182 characters. Pure functions: the engine decides which screen,
// these decide the text. Contester names use the short USSD name or are cut to 20 characters;
// long lists page with "99. Zaidi" and keep their numbers (7, 8, 9… on the next page).
import type { BallotCategory } from '@vote-kidigit/shared';

/** Longest USSD screen the operators accept (App Flow 9). */
export const USSD_MAX = 182;
export const MORE = '99';
export const SKIP = '0';
const PAGE_SIZE = 6;
const NAME_MAX = 20;

export interface Screen {
  text: string;
  /** END: the session finishes after this screen. */
  end: boolean;
}

/** Cuts `text` to `max` characters with an ellipsis. */
export function cut(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Every screen passes here: over 182 characters is a programming error, never sent. */
export function screen(text: string, end = false): Screen {
  if (text.length > USSD_MAX) {
    throw new Error(`USSD screen of ${text.length} characters: ${text.slice(0, 40)}…`);
  }
  return { text, end };
}

/** "14:05" in the organization's time zone. */
export function timeIn(at: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at));
}

const MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];
function dateIn(at: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'numeric' })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.day} ${MONTHS[Number(parts.month) - 1]}`;
}

// --- VTR-USSD-01 to -04, -10 -----------------------------------------------------------------

export const menuScreen = () =>
  screen('Karibu Vote-Kidigit\n1. Piga kura\n2. Angalia matokeo\n3. Msaada');
export const membershipScreen = (retry = false) =>
  screen(`${retry ? 'Jaribu tena.\n' : ''}Weka namba yako ya uanachama:`);
export const codeScreen = () => screen('Weka msimbo wa uthibitisho (herufi 8):');

/** The events a membership ID and code match (rare): as many as fit, at most 5. */
export function chooseEventScreen(events: { name: string; organizationName: string }[]): Screen {
  const render = (n: number) =>
    [
      'Chagua uchaguzi:',
      ...events
        .slice(0, n)
        .map((e, i) => `${i + 1}. ${cut(e.organizationName, 14)}: ${cut(e.name, 20)}`),
    ].join('\n');
  let count = Math.min(5, events.length);
  while (count > 1 && render(count).length > USSD_MAX) count -= 1;
  return screen(render(count));
}

export function identityScreen(organization: string, event: string, fullName: string): Screen {
  return screen(
    `${cut(organization, 30)}: ${cut(event, 40)}\nJina: ${cut(fullName, 50)}\n1. Ndiyo, ni mimi\n2. Si mimi`,
  );
}

export function notMeScreen(contactPhone: string | null): Screen {
  return screen(
    contactPhone
      ? `Tafadhali wasiliana na msimamizi wa uchaguzi: ${cut(contactPhone, 20)}`
      : 'Tafadhali wasiliana na msimamizi wa uchaguzi.',
    true,
  );
}

export function helpScreen(supportPhone: string | null): Screen {
  return screen(
    `${supportPhone ? `Msaada: ${cut(supportPhone, 20)}\n` : ''}Msimbo umepotea? Wasiliana na msimamizi wa uchaguzi.`,
    true,
  );
}

// --- Sign-in errors and status messages (App Flow 9.2, 8.3, 13.1) ------------------------------

export const invalidScreen = (attemptsLeft: number) =>
  screen(`Namba au msimbo si sahihi. Majaribio yaliyobaki: ${attemptsLeft}`, true);
export const lockedScreen = (until: string, timeZone: string) =>
  screen(`Umezuiwa kwa dakika 15. Jaribu tena saa ${timeIn(until, timeZone)}`, true);
export const notOpenScreen = (startAt: string, timeZone: string) =>
  screen(
    `Upigaji kura utaanza ${dateIn(startAt, timeZone)} saa ${timeIn(startAt, timeZone)}`,
    true,
  );
export const closedScreen = () =>
  screen('Upigaji kura umefungwa. Matokeo bado hayajatangazwa', true);
export const cancelledScreen = () => screen('Uchaguzi huu umesitishwa', true);
export const unavailableScreen = () =>
  screen('Huduma haipatikani kwa sasa. Tafadhali jaribu tena baadaye.', true);
export const sessionEndedScreen = () => screen('Muda umeisha. Tafadhali piga tena.', true);
export const noResultsScreen = () => screen('Matokeo bado hayajatangazwa.', true);

/** VTR-USSD-08 */
export function alreadyVotedScreen(votedAt: string, timeZone: string, shortCode: string): Screen {
  return screen(
    `Umeshapiga kura saa ${timeIn(votedAt, timeZone)}. Matokeo: piga ${cut(shortCode, 15)} chagua 2 baada ya kutangazwa.`,
    true,
  );
}

/** VTR-USSD-07 */
export const receivedScreen = (votedAt: string, timeZone: string) =>
  screen(`Asante! Kura yako imepokelewa saa ${timeIn(votedAt, timeZone)}.`, true);

// --- VTR-USSD-05 / -05y: one category ---------------------------------------------------------

export function minChoices(category: BallotCategory): number {
  const { rules } = category;
  return (rules.selectionMode === 'exact' ? rules.exactCount : rules.minCount) ?? 1;
}
export function maxChoices(category: BallotCategory): number {
  const { rules } = category;
  return (rules.selectionMode === 'exact' ? rules.exactCount : rules.maxCount) ?? 1;
}

/** "Chagua 1", "Chagua 3", "Chagua kati ya 1 na 3" (App Flow 9.2). */
export function ruleText(category: BallotCategory): string {
  const min = minChoices(category);
  const max = maxChoices(category);
  return min === max ? `Chagua ${min}` : `Chagua kati ya ${min} na ${max}`;
}

/** The re-prompt when the count is wrong: "Chagua wagombea 3. Jaribu tena:". */
export function retryText(category: BallotCategory): string {
  const min = minChoices(category);
  const max = maxChoices(category);
  return min === max
    ? `Chagua wagombea ${min}. Jaribu tena:`
    : `Chagua kati ya ${min} na ${max}. Jaribu tena:`;
}

export const contesterLabel = (c: { fullName: string; ussdName?: string | null }) =>
  cut(c.ussdName?.trim() || c.fullName, NAME_MAX);

/**
 * The page of contesters starting at `start`: up to 6, fewer if the screen would pass 182
 * characters. Returns the screen and the index after the last contester shown.
 */
export function categoryScreen(
  category: BallotCategory,
  position: { index: number; total: number },
  start: number,
  retry: boolean,
): { screen: Screen; next: number } {
  const head = [
    ...(retry ? [retryText(category)] : []),
    `${cut(category.name, 40)} (${position.index}/${position.total})`,
  ];
  if (category.rules.yesNo) {
    const [only] = category.contesters;
    const lines = [...head, contesterLabel(only ?? { fullName: '' }), '1. Ndiyo', '2. Hapana'];
    if (category.rules.allowSkip) lines.push(`${SKIP}. Ruka`);
    return { screen: screen(lines.join('\n')), next: category.contesters.length };
  }
  const tail = (more: boolean) => [
    ...(more ? [`${MORE}. Zaidi`] : []),
    ...(category.rules.allowSkip ? [`${SKIP}. Ruka`] : []),
  ];
  let count = Math.min(PAGE_SIZE, category.contesters.length - start);
  for (; count > 1; count -= 1) {
    const more = start + count < category.contesters.length;
    if (render(count, more).length <= USSD_MAX) break;
  }
  const more = start + count < category.contesters.length;
  return { screen: screen(render(count, more)), next: start + count };

  function render(n: number, more: boolean): string {
    const items = category.contesters
      .slice(start, start + n)
      .map((c, i) => `${start + i + 1}. ${contesterLabel(c)}`);
    return [...head, `${ruleText(category)}:`, ...items, ...tail(more)].join('\n');
  }
}

/**
 * The numbers a voter typed for a multi-choice category ("1 4", "1,4", "1, 4"), or null when
 * the input is not a list of contester numbers on the ballot.
 */
export function parseChoices(input: string, contesterCount: number): number[] | null {
  const parts = input
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length === 0 || !parts.every((p) => /^\d+$/.test(p))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((n) => n < 1 || n > contesterCount)) return null;
  return [...new Set(numbers)];
}

// --- VTR-USSD-06: review, VTR-USSD-09: results (paged) ---------------------------------------

/**
 * Splits `lines` into screens of at most 182 characters, each with `head` on top and `footer`
 * (plus "99. Zaidi" when more follows) at the bottom.
 */
export function pageLines(head: string, lines: string[], footer: string[]): string[] {
  const pages: string[] = [];
  let current: string[] = [];
  const build = (body: string[], more: boolean) =>
    [head, ...body, ...(more ? [`${MORE}. Zaidi`] : footer)].join('\n');
  for (const line of lines.map((l) => cut(l, USSD_MAX - head.length - 20))) {
    // A page must fit with either ending: "99. Zaidi" or, if it turns out to be the last, the footer.
    const grown = [...current, line];
    if (
      current.length > 0 &&
      (build(grown, true).length > USSD_MAX || build(grown, false).length > USSD_MAX)
    ) {
      pages.push(build(current, true));
      current = [];
    }
    current.push(line);
  }
  pages.push(build(current, false));
  return pages.map((text) => screen(text).text);
}

export const REVIEW_FOOTER = ['1. Thibitisha', '2. Rudi mwanzo'];
