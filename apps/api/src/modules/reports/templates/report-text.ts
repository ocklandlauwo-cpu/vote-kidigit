// Words of the reports (Design System 11), in the language of the staff member who asked for
// them: Swahili first. Dates follow Design System 11.5 in the organization's time zone.
import type { Language } from '@vote-kidigit/shared';

const MONTHS: Record<Language, string[]> = {
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/** "3 Nov 2026, saa 14:00" / "3 Nov 2026, 14:00" */
export function reportDateTime(at: Date, timeZone: string, language: Language): string {
  const values: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)) {
    values[part.type] = part.value;
  }
  const date = `${Number(values.day)} ${MONTHS[language][Number(values.month) - 1]} ${values.year}`;
  const time = `${values.hour}:${values.minute}`;
  return language === 'sw' ? `${date}, saa ${time}` : `${date}, ${time}`;
}

/** 3214 → "3,214" */
export const count = (value: number) => value.toLocaleString('en');

const sw = {
  resultsTitle: 'Matokeo ya uchaguzi',
  votersTitle: 'Orodha ya wapiga kura',
  event: 'Uchaguzi',
  status: 'Hali',
  window: 'Muda wa kupiga kura',
  opened: 'Upigaji kura ulifunguliwa',
  closed: 'Upigaji kura ulifungwa',
  published: 'Matokeo yalitangazwa',
  turnout: 'Waliopiga kura',
  turnoutValue: (voted: string, registered: string, percent: string) =>
    `${voted} kati ya ${registered} (${percent}%)`,
  seats: (n: number) => (n === 1 ? 'Nafasi 1' : `Nafasi ${n}`),
  contester: 'Mgombea',
  votes: 'Kura',
  percent: '%',
  winner: 'Mshindi',
  yes: 'Ndiyo',
  no: 'Hapana',
  skipped: 'Hawakuchagua',
  eligible: 'Wanaostahili',
  votedInCategory: 'Walipiga kura',
  threshold: (pct: string, met: boolean) =>
    `Kiwango cha ${pct}%: ${met ? 'kimefikiwa' : 'hakijafikiwa'}`,
  quorum: (pct: string, met: boolean) => `Akidi ya ${pct}%: ${met ? 'imetimia' : 'haijatimia'}`,
  noWinner: 'Hakuna mshindi',
  tieNote: (by: string, at: string, reason: string) =>
    `Sare iliamuliwa na ${by} (${at}): ${reason}`,
  tieOpen: 'Sare bado haijaamuliwa',
  notPublished: 'Matokeo haya bado hayajatangazwa.',
  signatures: 'Sahihi',
  returningOfficer: 'Msimamizi wa uchaguzi',
  witness: (n: number) => `Shahidi ${n}`,
  nameLine: 'Jina',
  signLine: 'Sahihi',
  dateLine: 'Tarehe',
  verify: 'Hakiki matokeo haya',
  verifyHint: 'Changanua msimbo huu kuona matokeo kwenye ukurasa rasmi.',
  version: (v: number) => `Toleo ${v}`,
  hash: 'Alama ya uhakiki (SHA-256)',
  generated: (at: string, by: string) => `Imetolewa ${at} na ${by}`,
  page: 'Ukurasa',
  of: 'kati ya',
  name: 'Jina',
  membershipId: 'Namba ya uanachama',
  gender: 'Jinsia',
  phone: 'Simu',
  categories: 'Nafasi',
  allCategories: 'Zote',
  voted: 'Amepiga kura',
  notVoted: 'Hajapiga kura',
  sms: 'SMS ya namba',
  totals: (total: string, voted: string) => `Jumla ${total} · walipiga kura ${voted}`,
  genders: { male: 'Mwanaume', female: 'Mwanamke' },
  codeStatus: {
    not_sent: 'Haijatumwa',
    sent: 'Imetumwa',
    delivered: 'Imefika',
    failed: 'Imeshindikana',
  },
  eventStatus: {
    draft: 'Rasimu',
    scheduled: 'Imepangwa',
    open: 'Inaendelea',
    closed: 'Imefungwa',
    results_published: 'Matokeo yametangazwa',
    archived: 'Imehifadhiwa',
    cancelled: 'Imesitishwa',
  },
  audit: {
    sheet: 'Kumbukumbu',
    time: 'Muda',
    user: 'Mtumiaji',
    action: 'Kitendo',
    item: 'Kipengele',
    itemId: 'Kitambulisho',
    event: 'Uchaguzi',
    ip: 'IP',
    reason: 'Sababu',
    before: 'Kabla',
    after: 'Baada',
  },
};

export type ReportText = typeof sw;

const en: ReportText = {
  resultsTitle: 'Election results',
  votersTitle: 'Registered voters',
  event: 'Election',
  status: 'Status',
  window: 'Voting window',
  opened: 'Voting opened',
  closed: 'Voting closed',
  published: 'Results published',
  turnout: 'Turnout',
  turnoutValue: (voted, registered, percent) => `${voted} of ${registered} (${percent}%)`,
  seats: (n) => (n === 1 ? '1 seat' : `${n} seats`),
  contester: 'Contester',
  votes: 'Votes',
  percent: '%',
  winner: 'Winner',
  yes: 'Yes',
  no: 'No',
  skipped: 'Skipped',
  eligible: 'Eligible',
  votedInCategory: 'Voted',
  threshold: (pct, met) => `Threshold ${pct}%: ${met ? 'met' : 'not met'}`,
  quorum: (pct, met) => `Quorum ${pct}%: ${met ? 'met' : 'not met'}`,
  noWinner: 'No winner',
  tieNote: (by, at, reason) => `Tie resolved by ${by} (${at}): ${reason}`,
  tieOpen: 'Tie not yet resolved',
  notPublished: 'These results are not yet published.',
  signatures: 'Signatures',
  returningOfficer: 'Returning officer',
  witness: (n) => `Witness ${n}`,
  nameLine: 'Name',
  signLine: 'Signature',
  dateLine: 'Date',
  verify: 'Verify these results',
  verifyHint: 'Scan this code to see the results on the official page.',
  version: (v) => `Version ${v}`,
  hash: 'Verification hash (SHA-256)',
  generated: (at, by) => `Generated ${at} by ${by}`,
  page: 'Page',
  of: 'of',
  name: 'Name',
  membershipId: 'Membership ID',
  gender: 'Gender',
  phone: 'Phone',
  categories: 'Categories',
  allCategories: 'All',
  voted: 'Voted',
  notVoted: 'Not voted',
  sms: 'Code SMS',
  totals: (total, voted) => `Total ${total} · voted ${voted}`,
  genders: { male: 'Male', female: 'Female' },
  codeStatus: { not_sent: 'Not sent', sent: 'Sent', delivered: 'Delivered', failed: 'Failed' },
  eventStatus: {
    draft: 'Draft',
    scheduled: 'Scheduled',
    open: 'Open',
    closed: 'Closed',
    results_published: 'Results published',
    archived: 'Archived',
    cancelled: 'Cancelled',
  },
  audit: {
    sheet: 'Audit log',
    time: 'Time',
    user: 'User',
    action: 'Action',
    item: 'Item',
    itemId: 'Item ID',
    event: 'Event',
    ip: 'IP',
    reason: 'Reason',
    before: 'Before',
    after: 'After',
  },
};

export const reportText: Record<Language, ReportText> = { sw, en };
