import { describe, expect, it } from 'vitest';
import { category } from '../dev/fixtures';
import { limitReached, ruleMet, toggle, toSelection } from './rules';

describe('selection rules', () => {
  const exactOne = category('Mwenyekiti', ['A', 'B', 'C']);
  const range = category('Wajumbe', ['A', 'B', 'C', 'D'], {
    selectionMode: 'range',
    exactCount: null,
    minCount: 1,
    maxCount: 2,
  });
  const exactTwo = category('Kamati', ['A', 'B', 'C'], { exactCount: 2 });
  const yesNo = category('Mweka hazina', ['A'], { allowSkip: true });
  const id = (c: typeof exactOne, i: number) => c.contesters[i]?.id ?? '';

  it('single choice replaces the selection and is met with one', () => {
    let choice = toggle(exactOne, undefined, id(exactOne, 0));
    choice = toggle(exactOne, choice, id(exactOne, 1));
    expect(choice).toEqual({ kind: 'contesters', ids: [id(exactOne, 1)] });
    expect(ruleMet(exactOne, choice)).toBe(true);
    expect(ruleMet(exactOne, undefined)).toBe(false);
    expect(limitReached(exactOne, choice)).toBe(false);
  });

  it('range: met between min and max, nothing added past the limit', () => {
    let choice = toggle(range, undefined, id(range, 0));
    expect(ruleMet(range, choice)).toBe(true);
    choice = toggle(range, choice, id(range, 1));
    expect(limitReached(range, choice)).toBe(true);
    expect(toggle(range, choice, id(range, 2))).toEqual(choice);
    choice = toggle(range, choice, id(range, 0));
    expect(choice).toEqual({ kind: 'contesters', ids: [id(range, 1)] });
    expect(limitReached(range, choice)).toBe(false);
    expect(ruleMet(range, { kind: 'contesters', ids: [] })).toBe(false);
  });

  it('exact two: met only with two', () => {
    const one = toggle(exactTwo, undefined, id(exactTwo, 0));
    expect(ruleMet(exactTwo, one)).toBe(false);
    expect(ruleMet(exactTwo, toggle(exactTwo, one, id(exactTwo, 2)))).toBe(true);
  });

  it('Yes/No and skip', () => {
    expect(ruleMet(yesNo, { kind: 'yes' })).toBe(true);
    expect(ruleMet(yesNo, { kind: 'no' })).toBe(true);
    expect(ruleMet(yesNo, { kind: 'skipped' })).toBe(true);
    expect(ruleMet(exactOne, { kind: 'skipped' })).toBe(false);
    expect(toSelection(yesNo, { kind: 'no' })).toEqual({
      categoryId: yesNo.id,
      choice: 'no',
      contesterIds: [id(yesNo, 0)],
    });
    expect(toSelection(yesNo, { kind: 'skipped' })).toEqual({
      categoryId: yesNo.id,
      choice: 'skipped',
      contesterIds: [],
    });
  });
});
