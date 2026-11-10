import { type CategoryRules, DEFAULT_CATEGORY_RULES } from '@vote-kidigit/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { i18n } from '../../../i18n';
import { ruleSentence, ruleSummary, windowText } from './ruleText';

const rules = (change: Partial<CategoryRules>): CategoryRules => ({
  ...DEFAULT_CATEGORY_RULES,
  ...change,
});

describe('rule words (App Flow 6.4)', () => {
  afterAll(() => i18n.changeLanguage('sw'));

  it('says the App Flow examples in English', async () => {
    await i18n.changeLanguage('en');
    const t = i18n.t.bind(i18n);
    expect(ruleSummary(t, DEFAULT_CATEGORY_RULES)).toBe(
      'Choose exactly 1 · 1 seat · skipping not allowed',
    );
    const range = rules({ selectionMode: 'range', minCount: 1, maxCount: 3, seats: 3 });
    expect(ruleSentence(t, range)).toBe('Voters choose between 1 and 3 contesters. Top 3 win.');
    expect(ruleSummary(t, { ...range, allowSkip: true })).toBe(
      'Choose between 1 and 3 · 3 seats · skipping allowed',
    );
  });

  it('describes skipping, the threshold and the quorum in Swahili', async () => {
    await i18n.changeLanguage('sw');
    const t = i18n.t.bind(i18n);
    expect(
      ruleSentence(
        t,
        rules({ allowSkip: true, winnerRule: 'threshold', thresholdPct: 50.5, quorumPct: 60 }),
      ),
    ).toBe(
      'Wapiga kura wanachagua mgombea 1. Wanaweza kuruka nafasi hii. ' +
        'Mshindi lazima apate angalau 50.5% ya kura halali. ' +
        'Matokeo ni halali tu ikiwa angalau 60% ya wapiga kura wanaostahili watapiga kura.',
    );
    expect(ruleSentence(t, rules({ exactCount: 2, seats: 2 }))).toBe(
      'Wapiga kura wanachagua wagombea 2. Wagombea 2 wenye kura nyingi zaidi wanashinda.',
    );
  });

  it('names the voting window', async () => {
    await i18n.changeLanguage('en');
    const t = i18n.t.bind(i18n);
    const at = (iso: string) => iso.slice(11, 16);
    const opens = '2026-11-20T05:00:00.000Z';
    const closes = '2026-11-20T09:00:00.000Z';
    expect(windowText(t, { opensAt: null, closesAt: null }, at)).toBe('Whole event window');
    expect(windowText(t, { opensAt: opens, closesAt: closes }, at)).toBe('05:00 – 09:00');
    expect(windowText(t, { opensAt: opens, closesAt: null }, at)).toBe('From 05:00');
    expect(windowText(t, { opensAt: null, closesAt: closes }, at)).toBe('Until 09:00');
  });
});
