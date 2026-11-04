import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';
import type { Request } from 'express';
import { IS_PUBLIC } from './decorators.js';

/**
 * Rate limits per staff session on routes that require one (Backend Schema 12.1: 300 / min per
 * session), and per client IP everywhere else. Public routes such as sign-in always use the IP,
 * so holding (or cycling) sessions cannot reset their limits.
 */
@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  protected override handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, getTracker } = requestProps;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    return super.handleRequest({
      ...requestProps,
      getTracker: (req, ctx) => {
        const request = req as unknown as Request;
        if (!isPublic && request.session?.userId) return `session:${request.sessionID}`;
        return getTracker(req, ctx);
      },
    });
  }
}
