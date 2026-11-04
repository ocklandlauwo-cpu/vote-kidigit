import { isErrorCode } from '@vote-kidigit/shared';
import { AppError } from './app-error.js';

interface DriverAdapterCause {
  originalCode?: unknown;
  originalMessage?: unknown;
}

interface PrismaLikeError {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  /** Query errors: the driver adapter's details sit under meta. */
  meta?: { driverAdapterError?: { cause?: DriverAdapterCause } };
  /** Errors at COMMIT (deferred constraint triggers) arrive as a bare DriverAdapterError. */
  cause?: DriverAdapterCause;
}

/** "Raw query failed. Code: `P0001`. Message: `LAST_SUPER_ADMIN`" and similar Prisma texts. */
const P0001_MESSAGE = /P0001[\s\S]*?\b([A-Z][A-Z_]{2,})\b/;

/**
 * Maps database errors to API errors. Database functions and triggers raise business rules as
 * ERRCODE P0001 with an API error code as the message (Backend Schema 11); those become that
 * code. RLS write violations become NOT_FOUND, so another organization's data is not revealed.
 * Anything else returns undefined and is treated as an internal error.
 */
export function appErrorFromDatabase(error: unknown): AppError | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const { name, code, message, meta } = error as PrismaLikeError;
  const cause =
    meta?.driverAdapterError?.cause ??
    (name === 'DriverAdapterError' ? (error as PrismaLikeError).cause : undefined);

  if (name === 'DriverAdapterError' && isErrorCode(message) && !cause?.originalCode) {
    return new AppError(message);
  }

  if (cause?.originalCode === 'P0001' && isErrorCode(cause.originalMessage)) {
    return new AppError(cause.originalMessage);
  }
  if (typeof message === 'string') {
    const match = P0001_MESSAGE.exec(message);
    if (match?.[1] && isErrorCode(match[1])) return new AppError(match[1]);
    if (/row-level security/i.test(message)) return new AppError('NOT_FOUND');
  }
  if (
    cause?.originalCode === '42501' &&
    /row-level security/i.test(String(cause.originalMessage))
  ) {
    return new AppError('NOT_FOUND');
  }
  // P2025: an update or delete matched no row (or RLS hid it)
  if (code === 'P2025') return new AppError('NOT_FOUND');
  return undefined;
}
