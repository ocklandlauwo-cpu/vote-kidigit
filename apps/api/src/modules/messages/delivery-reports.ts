import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import type { Env } from '../../config/env.schema.js';
import { RequestContextService, systemContext } from '../../context/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * A Beem delivery report. Beem posts the request id of the send and a status word; field names
 * are read loosely (request_id / requestId, status / dlr_status) and anything else is ignored.
 */
const ReportSchema = z
  .object({
    request_id: z.union([z.string(), z.number()]).optional(),
    requestId: z.union([z.string(), z.number()]).optional(),
    status: z.string().optional(),
    dlr_status: z.string().optional(),
  })
  .loose();

const DELIVERED = new Set(['DELIVERED', 'DELIVRD', 'SUCCESS']);
const FAILED = new Set([
  'UNDELIVERED',
  'UNDELIV',
  'FAILED',
  'REJECTED',
  'REJECTD',
  'EXPIRED',
  'ERROR',
]);

export type ReportOutcome = 'delivered' | 'failed' | 'ignored';

/**
 * Delivery reports (Backend Schema 12.12, PRD SMS-07): POST /webhooks/beem/dlr?secret=…
 * updates the message, the batch counters and the voter's code status. The report arrives
 * without an organization: app.resolve_sms_message() names it, then everything runs in that
 * organization's context as System.
 */
@Injectable()
export class DeliveryReports {
  private readonly logger = new Logger(DeliveryReports.name);
  private readonly secret: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    config: ConfigService<Env, true>,
  ) {
    const secret: string = config.get('BEEM_DLR_SECRET', { infer: true });
    this.secret = Buffer.from(secret);
  }

  /** Constant-time comparison of the secret in the callback URL. */
  assertSecret(given: unknown): void {
    const candidate = Buffer.from(typeof given === 'string' ? given : '');
    if (candidate.length !== this.secret.length || !timingSafeEqual(candidate, this.secret)) {
      throw new AppError('UNAUTHENTICATED');
    }
  }

  async handle(body: unknown): Promise<ReportOutcome> {
    const report = ReportSchema.safeParse(body);
    if (!report.success) return 'ignored';
    const providerId = report.data.request_id ?? report.data.requestId;
    const word = (report.data.status ?? report.data.dlr_status ?? '').toUpperCase();
    const outcome: ReportOutcome = DELIVERED.has(word)
      ? 'delivered'
      : FAILED.has(word)
        ? 'failed'
        : 'ignored';
    if (providerId === undefined || outcome === 'ignored') return 'ignored';

    const requestId = randomUUID();
    const found = await this.requestContext.run(systemContext(requestId), () =>
      this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
        const rows = await tx.$queryRaw<{ sms_message_id: string; organization_id: string }[]>`
          SELECT * FROM app.resolve_sms_message(${String(providerId)})`;
        return rows[0] ?? null;
      }),
    );
    if (!found) return 'ignored';
    await this.requestContext.run(systemContext(requestId, found.organization_id), () =>
      this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
        const message = await tx.smsMessage.findUnique({
          where: { id: found.sms_message_id },
          select: { status: true, batchId: true, voterId: true, type: true },
        });
        // Reports may repeat or arrive out of order: delivered and failed are final.
        if (!message || message.status === 'delivered' || message.status === 'failed') return;
        const now = new Date();
        await tx.smsMessage.update({
          where: { id: found.sms_message_id },
          data:
            outcome === 'delivered'
              ? { status: 'delivered', deliveredAt: now }
              : { status: 'failed', failedAt: now, lastError: `report: ${word.slice(0, 40)}` },
        });
        if (message.batchId) {
          await tx.smsBatch.update({
            where: { id: message.batchId },
            data:
              outcome === 'delivered'
                ? { deliveredCount: { increment: 1 } }
                : { failedCount: { increment: 1 } },
          });
        }
        if (message.type === 'code_delivery' && message.voterId) {
          await tx.voter.update({
            where: { id: message.voterId },
            data: { codeStatus: outcome === 'delivered' ? 'delivered' : 'failed' },
          });
        }
      }),
    );
    this.logger.log({ message: 'Delivery report', outcome });
    return outcome;
  }
}
