import { describe, expect, it } from 'vitest';
import { fromPicker, toPicker } from './zonedTime';

describe('organization time zone in pickers', () => {
  it('shows a UTC instant at its wall clock in the organization zone', () => {
    const value = toPicker('2026-11-03T11:00:00.000Z', 'Africa/Dar_es_Salaam');
    expect(value.format('YYYY-MM-DD HH:mm')).toBe('2026-11-03 14:00');
  });

  it('reads a picked wall clock in the organization zone, whatever the browser zone', () => {
    const picked = toPicker('2026-11-03T11:00:00.000Z', 'Africa/Dar_es_Salaam');
    expect(fromPicker(picked, 'Africa/Dar_es_Salaam')).toBe('2026-11-03T11:00:00.000Z');
    expect(fromPicker(picked, 'UTC')).toBe('2026-11-03T14:00:00.000Z');
  });
});
