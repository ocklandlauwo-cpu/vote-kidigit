import { Inject, Injectable, Logger } from '@nestjs/common';
import { formatVotingCode, REDACTED_CODE, renderTemplate } from '@vote-kidigit/shared';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import { MailService } from '../../mail/mail.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { CodesService } from '../voters/codes.service.js';
import { MessageContent } from './message-content.js';
import { maySend } from './send-rules.js';
import { SMS_GATEWAY, type SmsGateway, SmsSendError } from './sms-gateway.js';

/** `held`: the batch is paused; the job waits in the queue until Resume or Cancel. */
export type SendOutcome = 'sent' | 'skipped' | 'held' | 'retry' | 'failed';

/** Auto-pause (PRD SMS-07, Implementation Plan step 21): more than 20% failed, of at least 10. */
const PAUSE_RATIO = 0.2;
const PAUSE_MIN_FINISHED = 10;

/** Thrown to let the queue try the message again later (BullMQ backoff). */
export class RetryLater extends Error {}

/**
 * One sender per message at a time. BullMQ delivers at least once: a job it thinks stalled (a
 * busy worker) runs again while the first run may still be sending. The lock outlives the
 * gateway's 10-second timeout; a second run that cannot take it retries later and then finds the
 * message already sent.
 */
const SEND_LOCK_PREFIX = 'smslock:';
const SEND_LOCK_MS = 60_000;

/**
 * Set as soon as the gateway accepts a message, before the database records it. If recording
 * fails (a busy database), the job's retry finds this and records the send instead of sending
 * the SMS again. Kept far longer than the job's retries last.
 */
const SENT_MARK_PREFIX = 'smssent:';
const SENT_MARK_MS = 24 * 3_600_000;

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );

/**
 * Sends one queued message (worker only). The voting code is decrypted here, just before the
 * send, and only the redacted text is ever stored. Counters, the voter's code status and the
 * event's first_code_sent_at follow the outcome; too many failures pause the batch.
 */
@Injectable()
export class MessageSender {
  private readonly logger = new Logger(MessageSender.name);
  private readonly defaultSender: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: CodesService,
    private readonly content: MessageContent,
    private readonly mail: MailService,
    private readonly redis: RedisService,
    private readonly requestContext: RequestContextService,
    @Inject(SMS_GATEWAY) private readonly gateway: SmsGateway,
    config: ConfigService<Env, true>,
  ) {
    this.defaultSender = config.get('BEEM_DEFAULT_SENDER_ID', { infer: true });
  }

  /** `lastAttempt`: a retryable failure now counts as final. */
  async send(messageId: string, lastAttempt: boolean): Promise<SendOutcome> {
    const lockKey = `${SEND_LOCK_PREFIX}${messageId}`;
    const locked = await this.redis.set(lockKey, '1', 'PX', SEND_LOCK_MS, 'NX');
    if (!locked) throw new RetryLater('message is being sent');
    try {
      return await this.sendLocked(messageId, lastAttempt);
    } finally {
      await this.redis.del(lockKey);
    }
  }

  private async sendLocked(messageId: string, lastAttempt: boolean): Promise<SendOutcome> {
    const ctx = this.requestContext.getOrThrow();
    const prepared = await this.prisma.withContext(ctx, (tx) => this.prepare(tx, messageId));
    if (prepared === 'held') return 'held';
    if (!prepared) return 'skipped';

    let providerMessageId: string | null = null;
    let failure: SmsSendError | null = null;
    const sentKey = `${SENT_MARK_PREFIX}${messageId}`;
    const earlier = await this.redis.get(sentKey);
    if (earlier !== null) {
      // Sent by an earlier run whose record did not commit: record it, do not send again.
      providerMessageId = earlier || null;
    } else {
      try {
        providerMessageId = await this.deliver(messageId, prepared);
      } catch (error: unknown) {
        failure =
          error instanceof SmsSendError
            ? error
            : new SmsSendError(
                error instanceof Error ? error.message.slice(0, 200) : 'send failed',
                true,
              );
      }
      if (!failure) await this.redis.set(sentKey, providerMessageId ?? '', 'PX', SENT_MARK_MS);
    }

    const outcome = await this.prisma.withContext(ctx, (tx) =>
      failure
        ? this.recordFailure(tx, messageId, failure, lastAttempt)
        : this.recordSent(tx, messageId, providerMessageId),
    );
    if (outcome === 'retry') throw new RetryLater(failure?.message ?? 'retry');
    return outcome;
  }

  /** Hands the message to the SMS gateway or the mail server; the provider's id for an SMS. */
  private async deliver(
    messageId: string,
    prepared: Exclude<Awaited<ReturnType<MessageSender['prepare']>>, null | 'held'>,
  ): Promise<string | null> {
    if (prepared.channel === 'sms') {
      return (
        await this.gateway.send({
          to: prepared.to,
          text: prepared.text,
          senderId: prepared.senderId,
          reference: messageId,
        })
      ).providerMessageId;
    }
    await this.mail.send({
      to: prepared.to,
      subject: prepared.subject ?? '',
      text: prepared.text,
      html: `<p>${escapeHtml(prepared.text).replace(/\n/g, '<br>')}</p>`,
    });
    return null;
  }

  /** Whether the message's batch is still paused (a held job checks this after parking). */
  async isHeld(messageId: string): Promise<boolean> {
    const ctx = this.requestContext.getOrThrow();
    const message = await this.prisma.withContext(ctx, (tx) =>
      tx.smsMessage.findUnique({
        where: { id: messageId },
        select: { batch: { select: { status: true } } },
      }),
    );
    return message?.batch?.status === 'paused';
  }

  private async prepare(tx: Tx, messageId: string) {
    const message = await tx.smsMessage.findUnique({
      where: { id: messageId },
      select: {
        status: true,
        channel: true,
        type: true,
        toAddress: true,
        bodyRedacted: true,
        eventId: true,
        batch: { select: { id: true, status: true } },
        event: { select: { status: true } },
        voter: { select: { codeCiphertext: true, deletedAt: true } },
      },
    });
    if (message?.status !== 'queued') return null;
    if (message.batch?.status === 'cancelled') return null;
    if (message.batch?.status === 'paused') return 'held' as const;
    if (!maySend(message.type, message.event.status)) {
      // The event moved on (cancelled, closed): nothing more of this batch goes out.
      if (message.batch) {
        await tx.smsBatch.updateMany({
          where: { id: message.batch.id, status: { in: ['queued', 'sending'] } },
          data: { status: 'cancelled', completedAt: new Date() },
        });
      }
      return null;
    }
    if (message.batch?.status === 'queued') {
      await tx.smsBatch.updateMany({
        where: { id: message.batch.id, status: 'queued' },
        data: { status: 'sending', startedAt: new Date() },
      });
    }
    let text = message.bodyRedacted;
    if (text.includes(REDACTED_CODE)) {
      const stored = message.voter?.codeCiphertext;
      // No code to send (voter deleted, or no code yet): leave the placeholder out of the SMS.
      const code =
        stored && !message.voter?.deletedAt ? formatVotingCode(this.codes.decrypt(stored)) : '';
      text = text.split(REDACTED_CODE).join(code);
    }
    const event = await this.content.event(tx, message.eventId);
    let subject: string | null = null;
    if (message.channel === 'email') {
      const template = await this.content.template(tx, message.eventId, message.type, 'email');
      subject = renderTemplate(template.subject ?? '', await this.content.values(tx, event, null));
    }
    return {
      channel: message.channel,
      to: message.toAddress,
      text,
      subject,
      senderId: event.senderId ?? this.defaultSender,
    };
  }

  private async recordSent(
    tx: Tx,
    messageId: string,
    providerMessageId: string | null,
  ): Promise<SendOutcome> {
    const now = new Date();
    const message = await tx.smsMessage.update({
      where: { id: messageId },
      data: {
        status: 'sent',
        providerMessageId,
        sentAt: now,
        attempts: { increment: 1 },
        lastError: null,
      },
      select: { batchId: true, voterId: true, type: true, channel: true, eventId: true },
    });
    if (message.batchId) {
      await tx.smsBatch.update({
        where: { id: message.batchId },
        data: { sentCount: { increment: 1 } },
      });
    }
    if (message.type === 'code_delivery' && message.channel === 'sms') {
      if (message.voterId) {
        await tx.voter.update({
          where: { id: message.voterId },
          data: { codeStatus: 'sent', codeLastSentAt: now },
        });
      }
      // Unpublishing is refused from now on (App Flow 6.8).
      await tx.votingEvent.updateMany({
        where: { id: message.eventId, firstCodeSentAt: null },
        data: { firstCodeSentAt: now },
      });
    }
    await this.completeIfDone(tx, message.batchId);
    return 'sent';
  }

  private async recordFailure(
    tx: Tx,
    messageId: string,
    failure: SmsSendError,
    lastAttempt: boolean,
  ): Promise<SendOutcome> {
    const final = lastAttempt || !failure.retryable;
    const message = await tx.smsMessage.update({
      where: { id: messageId },
      data: {
        attempts: { increment: 1 },
        lastError: failure.message,
        ...(final && { status: 'failed', failedAt: new Date() }),
      },
      select: { batchId: true, voterId: true, type: true, channel: true },
    });
    if (!final) return 'retry';
    this.logger.warn({ message: 'Message failed', messageId, errorCode: 'SEND_FAILED' });
    if (message.type === 'code_delivery' && message.channel === 'sms' && message.voterId) {
      await tx.voter.update({ where: { id: message.voterId }, data: { codeStatus: 'failed' } });
    }
    if (message.batchId) {
      const batch = await tx.smsBatch.update({
        where: { id: message.batchId },
        data: { failedCount: { increment: 1 } },
        select: { status: true, sentCount: true, failedCount: true },
      });
      const finished = batch.sentCount + batch.failedCount;
      if (
        batch.status === 'sending' &&
        finished >= PAUSE_MIN_FINISHED &&
        batch.failedCount / finished > PAUSE_RATIO
      ) {
        await tx.smsBatch.update({
          where: { id: message.batchId },
          data: { status: 'paused', pausedReason: 'failure_rate' },
        });
        this.logger.warn({ message: 'Batch paused', batchId: message.batchId });
      }
    }
    await this.completeIfDone(tx, message.batchId);
    return 'failed';
  }

  private async completeIfDone(tx: Tx, batchId: string | null): Promise<void> {
    if (!batchId) return;
    const queued = await tx.smsMessage.count({ where: { batchId, status: 'queued' } });
    if (queued > 0) return;
    await tx.smsBatch.updateMany({
      where: { id: batchId, status: 'sending' },
      data: { status: 'completed', completedAt: new Date() },
    });
  }
}
