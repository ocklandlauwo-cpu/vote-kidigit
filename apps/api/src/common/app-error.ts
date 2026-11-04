import { type ErrorCode, errorMessages, errorStatus } from '@vote-kidigit/shared';

/**
 * An expected, user-facing failure with a stable code (Backend Schema 12.1). Throw it from
 * services and guards; AllExceptionsFilter turns it into { code, message, details } with the
 * code's HTTP status. `details` must never contain secrets, codes or ballot choices.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string = errorMessages[code],
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = errorStatus[code];
  }
}
