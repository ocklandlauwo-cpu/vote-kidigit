// Dates and times for display (Design System 11.5): stored in UTC, shown in the organization's
// time zone. Swahili: "3 Nov 2026, saa 14:00" with the months Jan, Feb, Mac, Apr, Mei, Jun, Jul,
// Ago, Sep, Okt, Nov, Des; English: "3 Nov 2026, 14:00".
import type { Language } from '@vote-kidigit/shared';

export const DEFAULT_TIME_ZONE = 'Africa/Dar_es_Salaam';

const MONTHS: Record<Language, string[]> = {
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

interface Parts {
  day: number;
  month: number;
  year: number;
  hour: string;
  minute: string;
}

function parts(iso: string, timeZone: string): Parts | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const values: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)) {
    values[part.type] = part.value;
  }
  return {
    day: Number(values.day),
    month: Number(values.month),
    year: Number(values.year),
    hour: values.hour ?? '00',
    minute: values.minute ?? '00',
  };
}

/** "3 Nov 2026" */
export function formatDate(iso: string, timeZone: string, language: Language): string {
  const p = parts(iso, timeZone);
  if (!p) return '';
  return `${p.day} ${MONTHS[language][p.month - 1]} ${p.year}`;
}

/** "14:00" (24-hour) */
export function formatTime(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return p ? `${p.hour}:${p.minute}` : '';
}

/** "3 Nov 2026, saa 14:00" / "3 Nov 2026, 14:00" */
export function formatDateTime(iso: string, timeZone: string, language: Language): string {
  const date = formatDate(iso, timeZone, language);
  if (!date) return '';
  const time = formatTime(iso, timeZone);
  return language === 'sw' ? `${date}, saa ${time}` : `${date}, ${time}`;
}
