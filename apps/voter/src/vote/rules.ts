// Selection rules of a category on the voter's side (App Flow 8.1 VTR-WEB-04, Design System
// 10.3–10.5). The database re-checks everything (app.cast_ballot); these only drive the screen.
import type { BallotCategory } from '@vote-kidigit/shared';

/** What the voter chose in one category. */
export type Choice =
  { kind: 'contesters'; ids: string[] } | { kind: 'yes' } | { kind: 'no' } | { kind: 'skipped' };

export function maxChoices(category: BallotCategory): number {
  const { rules } = category;
  if (rules.yesNo) return 1;
  return (rules.selectionMode === 'exact' ? rules.exactCount : rules.maxCount) ?? 1;
}

export function minChoices(category: BallotCategory): number {
  const { rules } = category;
  return (rules.selectionMode === 'exact' ? rules.exactCount : rules.minCount) ?? 1;
}

/** Single choice: tapping another card replaces the selection (radio). */
export function isSingle(category: BallotCategory): boolean {
  return !category.rules.yesNo && maxChoices(category) === 1;
}

/** "Inayofuata" is enabled only when the rule is met. */
export function ruleMet(category: BallotCategory, choice: Choice | undefined): boolean {
  if (!choice) return false;
  if (choice.kind === 'skipped') return category.rules.allowSkip;
  if (category.rules.yesNo) return choice.kind === 'yes' || choice.kind === 'no';
  if (choice.kind !== 'contesters') return false;
  const n = choice.ids.length;
  return n >= minChoices(category) && n <= maxChoices(category);
}

/** Toggles a contester; in multi-select, nothing more can be added once the limit is reached. */
export function toggle(category: BallotCategory, choice: Choice | undefined, id: string): Choice {
  const ids = choice?.kind === 'contesters' ? choice.ids : [];
  if (isSingle(category)) return { kind: 'contesters', ids: [id] };
  if (ids.includes(id)) return { kind: 'contesters', ids: ids.filter((x) => x !== id) };
  if (ids.length >= maxChoices(category)) return { kind: 'contesters', ids };
  return { kind: 'contesters', ids: [...ids, id] };
}

/** Multi-select with the limit reached: unselected cards are disabled. */
export function limitReached(category: BallotCategory, choice: Choice | undefined): boolean {
  return (
    !isSingle(category) &&
    !category.rules.yesNo &&
    choice?.kind === 'contesters' &&
    choice.ids.length >= maxChoices(category)
  );
}

/** The request selection for app.cast_ballot. */
export function toSelection(category: BallotCategory, choice: Choice) {
  if (choice.kind === 'skipped') {
    return { categoryId: category.id, choice: 'skipped' as const, contesterIds: [] };
  }
  if (choice.kind === 'yes' || choice.kind === 'no') {
    return {
      categoryId: category.id,
      choice: choice.kind,
      contesterIds: category.contesters.slice(0, 1).map((c) => c.id),
    };
  }
  return { categoryId: category.id, choice: 'contester' as const, contesterIds: choice.ids };
}
