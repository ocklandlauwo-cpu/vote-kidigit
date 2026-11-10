import { afterAll, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n';
import { durationText } from './countdown';

const MINUTE = 60_000;

describe('durationText', () => {
  afterAll(() => i18n.changeLanguage('sw'));

  it('names the two largest units, rounding up to whole minutes', async () => {
    await i18n.changeLanguage('en');
    const t = i18n.t.bind(i18n);
    expect(durationText(t, 24 * 60 * MINUTE - 30_000)).toBe('1 day');
    expect(durationText(t, 23 * 60 * MINUTE + 59 * MINUTE + 1)).toBe('1 day');
    expect(durationText(t, 2 * 24 * 60 * MINUTE + 3 * 60 * MINUTE)).toBe('2 days, 3 hours');
    expect(durationText(t, 90 * MINUTE)).toBe('1 hour, 30 minutes');
    expect(durationText(t, 60 * MINUTE)).toBe('1 hour');
    expect(durationText(t, 1)).toBe('1 minute');
  });

  it('speaks Swahili', async () => {
    await i18n.changeLanguage('sw');
    expect(durationText(i18n.t.bind(i18n), 2 * 24 * 60 * MINUTE + 3 * 60 * MINUTE)).toBe(
      'siku 2, saa 3',
    );
  });
});
