import { Injectable, type PipeTransform } from '@nestjs/common';
import { AppError } from './app-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Path IDs (Backend Schema 12.1: UUID strings in paths). A malformed ID names no record, so it
 * answers 404 like a missing one: @Param('orgId', IdParamPipe).
 */
@Injectable()
export class IdParamPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isUuid(value)) throw new AppError('NOT_FOUND');
    return value.toLowerCase();
  }
}
