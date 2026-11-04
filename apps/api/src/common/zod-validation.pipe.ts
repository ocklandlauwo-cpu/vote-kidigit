import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from './app-error.js';

const SCHEMA = Symbol('zodSchema');

interface ZodDtoClass {
  [SCHEMA]: z.ZodType;
}

/**
 * Turns a shared Zod schema into a class usable as a parameter type, so the global
 * ZodValidationPipe knows how to validate it (Tech Stack 6.3: Zod instead of class-validator):
 *
 *   class LoginBody extends zodDto(LoginRequestSchema) {}
 *   login(@Body() body: LoginBody) { … }
 */
export function zodDto<S extends z.ZodType>(schema: S) {
  class ZodDto {
    static readonly [SCHEMA] = schema;
  }
  return ZodDto as unknown as { new (): z.output<S>; readonly [SCHEMA]: S };
}

function schemaOf(metatype: unknown): z.ZodType | undefined {
  return typeof metatype === 'function' && SCHEMA in metatype
    ? (metatype as unknown as ZodDtoClass)[SCHEMA]
    : undefined;
}

/**
 * Global pipe: validates (and coerces / strips) every body, query and param whose type was made
 * with zodDto. Failures become 400 VALIDATION_FAILED with the path, code and message of each
 * issue; the rejected input is never echoed back or logged.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = schemaOf(metadata.metatype);
    if (!schema) return value;

    const result = schema.safeParse(value);
    if (result.success) return result.data;
    throw new AppError('VALIDATION_FAILED', undefined, {
      source: metadata.type,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });
  }
}
