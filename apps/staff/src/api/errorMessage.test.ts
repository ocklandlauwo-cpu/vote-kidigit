// Generic error messages (App Flow 13.2): codes a staff user can meet on any screen get their
// own words, never "Something went wrong" for a refusal.
import { describe, expect, it } from 'vitest';
import { i18n } from '../i18n';
import { ApiError } from './client';
import { errorMessage } from './errorMessage';

const t = i18n.getFixedT('en');
const message = (
  code: ConstructorParameters<typeof ApiError>[1],
  details?: Record<string, unknown>,
) => errorMessage(t, new ApiError(409, code, 'x', details));

describe('errorMessage', () => {
  it('explains refusals instead of reporting a server error', () => {
    expect(message('EVENT_LOCKED')).toBe(
      'This event was published and can no longer be edited. Reload the page to see its current state.',
    );
    expect(message('INVALID_TRANSITION')).toBe(
      'This action is no longer allowed. Reload the page to see the current state.',
    );
    expect(message('INVALID_TRANSITION', { reason: 'ONLY_MODERATOR' })).toBe(
      'This user is the only moderator of an open event. Assign another moderator to it first.',
    );
    expect(message('UNRESOLVED_TIES')).toBe('Resolve all ties before publishing results.');
    expect(message('NOT_FOUND')).toBe('We couldn’t find that. It may have been deleted.');
  });

  it('keeps the server error for unknown failures', () => {
    expect(errorMessage(t, new Error('boom'))).toBe('Something went wrong on our side. Try again.');
    expect(message('INTERNAL')).toBe('Something went wrong on our side. Try again.');
  });
});
