import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER } from '@vote-kidigit/shared';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/app-error.js';
import { SKIP_CSRF } from './decorators.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Global guard (Backend Schema 8.1): state-changing requests made with a staff session must send
 * X-CSRF-Token equal to the session's token (returned by sign-in and GET /me). Requests without
 * a staff session (voter API with bearer tokens, webhooks) are not cookie-authenticated and are
 * not checked here. Runs after AuthGuard.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const expected = req.session?.userId ? req.session.csrf : undefined;
    if (!expected) return true;

    const supplied = req.header(CSRF_HEADER);
    if (supplied && timingSafeEqual(digest(supplied), digest(expected))) return true;
    throw new AppError('FORBIDDEN', 'Missing or invalid CSRF token.', { reason: 'csrf' });
  }
}
