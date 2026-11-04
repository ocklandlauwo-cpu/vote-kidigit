import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SESSION_EXPIRES_HEADER } from '@vote-kidigit/shared';
import type { Request, Response } from 'express';
import { AppError } from '../common/app-error.js';
import { RequestContextService } from '../context/request-context.js';
import { AuthStateService } from './auth-state.service.js';
import { IS_PUBLIC } from './decorators.js';

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve) => req.session.destroy(() => resolve()));
}

/**
 * Global guard (Backend Schema 8.1, 9.3 steps 1–2): every route needs a signed-in staff user
 * unless marked @Public(). On each request the user's status, organization, role and
 * permissions are re-read (30 s cache); a deactivated user or a suspended organization ends the
 * session at once. Fills the request context (RLS identity and audit actor) and announces when
 * the session will expire without further activity.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authState: AuthStateService,
    private readonly requestContext: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const data = req.session;
    if (!data?.userId) throw new AppError('UNAUTHENTICATED');

    const state = await this.authState.get({
      userId: data.userId,
      orgId: data.orgId ?? null,
      isPlatformAdmin: data.isPlatformAdmin ?? false,
    });
    if (!state) {
      await destroySession(req);
      throw new AppError('UNAUTHENTICATED');
    }

    // The organization may have changed its timeout since sign-in.
    if (data.timeoutMinutes !== state.sessionTimeoutMinutes) {
      data.timeoutMinutes = state.sessionTimeoutMinutes;
      data.cookie.maxAge = state.sessionTimeoutMinutes * 60_000;
    }

    req.auth = state;
    const ctx = this.requestContext.getOrThrow();
    ctx.orgId = state.orgId;
    ctx.userId = state.userId;
    ctx.isPlatformAdmin = state.isPlatformAdmin;
    ctx.actorType = 'user';
    ctx.actorLabel = `${state.fullName} <${state.email}>`;

    res.setHeader(
      SESSION_EXPIRES_HEADER,
      new Date(Date.now() + state.sessionTimeoutMinutes * 60_000).toISOString(),
    );
    return true;
  }
}
