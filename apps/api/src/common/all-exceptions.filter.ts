import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import * as Sentry from '@sentry/nestjs';
import { type ErrorCode, type ErrorResponse, isErrorCode } from '@vote-kidigit/shared';
import type { Response } from 'express';
import { AppError } from './app-error.js';
import { appErrorFromDatabase } from './db-errors.js';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'NOT_FOUND',
  413: 'FILE_TOO_LARGE',
  415: 'FILE_TYPE',
  429: 'RATE_LIMITED',
};

/** Normalizes anything thrown into an AppError (Backend Schema 12.1 codes and statuses). */
export function toAppError(exception: unknown): AppError {
  if (exception instanceof AppError) return exception;
  if (exception instanceof ThrottlerException) return new AppError('RATE_LIMITED');
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    const declared =
      typeof response === 'object' && response !== null && 'code' in response
        ? response.code
        : undefined;
    if (isErrorCode(declared)) return new AppError(declared);
    const status = exception.getStatus();
    // The framework's own message (e.g. body-parser's) may quote the request body: not reused.
    return new AppError(
      CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED'),
    );
  }
  return appErrorFromDatabase(exception) ?? new AppError('INTERNAL');
}

/**
 * Every HTTP error leaves the API as { code, message, details? } (Backend Schema 12.1).
 * Unexpected errors become 500 INTERNAL with a generic message; they are logged with their
 * stack (through the redacting JSON logger) and reported to Sentry. Expected 4xx errors are
 * logged at debug level with their code only.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const error = toAppError(exception);

    if (error.status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception : new Error(String(exception)),
        exception instanceof Error ? exception.stack : undefined,
      );
      Sentry.captureException(exception);
    } else {
      this.logger.debug({ msg: 'request rejected', errorCode: error.code, status: error.status });
    }

    if (response.headersSent) return;
    const body: ErrorResponse = {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
    response.status(error.status).json(body);
  }
}
