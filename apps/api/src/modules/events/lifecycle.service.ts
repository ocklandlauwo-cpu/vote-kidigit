import { Injectable } from '@nestjs/common';
import {
  type CancelEventRequest,
  type ReopenEventRequest,
  ChecklistItemSchema,
  type EventDetail,
  type PublishEventRequestSchema,
} from '@vote-kidigit/shared';
import type { z } from 'zod';
import { AuditService } from '../../audit/audit.service.js';
import type { AuthState } from '../../auth/auth.types.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import type { EventStatus } from '../../generated/prisma/enums.js';
import { BatchesService } from '../messages/batches.service.js';
import { EventsService } from './events.service.js';

type PublishEvent = z.output<typeof PublishEventRequestSchema>;

/** Moves an event through app.transition_event(), the only way to change its status. */
export async function transitionEvent(
  tx: Tx,
  eventId: string,
  to: EventStatus,
  reason: string | null = null,
  newEndAt: Date | null = null,
  resultsToken: string | null = null,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM app.transition_event(${eventId}::uuid, ${to}::event_status, ${reason},
                                        ${newEndAt}::timestamptz, ${resultsToken})`;
}

/**
 * Event lifecycle actions of the header and More menu (Backend Schema 12.5, App Flow 6.8, 6.11):
 * publish (schedule or open now), unpublish, cancel and archive. The database decides whether a
 * move is allowed; the checks here only explain why not (failing checklist items, codes sent,
 * start time passed). Close freezes the results (and seals the ballots); reopen sets a new end.
 */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly batches: BatchesService,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * POST /events/:eventId/publish (EVT-08). From Draft, or "Open now" from Scheduled. With
   * "Send codes now" the voters whose code was not sent yet get it by SMS; that needs
   * messages.send as well, checked before anything changes.
   */
  async publish(actor: AuthState, eventId: string, body: PublishEvent): Promise<EventDetail> {
    if (body.sendCodes && !actor.permissions.includes('messages.send')) {
      throw new AppError('FORBIDDEN');
    }
    const detail = await this.publishIn(eventId, body);
    if (!body.sendCodes) return detail;
    await this.batches.send({
      eventId,
      type: 'code_delivery',
      channel: 'sms',
      audience: 'not_sent',
    });
    return this.prisma.withContext(this.context(), (tx) => this.events.detailIn(tx, eventId));
  }

  private publishIn(eventId: string, body: PublishEvent): Promise<EventDetail> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.find(tx, eventId);
      if (event.status === 'draft') {
        const rows = await tx.$queryRaw<unknown[]>`
          SELECT item, ok, detail FROM app.publish_checklist(${eventId}::uuid)`;
        const failing = rows.map((r) => ChecklistItemSchema.parse(r)).filter((i) => !i.ok);
        if (failing.length > 0) {
          throw new AppError('CHECKLIST_FAILED', 'The event is not ready to publish.', {
            items: failing,
          });
        }
      }
      if (body.mode === 'schedule') {
        if (event.status !== 'draft') throw this.invalid('NOT_DRAFT');
        if (event.startAt <= new Date()) throw this.invalid('START_PASSED');
      }
      if (body.mode === 'open_now' && event.endAt <= new Date()) throw this.invalid('END_PASSED');
      const to = body.mode === 'schedule' ? 'scheduled' : 'open';
      await transitionEvent(tx, eventId, to);
      await this.audit.record(tx, {
        action: to === 'open' ? 'event.open' : 'event.publish',
        entityType: 'voting_events',
        entityId: eventId,
        eventId,
        before: { status: event.status },
        after: { status: to, sendCodes: body.sendCodes },
      });
      return this.events.detailIn(tx, eventId);
    });
  }

  /** POST /events/:eventId/unpublish: Scheduled → Draft, until the first code SMS is sent. */
  unpublish(eventId: string): Promise<EventDetail> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.find(tx, eventId);
      if (event.status === 'scheduled' && event.firstCodeSentAt) throw this.invalid('CODES_SENT');
      await transitionEvent(tx, eventId, 'draft');
      await this.audit.record(tx, {
        action: 'event.unpublish',
        entityType: 'voting_events',
        entityId: eventId,
        eventId,
        before: { status: event.status },
        after: { status: 'draft' },
      });
      return this.events.detailIn(tx, eventId);
    });
  }

  /**
   * POST /events/:eventId/cancel: the typed name must match; the reason is kept and audited.
   * Voters who already received a code are told by SMS (App Flow 6.11).
   */
  async cancel(eventId: string, body: CancelEventRequest): Promise<EventDetail> {
    const detail = await this.cancelIn(eventId, body);
    if (detail.firstCodeSentAt) {
      await this.batches.send({
        eventId,
        type: 'event_cancelled',
        channel: 'sms',
        audience: 'all',
      });
    }
    return detail;
  }

  private cancelIn(eventId: string, body: CancelEventRequest): Promise<EventDetail> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.find(tx, eventId);
      if (body.confirmName.trim() !== event.name.trim()) {
        throw new AppError('VALIDATION_FAILED', 'Type the event name to confirm.', {
          source: 'body',
          issues: [{ path: 'confirmName', code: 'mismatch', message: 'does not match' }],
        });
      }
      await transitionEvent(tx, eventId, 'cancelled', body.reason);
      // Codes and reminders still on their way stop here.
      await tx.smsBatch.updateMany({
        where: { eventId, status: { in: ['queued', 'sending', 'paused'] } },
        data: { status: 'cancelled', completedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'event.cancel',
        entityType: 'voting_events',
        entityId: eventId,
        eventId,
        before: { status: event.status },
        after: { status: 'cancelled' },
        reason: body.reason,
      });
      return this.events.detailIn(tx, eventId);
    });
  }

  /** POST /events/:eventId/close (App Flow 6.11 "Close now"): seals ballots and freezes results. */
  close(eventId: string): Promise<EventDetail> {
    return this.prisma.withContext(
      this.context(),
      async (tx) => {
        const event = await this.find(tx, eventId);
        await transitionEvent(tx, eventId, 'closed');
        await this.audit.record(tx, {
          action: 'event.close',
          entityType: 'voting_events',
          entityId: eventId,
          eventId,
          before: { status: event.status },
          after: { status: 'closed' },
        });
        return this.events.detailIn(tx, eventId);
      },
      { timeout: 120_000 },
    );
  }

  /**
   * POST /events/:eventId/reopen: Closed → Open with a later end and a reason; ballots stay, the
   * frozen results are no longer current.
   */
  reopen(eventId: string, body: ReopenEventRequest): Promise<EventDetail> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.find(tx, eventId);
      await transitionEvent(tx, eventId, 'open', body.reason, new Date(body.newEndAt));
      await this.audit.record(tx, {
        action: 'event.reopen',
        entityType: 'voting_events',
        entityId: eventId,
        eventId,
        before: { status: event.status, endAt: event.endAt },
        after: { status: 'open', endAt: body.newEndAt },
        reason: body.reason,
      });
      return this.events.detailIn(tx, eventId);
    });
  }

  /** POST /events/:eventId/archive: Results Published or Cancelled → Archived (read-only). */
  archive(eventId: string): Promise<EventDetail> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.find(tx, eventId);
      await transitionEvent(tx, eventId, 'archived');
      await this.audit.record(tx, {
        action: 'event.archive',
        entityType: 'voting_events',
        entityId: eventId,
        eventId,
        before: { status: event.status },
        after: { status: 'archived' },
      });
      return this.events.detailIn(tx, eventId);
    });
  }

  private async find(tx: Tx, eventId: string) {
    const event = await tx.votingEvent.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        name: true,
        status: true,
        startAt: true,
        endAt: true,
        firstCodeSentAt: true,
      },
    });
    if (!event) throw new AppError('NOT_FOUND');
    return event;
  }

  private invalid(reason: string) {
    return new AppError('INVALID_TRANSITION', 'This change is not possible now.', { reason });
  }

  /** Platform administrators have no organization and no events of their own. */
  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
