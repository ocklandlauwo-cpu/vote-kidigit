// Kiosk sessions on the staff side (Backend Schema 7.4, 12.9; App Flow 10.1): launch on this
// device with a label and an exit PIN while the event is Scheduled or Open, list the running
// kiosks, end one from the portal. The device token is shown once and stored only as SHA-256.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  KioskSessionList,
  LaunchKioskRequest,
  LaunchKioskResponse,
} from '@vote-kidigit/shared';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../../audit/audit.service.js';
import { hashPassword } from '../../auth/passwords.js';
import { AppError } from '../../common/app-error.js';
import type { Env } from '../../config/env.schema.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';

export function kioskTokenHash(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(token).digest());
}

@Injectable()
export class KioskService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly requestContext: RequestContextService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  /** POST /events/:eventId/kiosk-sessions (KSK-00). */
  async launch(eventId: string, body: LaunchKioskRequest): Promise<LaunchKioskResponse> {
    const token = randomBytes(32).toString('base64url');
    const pinHash = await hashPassword(body.pin);
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.event(tx, eventId);
      if (event.status !== 'scheduled' && event.status !== 'open') {
        throw new AppError('INVALID_TRANSITION', 'Kiosks run only while the event is published.', {
          reason: 'NOT_PUBLISHED',
        });
      }
      const ctx = this.requestContext.getOrThrow();
      const session = await tx.kioskSession.create({
        data: {
          organizationId: ctx.orgId ?? '',
          eventId,
          deviceLabel: body.deviceLabel,
          tokenHash: kioskTokenHash(token),
          pinHash,
          launchedBy: ctx.userId ?? '',
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'kiosk.launch',
        entityType: 'kiosk_sessions',
        entityId: session.id,
        eventId,
        after: { deviceLabel: body.deviceLabel },
      });
      return { id: session.id, token, url: `${this.appUrl}/vote/kiosk/${token}` };
    });
  }

  /** GET /events/:eventId/kiosk-sessions: the kiosks still running. */
  list(eventId: string): Promise<KioskSessionList> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await this.event(tx, eventId);
      const rows = await tx.kioskSession.findMany({
        where: { eventId, endedAt: null },
        orderBy: { startedAt: 'asc' },
        select: {
          id: true,
          deviceLabel: true,
          startedAt: true,
          lastSeenAt: true,
          launcher: { select: { fullName: true } },
        },
      });
      return {
        items: rows.map((row) => ({
          id: row.id,
          deviceLabel: row.deviceLabel,
          launchedBy: row.launcher.fullName,
          startedAt: row.startedAt.toISOString(),
          lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        })),
      };
    });
  }

  /** POST /events/:eventId/kiosk-sessions/:sessionId/end: from the portal. */
  end(eventId: string, sessionId: string): Promise<void> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const ctx = this.requestContext.getOrThrow();
      const ended = await tx.kioskSession.updateMany({
        where: { id: sessionId, eventId, endedAt: null },
        data: { endedAt: new Date(), endedBy: ctx.userId },
      });
      if (ended.count === 0) throw new AppError('NOT_FOUND');
      await this.audit.record(tx, {
        action: 'kiosk.end',
        entityType: 'kiosk_sessions',
        entityId: sessionId,
        eventId,
      });
    });
  }

  private async event(tx: Tx, eventId: string) {
    const event = await tx.votingEvent.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { status: true },
    });
    if (!event) throw new AppError('NOT_FOUND');
    return event;
  }

  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
