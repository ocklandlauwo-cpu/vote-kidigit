import type { TFunction } from 'i18next';
import { isApiError } from './client';

/**
 * The generic message for an error no screen handles specifically (App Flow 13). Screens map
 * their own codes first (e.g. INVALID_CREDENTIALS on AUTH-01).
 */
export function errorMessage(t: TFunction, error: unknown): string {
  if (!isApiError(error)) return t('errors.server');
  switch (error.code) {
    case 'NETWORK':
      return t('errors.network');
    case 'RATE_LIMITED':
      return t('errors.rateLimited');
    case 'FORBIDDEN':
      return t('errors.forbidden');
    case 'VALIDATION_FAILED':
      return t('errors.validation');
    case 'NOT_FOUND':
      return t('errors.notFound');
    case 'EVENT_LOCKED':
      return t('errors.eventLocked');
    case 'RESULTS_PUBLISHED':
      return t('errors.resultsPublished');
    case 'UNRESOLVED_TIES':
      return t('errors.unresolvedTies');
    case 'INVALID_TRANSITION':
      // Someone else changed the state first, or (users) the only moderator of an Open event.
      return t(
        error.details?.reason === 'ONLY_MODERATOR' ? 'errors.onlyModerator' : 'errors.notAllowed',
      );
    default:
      return t('errors.server');
  }
}
