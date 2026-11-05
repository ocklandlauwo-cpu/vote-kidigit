import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatTime } from './format';

describe('date formats (Design System 11.5)', () => {
  const iso = '2026-11-03T11:00:00.000Z'; // 14:00 in Dar es Salaam (UTC+3)

  it('shows the organization time zone in 24-hour time', () => {
    expect(formatTime(iso, 'Africa/Dar_es_Salaam')).toBe('14:00');
    expect(formatTime(iso, 'UTC')).toBe('11:00');
  });

  it('writes dates with Swahili or English short months', () => {
    expect(formatDate(iso, 'Africa/Dar_es_Salaam', 'sw')).toBe('3 Nov 2026');
    expect(formatDate('2026-08-01T00:00:00Z', 'UTC', 'sw')).toBe('1 Ago 2026');
    expect(formatDate('2026-08-01T00:00:00Z', 'UTC', 'en')).toBe('1 Aug 2026');
    expect(formatDate('2026-03-15T12:00:00Z', 'UTC', 'sw')).toBe('15 Mac 2026');
  });

  it('joins date and time, with "saa" in Swahili', () => {
    expect(formatDateTime(iso, 'Africa/Dar_es_Salaam', 'sw')).toBe('3 Nov 2026, saa 14:00');
    expect(formatDateTime(iso, 'Africa/Dar_es_Salaam', 'en')).toBe('3 Nov 2026, 14:00');
  });

  it('changes the date across midnight in the organization time zone', () => {
    expect(formatDate('2026-12-31T22:30:00Z', 'Africa/Dar_es_Salaam', 'en')).toBe('1 Jan 2027');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatDateTime('not a date', 'UTC', 'sw')).toBe('');
  });
});
