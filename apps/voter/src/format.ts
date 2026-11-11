// Dates and times on voter screens (Design System 11.5), in the organization's time zone:
// "3 Nov 2026", "14:00", "3 Nov 2026, saa 14:00". The same rules as the staff portal's format.ts.
const MONTHS_SW = [
  'Jan',
  'Feb',
  'Mac',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

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
export function formatDate(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return p ? `${p.day} ${MONTHS_SW[p.month - 1]} ${p.year}` : '';
}

/** "14:00" */
export function formatTime(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return p ? `${p.hour}:${p.minute}` : '';
}

/** "3 Nov 2026, saa 14:00" */
export function formatDateTime(iso: string, timeZone: string): string {
  const date = formatDate(iso, timeZone);
  return date ? `${date}, saa ${formatTime(iso, timeZone)}` : '';
}

/** Whole days, hours and minutes until `iso` (never negative). */
export function remaining(
  iso: string,
  now: number,
): { days: number; hours: number; minutes: number } {
  const total = Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60_000));
  return {
    days: Math.floor(total / 1440),
    hours: Math.floor((total % 1440) / 60),
    minutes: total % 60,
  };
}

/** "Juma Ali Mohamed" → "JM" for the neutral initials avatar. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** The first name for "Asante {first name}". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
/** "k7m4q9xr" → "K7M4-Q9XR" while typing. */
export function formatCodeInput(value: string): string {
  const plain = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return plain.length > 4 ? `${plain.slice(0, 4)}-${plain.slice(4)}` : plain;
}
