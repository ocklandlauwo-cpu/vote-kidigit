import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService, systemContext } from '../../context/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import { BatchesService } from '../messages/batches.service.js';
import { transitionEvent } from './lifecycle.service.js';

/** How often the worker sweeps (Backend Schema 11.9): an event opens within a minute. */
export const SWEEP_EVERY_MS = 60_000;

const DueSchema = z.object({
  event_id: z.uuid(),
  category_id: z.uuid().nullable(),
  organization_id: z.uuid(),
  action: z.enum([
    'open_event',
    'close_event',
    'close_category',
    'reminder_before_open',
    'reminder_before_close',
  ]),
});
type Due = z.infer<typeof DueSchema>;

export interface SweepResult {
  opened: number;
  closedCategories: number;
  reminders: number;
  failed: number;
}

/**
 * The worker's 1-minute sweep: app.due_transitions() names what is due across organizations, and
 * each item is then done inside its own organization (RLS, triggers and app.transition_event()
 * all apply), audited as System. One failing item is logged and does not stop the others.
 * Closing whole events needs the results freeze and arrives in step 27.
 */
@Injectable()
export class SchedulerRunner {
  private readonly logger = new Logger(SchedulerRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly batches: BatchesService,
    private readonly requestContext: RequestContextService,
  ) {}

  async sweep(now = new Date()): Promise<SweepResult> {
    const requestId = randomUUID();
    const due = await this.requestContext.run(systemContext(requestId), () =>
      this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) =>
        (await tx.$queryRaw<unknown[]>`SELECT * FROM app.due_transitions(${now}::timestamptz)`).map(
          (row) => DueSchema.parse(row),
        ),
      ),
    );
    const result: SweepResult = { opened: 0, closedCategories: 0, reminders: 0, failed: 0 };
    for (const item of due) {
      if (item.action === 'close_event') continue; // step 27
      try {
        await this.requestContext.run(systemContext(requestId, item.organization_id), () =>
          this.apply(item),
        );
        if (item.action === 'open_event') result.opened += 1;
        else if (item.action === 'close_category') result.closedCategories += 1;
        else result.reminders += 1;
      } catch (error: unknown) {
        result.failed += 1;
        this.logger.warn({
          message: 'Scheduled transition failed',
          action: item.action,
          eventId: item.event_id,
          errorCode: error instanceof AppError ? error.code : 'INTERNAL',
        });
      }
    }
    if (result.opened || result.closedCategories || result.reminders || result.failed) {
      this.logger.log({ message: 'Scheduler sweep', ...result });
    }
    return result;
  }

  private async apply(item: Due): Promise<void> {
    if (item.action === 'reminder_before_open' || item.action === 'reminder_before_close') {
      // PRD SMS-06: to voters who have not voted (everyone until participation, step 22).
      await this.batches.send({
        eventId: item.event_id,
        type: item.action,
        channel: 'sms',
        audience: 'not_voted',
      });
      return;
    }
    return this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      if (item.action === 'open_event') {
        await transitionEvent(tx, item.event_id, 'open');
        await this.audit.record(tx, {
          action: 'event.open',
          entityType: 'voting_events',
          entityId: item.event_id,
          eventId: item.event_id,
          before: { status: 'scheduled' },
          after: { status: 'open', by: 'schedule' },
        });
        return;
      }
      const categoryId = item.category_id ?? '';
      const closed = await tx.category.updateMany({
        where: { id: categoryId, closedAt: null },
        data: { closedAt: new Date() },
      });
      if (closed.count === 0) return; // closed meanwhile
      await this.audit.record(tx, {
        action: 'category.close',
        entityType: 'categories',
        entityId: categoryId,
        eventId: item.event_id,
        after: { by: 'schedule' },
      });
    });
  }
}
