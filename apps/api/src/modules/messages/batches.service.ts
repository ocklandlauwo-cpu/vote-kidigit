import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import {
  type Batch,
  type BatchEstimate,
  type BatchMessagePage,
  type BatchMessagesQuery,
  type BatchPage,
  type CreateBatchRequestSchema,
  maskPhone,
  type PaginationQuery,
  renderTemplate,
  smsLength,
} from '@vote-kidigit/shared';
import type { Queue } from 'bullmq';
import type { z } from 'zod';
import { AuditService } from '../../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { BatchAudience, MessageChannel, MessageType } from '../../generated/prisma/enums.js';
import { SMS_JOB, type SendMessageJob } from '../../queue/sms-jobs.js';
import { SMS_QUEUE } from '../../queue/queue.module.js';
import { MessageContent, SAMPLE_CODE } from './message-content.js';
import { maySend, notSendableReason } from './send-rules.js';

type CreateBatch = z.output<typeof CreateBatchRequestSchema>;

/** One message row per voter in one transaction: large events need longer than the default. */
const CREATE_TIMEOUT_MS = 60_000;

export interface NewBatch {
  eventId: string;
  type: MessageType;
  channel: MessageChannel;
  audience: BatchAudience;
  /** For audience "single": the voter. */
  voterId?: string;
  /** Exactly these voters (resend of failed messages). */
  voterIds?: string[];
  /**
   * For audience "single" by SMS: send to this number instead of the voter's (kiosk, someone
   * else's phone approved by staff). It is not saved on the voter.
   */
  toAddress?: string;
}

/** Codes go out only once the event is published (Scheduled or Open). */

const batchSelect = {
  id: true,
  type: true,
  channel: true,
  audience: true,
  status: true,
  totalCount: true,
  sentCount: true,
  deliveredCount: true,
  failedCount: true,
  pausedReason: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  creator: { select: { fullName: true } },
} satisfies Prisma.SmsBatchSelect;

type BatchRow = Prisma.SmsBatchGetPayload<{ select: typeof batchSelect }>;

const iso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * Message batches (Backend Schema 7.2, 12.8, PRD SMS-05): one send action with its audience,
 * its message rows (text stored with the code redacted) and one send job per message. Used by
 * the Messages tab, resend and regenerate, publishing with "Send codes now", cancellation and
 * the reminder sweep.
 */
@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly content: MessageContent,
    private readonly requestContext: RequestContextService,
    @InjectQueue(SMS_QUEUE) private readonly queue: Queue<SendMessageJob>,
  ) {}

  /**
   * Creates a batch and its messages inside `tx`; call `enqueue(ids)` after the commit (the
   * worker must find the rows). Returns null when nobody is in the audience.
   */
  async create(tx: Tx, batch: NewBatch): Promise<{ batchId: string; messageIds: string[] } | null> {
    const ctx = this.requestContext.getOrThrow();
    const organizationId = ctx.orgId ?? '';
    const event = await this.content.event(tx, batch.eventId);
    const recipients = await this.audience(tx, batch);
    if (recipients.length === 0) return null;
    const template = await this.content.template(tx, batch.eventId, batch.type, batch.channel);
    const created = await tx.smsBatch.create({
      data: {
        organizationId,
        eventId: batch.eventId,
        type: batch.type,
        channel: batch.channel,
        audience: batch.audience,
        totalCount: recipients.length,
        createdBy: ctx.userId,
      },
      select: { id: true },
    });
    const base = await this.content.values(tx, event, null);
    const rows: Prisma.SmsMessageCreateManyInput[] = [];
    for (const voter of recipients) {
      const values = { ...base, voter_name: voter.fullName };
      rows.push({
        organizationId,
        eventId: batch.eventId,
        batchId: created.id,
        voterId: voter.id,
        channel: batch.channel,
        type: batch.type,
        toAddress:
          batch.channel === 'sms'
            ? (batch.audience === 'single' && batch.toAddress) || voter.phone
            : (voter.email ?? ''),
        bodyRedacted: renderTemplate(template.body, values),
      });
    }
    const messages = await tx.smsMessage.createManyAndReturn({ data: rows, select: { id: true } });
    await this.audit.record(tx, {
      action: 'messages.batch.create',
      entityType: 'sms_batches',
      entityId: created.id,
      eventId: batch.eventId,
      after: {
        type: batch.type,
        channel: batch.channel,
        audience: batch.audience,
        recipients: recipients.length,
      },
    });
    return { batchId: created.id, messageIds: messages.map((m) => m.id) };
  }

  /** Queues one send job per message (after the creating transaction committed). */
  async enqueue(messageIds: string[]): Promise<void> {
    const ctx = this.requestContext.getOrThrow();
    const organizationId = ctx.orgId ?? '';
    for (let start = 0; start < messageIds.length; start += 1000) {
      await this.queue.addBulk(
        messageIds.slice(start, start + 1000).map((messageId) => ({
          name: SMS_JOB.send,
          data: { messageId, organizationId, requestId: ctx.requestId },
          opts: { jobId: `send-${messageId}` },
        })),
      );
    }
  }

  /**
   * After Resume: jobs held while the batch was paused are promoted to run now; a message
   * without a job (lost, or removed) gets a new one. The job id keeps a message to one job.
   */
  private async requeue(messageIds: string[]): Promise<void> {
    const missing: string[] = [];
    for (const messageId of messageIds) {
      const job = await this.queue.getJob(`send-${messageId}`);
      if (!job) missing.push(messageId);
      else if ((await job.getState()) === 'delayed') await job.promote();
    }
    await this.enqueue(missing);
  }

  /** Creates, commits and queues in one go (resend, regenerate, cancellation, reminders). */
  async send(batch: NewBatch): Promise<string | null> {
    const created = await this.prisma.withContext(this.context(), (tx) => this.create(tx, batch), {
      timeout: CREATE_TIMEOUT_MS,
    });
    if (!created) return null;
    await this.enqueue(created.messageIds);
    return created.batchId;
  }

  /** POST /events/:eventId/batches (App Flow 6.7 Send). */
  async start(eventId: string, body: CreateBatch): Promise<Batch> {
    const created = await this.prisma.withContext(
      this.context(),
      async (tx) => {
        await this.assertSendable(tx, eventId, body.type);
        const result = await this.create(tx, { eventId, ...body });
        if (!result) {
          throw new AppError('VALIDATION_FAILED', 'Nobody is in this audience.', {
            source: 'body',
            issues: [{ path: 'audience', code: 'empty', message: 'nobody to send to' }],
          });
        }
        return result;
      },
      { timeout: CREATE_TIMEOUT_MS },
    );
    await this.enqueue(created.messageIds);
    return this.prisma.withContext(this.context(), (tx) => this.load(tx, eventId, created.batchId));
  }

  /** GET /events/:eventId/batches/estimate: recipients and SMS to be billed. */
  estimate(eventId: string, body: CreateBatch): Promise<BatchEstimate> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.content.event(tx, eventId);
      const recipients = await this.audience(tx, { eventId, ...body });
      const template = await this.content.template(tx, eventId, body.type, body.channel);
      const text = renderTemplate(
        template.body,
        await this.content.values(
          tx,
          event,
          recipients[0] ?? { fullName: 'Asha Mollel' },
          SAMPLE_CODE,
        ),
      );
      const segments = body.channel === 'sms' ? smsLength(text).segments : 0;
      return { recipients: recipients.length, segments, smsCount: segments * recipients.length };
    });
  }

  /** GET /events/:eventId/batches */
  list(eventId: string, query: PaginationQuery): Promise<BatchPage> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await this.content.event(tx, eventId);
      const [rows, total] = await Promise.all([
        tx.smsBatch.findMany({
          where: { eventId },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: batchSelect,
        }),
        tx.smsBatch.count({ where: { eventId } }),
      ]);
      const pending = await this.pendingCounts(
        tx,
        rows.map((r) => r.id),
      );
      return {
        items: rows.map((row) => this.toBatch(row, pending.get(row.id) ?? 0)),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /** GET /events/:eventId/batches/:batchId/messages: per-voter delivery status. */
  messages(eventId: string, batchId: string, query: BatchMessagesQuery): Promise<BatchMessagePage> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await this.find(tx, eventId, batchId);
      const where: Prisma.SmsMessageWhereInput = {
        batchId,
        ...(query.status && { status: query.status }),
      };
      const [rows, total] = await Promise.all([
        tx.smsMessage.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            voterId: true,
            channel: true,
            toAddress: true,
            status: true,
            attempts: true,
            lastError: true,
            sentAt: true,
            deliveredAt: true,
            failedAt: true,
            voter: { select: { fullName: true } },
          },
        }),
        tx.smsMessage.count({ where }),
      ]);
      return {
        items: rows.map((m) => ({
          id: m.id,
          voterId: m.voterId,
          voterName: m.voter?.fullName ?? null,
          to: m.channel === 'sms' ? maskPhone(m.toAddress) : m.toAddress,
          status: m.status,
          attempts: m.attempts,
          lastError: m.lastError,
          sentAt: iso(m.sentAt),
          deliveredAt: iso(m.deliveredAt),
          failedAt: iso(m.failedAt),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /** POST …/resume: a paused batch sends its remaining messages. */
  async resume(eventId: string, batchId: string): Promise<Batch> {
    const queued = await this.prisma.withContext(this.context(), async (tx) => {
      const batch = await this.find(tx, eventId, batchId);
      if (batch.status !== 'paused') throw this.invalid('NOT_PAUSED');
      await this.assertSendable(tx, eventId, batch.type);
      await tx.smsBatch.update({
        where: { id: batchId },
        data: { status: 'sending', pausedReason: null },
      });
      await this.auditControl(tx, eventId, batchId, 'messages.batch.resume');
      return tx.smsMessage.findMany({ where: { batchId, status: 'queued' }, select: { id: true } });
    });
    await this.requeue(queued.map((m) => m.id));
    return this.prisma.withContext(this.context(), (tx) => this.load(tx, eventId, batchId));
  }

  /** POST …/cancel: nothing more is sent; queued messages stay unsent. */
  cancel(eventId: string, batchId: string): Promise<Batch> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const batch = await this.find(tx, eventId, batchId);
      if (batch.status === 'completed' || batch.status === 'cancelled') {
        throw this.invalid('FINISHED');
      }
      await tx.smsBatch.update({
        where: { id: batchId },
        data: { status: 'cancelled', completedAt: new Date() },
      });
      await this.auditControl(tx, eventId, batchId, 'messages.batch.cancel');
      return this.load(tx, eventId, batchId);
    });
  }

  /**
   * POST …/resend-failed: a new batch for the failed messages' voters (same code: the stored
   * code is sent again, PRD COD-05).
   */
  async resendFailed(eventId: string, batchId: string): Promise<Batch> {
    const created = await this.prisma.withContext(
      this.context(),
      async (tx) => {
        const batch = await this.find(tx, eventId, batchId);
        await this.assertSendable(tx, eventId, batch.type);
        const failed = await tx.smsMessage.findMany({
          where: { batchId, status: 'failed', voterId: { not: null } },
          select: { voterId: true },
        });
        if (failed.length === 0) throw this.invalid('NOTHING_FAILED');
        const result = await this.create(tx, {
          eventId,
          type: batch.type,
          channel: batch.channel,
          audience: 'failed',
          voterIds: failed.map((m) => m.voterId ?? ''),
        });
        if (!result) throw this.invalid('NOTHING_FAILED');
        return result;
      },
      { timeout: CREATE_TIMEOUT_MS },
    );
    await this.enqueue(created.messageIds);
    return this.prisma.withContext(this.context(), (tx) => this.load(tx, eventId, created.batchId));
  }

  /**
   * The voters a batch goes to (PRD SMS-05). "Not voted" is every voter until participation is
   * recorded (step 22). Email batches reach only voters with an address (SMS-09).
   */
  private async audience(tx: Tx, batch: NewBatch) {
    const where: Prisma.VoterWhereInput = { eventId: batch.eventId, deletedAt: null };
    if (batch.voterIds) where.id = { in: batch.voterIds };
    else if (batch.audience === 'single') where.id = batch.voterId ?? '';
    else if (batch.audience === 'not_sent') where.codeStatus = 'not_sent';
    else if (batch.audience === 'failed' && batch.type === 'code_delivery') {
      where.codeStatus = 'failed';
    }
    if (batch.channel === 'email') where.email = { not: null };
    return tx.voter.findMany({
      where,
      orderBy: { id: 'asc' },
      select: { id: true, fullName: true, phone: true, email: true },
    });
  }

  private async assertSendable(tx: Tx, eventId: string, type: MessageType): Promise<void> {
    const event = await tx.votingEvent.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { status: true },
    });
    if (!event) throw new AppError('NOT_FOUND');
    if (!maySend(type, event.status)) throw this.invalid(notSendableReason(type));
  }

  private async pendingCounts(tx: Tx, batchIds: string[]): Promise<Map<string, number>> {
    if (batchIds.length === 0) return new Map();
    const rows = await tx.smsMessage.groupBy({
      by: ['batchId'],
      where: { batchId: { in: batchIds }, status: 'queued' },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.batchId ?? '', r._count._all]));
  }

  private async load(tx: Tx, eventId: string, batchId: string): Promise<Batch> {
    const row = await tx.smsBatch.findFirst({
      where: { id: batchId, eventId },
      select: batchSelect,
    });
    if (!row) throw new AppError('NOT_FOUND');
    const pending = await this.pendingCounts(tx, [batchId]);
    return this.toBatch(row, pending.get(batchId) ?? 0);
  }

  private async find(tx: Tx, eventId: string, batchId: string) {
    const batch = await tx.smsBatch.findFirst({
      where: { id: batchId, eventId },
      select: { status: true, type: true, channel: true },
    });
    if (!batch) throw new AppError('NOT_FOUND');
    return batch;
  }

  private auditControl(tx: Tx, eventId: string, batchId: string, action: string) {
    return this.audit.record(tx, { action, entityType: 'sms_batches', entityId: batchId, eventId });
  }

  private toBatch(row: BatchRow, pendingCount: number): Batch {
    return {
      id: row.id,
      type: row.type,
      channel: row.channel,
      audience: row.audience,
      status: row.status,
      totalCount: row.totalCount,
      sentCount: row.sentCount,
      deliveredCount: row.deliveredCount,
      failedCount: row.failedCount,
      pendingCount,
      pausedReason: row.pausedReason,
      createdBy: row.creator?.fullName ?? null,
      createdAt: row.createdAt.toISOString(),
      startedAt: iso(row.startedAt),
      completedAt: iso(row.completedAt),
    };
  }

  private invalid(reason: string) {
    return new AppError('INVALID_TRANSITION', 'This is not possible now.', { reason });
  }

  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
