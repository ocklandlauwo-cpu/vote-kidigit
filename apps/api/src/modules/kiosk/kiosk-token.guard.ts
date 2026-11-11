// The kiosk device's token (X-Kiosk-Token) on /vote/kiosk/* routes. Resolves the running session
// through app.resolve_kiosk_token() and acts in its organization as "Kiosk: {device label}".
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import { kioskTokenHash } from './kiosk.service.js';

export const KIOSK_HEADER = 'x-kiosk-token';

export interface KioskDevice {
  sessionId: string;
  orgId: string;
  eventId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own extension point
  namespace Express {
    interface Request {
      /** Set by KioskTokenGuard on kiosk device routes. */
      kiosk?: KioskDevice;
    }
  }
}

/** The running kiosk session behind a token, or null (ended, unknown, malformed). */
export async function resolveKiosk(
  prisma: PrismaService,
  requestContext: RequestContextService,
  token: string,
): Promise<KioskDevice | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const ctx = { ...requestContext.getOrThrow(), orgId: null, isPlatformAdmin: false };
  const [row] = await prisma.withContext(
    ctx,
    (tx) =>
      tx.$queryRaw<{ session_id: string; organization_id: string; event_id: string }[]>`
      SELECT session_id, organization_id, event_id
      FROM app.resolve_kiosk_token(${kioskTokenHash(token)})`,
  );
  return row
    ? { sessionId: row.session_id, orgId: row.organization_id, eventId: row.event_id }
    : null;
}

@Injectable()
export class KioskTokenGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers[KIOSK_HEADER];
    const token = typeof header === 'string' ? header : '';
    const kiosk = token ? await resolveKiosk(this.prisma, this.requestContext, token) : null;
    // The device shows that the kiosk session has ended.
    if (!kiosk) throw new AppError('UNAUTHENTICATED');
    req.kiosk = kiosk;
    const ctx = this.requestContext.getOrThrow();
    ctx.orgId = kiosk.orgId;
    ctx.actorType = 'system';
    ctx.actorLabel = 'Kiosk';
    return true;
  }
}

export const CurrentKiosk = createParamDecorator<unknown, KioskDevice>(
  (_data: unknown, ctx: ExecutionContext) => {
    const kiosk = ctx.switchToHttp().getRequest<Request>().kiosk;
    if (!kiosk) throw new AppError('UNAUTHENTICATED');
    return kiosk;
  },
);
