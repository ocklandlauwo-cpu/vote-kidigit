import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import type { AuthState } from './auth.types.js';

export const IS_PUBLIC = 'vk:isPublic';
export const SKIP_CSRF = 'vk:skipCsrf';

/**
 * Route needs no staff session (sign-in, health, voter API, USSD, webhooks, public results).
 * Every other route requires a signed-in, active staff user (AuthGuard is global).
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** State-changing route that cannot carry the CSRF token yet (sign-in creates it). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

/** The signed-in staff user (AuthGuard has run). */
export const CurrentAuth = createParamDecorator<unknown, AuthState>(
  (_data: unknown, ctx: ExecutionContext) => {
    const auth = ctx.switchToHttp().getRequest<Request>().auth;
    if (!auth) throw new AppError('UNAUTHENTICATED');
    return auth;
  },
);

export type { AuthState };
