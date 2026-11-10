// The words for a category's rules (App Flow 6.4): the short summary on the card ("Choose
// exactly 1 · 1 seat · skipping not allowed"), the live sentence of the rules panel ("Voters
// choose between 1 and 3 contesters. Top 3 win.") and the voting window line.
import type { Category, CategoryRules } from '@vote-kidigit/shared';
import type { TFunction } from 'i18next';

export function ruleSummary(t: TFunction, rules: CategoryRules): string {
  const choose =
    rules.selectionMode === 'exact'
      ? t('categories.summary.exact', { count: rules.exactCount ?? 1 })
      : t('categories.summary.range', { min: rules.minCount ?? 1, max: rules.maxCount ?? 1 });
  return [
    choose,
    t('categories.summary.seats', { count: rules.seats }),
    t(rules.allowSkip ? 'categories.summary.skipAllowed' : 'categories.summary.skipNotAllowed'),
  ].join(' · ');
}

/** A percentage as people write it: 50, 50.5, 66.67. */
const pct = (value: number) => String(Number(value.toFixed(2)));

export function ruleSentence(t: TFunction, rules: CategoryRules): string {
  const parts = [
    rules.selectionMode === 'exact'
      ? t('categories.rules.sentence.exact', { count: rules.exactCount ?? 1 })
      : t('categories.rules.sentence.range', {
          min: rules.minCount ?? 1,
          max: rules.maxCount ?? 1,
        }),
  ];
  if (rules.allowSkip) parts.push(t('categories.rules.sentence.skip'));
  parts.push(
    rules.winnerRule === 'threshold' && rules.thresholdPct !== null
      ? t('categories.rules.sentence.threshold', {
          count: rules.seats,
          pct: pct(rules.thresholdPct),
        })
      : t('categories.rules.sentence.plurality', { count: rules.seats }),
  );
  if (rules.quorumPct !== null) {
    parts.push(t('categories.rules.sentence.quorum', { pct: pct(rules.quorumPct) }));
  }
  return parts.join(' ');
}

export function windowText(
  t: TFunction,
  category: Pick<Category, 'opensAt' | 'closesAt'>,
  dateTime: (iso: string) => string,
): string {
  const { opensAt, closesAt } = category;
  if (opensAt && closesAt) {
    return t('categories.window.range', { from: dateTime(opensAt), to: dateTime(closesAt) });
  }
  if (opensAt) return t('categories.window.from', { from: dateTime(opensAt) });
  if (closesAt) return t('categories.window.until', { to: dateTime(closesAt) });
  return t('categories.window.none');
}
