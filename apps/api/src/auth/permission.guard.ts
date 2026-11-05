import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type PermissionKey, permissionScope } from '@vote-kidigit/shared';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import { isUuid } from '../common/id-param.pipe.js';
import { PrismaService } from '../database/prisma.service.js';
import { RequestContextService } from '../context/request-context.js';
import { IS_PUBLIC, REQUIRED_PERMISSION, SIGNED_IN } from './decorators.js';
import { EVENT_ACCESS, type EventAccess } from './event-access.js';

/**
 * Global guard after AuthGuard (Backend Schema 9.3 steps 3–6). Steps 1–2 (session, active user
 * and organization) are AuthGuard's. Default-deny: a route without @Public, @SignedIn or
 * @RequirePermission is refused, so a forgotten decorator fails closed.
 *
 * Other-organization and unassigned events answer 404, not 403, so their existence is not
 * revealed (App Flow 3.7); a missing permission answers 403 (the UI greys the button).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    @Inject(EVENT_ACCESS) private readonly events: EventAccess,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const key = this.reflector.getAllAndOverride<PermissionKey | undefined>(
      REQUIRED_PERMISSION,
      targets,
    );
    const signedIn = this.reflector.getAllAndOverride<boolean>(SIGNED_IN, targets);
    const name = `${context.getClass().name}.${context.getHandler().name}`;
    if (!key && !signedIn) {
      throw new Error(`${name} has no @Public, @SignedIn or @RequirePermission decorator`);
    }

    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHENTICATED'); // AuthGuard runs first
    if (!key) return true;

    const scope = permissionScope(key);
    if (!scope) throw new Error(`${name} requires unknown permission ${key}`);
    if (scope === 'platform') {
      if (!auth.isPlatformAdmin) throw new AppError('NOT_FOUND');
      return true;
    }
    if (!auth.permissions.includes(key)) throw new AppError('FORBIDDEN');
    if (scope === 'org') return true;

    const eventId = req.params.eventId;
    if (typeof eventId !== 'string') {
      throw new Error(`${name} requires event permission ${key} but has no :eventId parameter`);
    }
    if (!isUuid(eventId)) throw new AppError('NOT_FOUND');
    const { orgId, userId, isPlatformAdmin, requestId } = this.requestContext.getOrThrow();
    const allowed = await this.prisma.withContext(
      { orgId, userId, isPlatformAdmin, requestId },
      async (tx) =>
        (await this.events.eventExists(tx, eventId)) &&
        (auth.permissions.includes('event.access_all') ||
          (await this.events.isAssigned(tx, eventId, auth.userId))),
    );
    if (!allowed) throw new AppError('NOT_FOUND');
    return true;
  }
}
