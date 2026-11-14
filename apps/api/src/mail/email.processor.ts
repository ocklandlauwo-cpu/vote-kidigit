import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import { UserTokensService } from '../auth/user-tokens.service.js';
import type { Env } from '../config/env.schema.js';
import { RequestContextService, systemContext } from '../context/request-context.js';
import { type DbContext, PrismaService } from '../database/prisma.service.js';
import type { RequestContext } from '../context/request-context.js';
import { RedisService } from '../redis/redis.service.js';
import {
  type ContactJob,
  EMAIL_JOB,
  type InvitationJob,
  type PasswordResetJob,
} from '../queue/email-jobs.js';
import { EMAIL_QUEUE } from '../queue/queue.module.js';
import { MailService } from './mail.service.js';
import { contactEmail, invitationEmail, type Language, passwordResetEmail } from './templates.js';

/** Row returned by app.find_user_for_login (migration 005); only what a reset needs. */
interface AccountRow {
  id: string;
  organization_id: string | null;
  status: 'invited' | 'active' | 'deactivated';
  is_platform_admin: boolean;
}

/** One reset email per account per minute, so the forgot form cannot flood a mailbox. */
export const RESET_EMAIL_INTERVAL_SECONDS = 60;

const language = (value: string): Language => (value === 'en' ? 'en' : 'sw');

const dbContext = (ctx: RequestContext, userId: string | null): DbContext => ({
  orgId: ctx.orgId,
  userId,
  isPlatformAdmin: ctx.isPlatformAdmin,
  requestId: ctx.requestId,
});

/**
 * Sends staff emails from the email queue (worker only). Each job runs in a system request
 * context carrying the request id of the API request that queued it.
 */
@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly appUrl: string;
  private readonly contactTo: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: UserTokensService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly requestContext: RequestContextService,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.appUrl = config.get('APP_URL', { infer: true });
    this.contactTo = config.get('CONTACT_TO_EMAIL', { infer: true });
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case EMAIL_JOB.invitation:
        return this.invitation(job.data as InvitationJob);
      case EMAIL_JOB.passwordReset:
        return this.passwordReset(job.data as PasswordResetJob, job.attemptsMade > 0);
      case EMAIL_JOB.contact:
        return this.contact(job.data as ContactJob);
      default:
        this.logger.warn({ msg: 'unknown email job', job: job.name });
    }
  }

  private async invitation(data: InvitationJob): Promise<void> {
    const ctx: RequestContext = {
      ...systemContext(data.requestId, data.organizationId),
      isPlatformAdmin: data.organizationId === null,
    };
    await this.requestContext.run(ctx, async () => {
      const sent = await this.prisma.withContext(dbContext(ctx, null), async (tx) => {
        const user = await tx.user.findFirst({
          where: { id: data.userId, status: 'invited', deletedAt: null },
          select: {
            email: true,
            fullName: true,
            language: true,
            organization: { select: { name: true } },
          },
        });
        if (!user) return null; // accepted, deactivated or deleted meanwhile
        const { token } = await this.tokens.create(tx, data.userId, 'invite', data.invitedBy);
        await this.audit.record(tx, {
          action: 'auth.invite.send',
          entityType: 'users',
          entityId: data.userId,
        });
        return { user, token };
      });
      if (!sent) return;
      await this.mail.send(
        invitationEmail({
          to: sent.user.email,
          fullName: sent.user.fullName,
          organizationName: sent.user.organization?.name ?? null,
          link: this.link('invite', sent.token),
          language: language(sent.user.language),
        }),
      );
    });
  }

  private async passwordReset(data: PasswordResetJob, isRetry: boolean): Promise<void> {
    const ctx = systemContext(data.requestId);
    await this.requestContext.run(ctx, async () => {
      const [account] = await this.prisma.withContext(
        dbContext(ctx, null),
        (tx) => tx.$queryRaw<AccountRow[]>`SELECT * FROM app.find_user_for_login(${data.email})`,
      );
      // Unknown emails, pending invitations and deactivated accounts get no email.
      if (account?.status !== 'active') return;

      const fresh = await this.redis.set(
        `reset-mail:${account.id}`,
        '1',
        'EX',
        RESET_EMAIL_INTERVAL_SECONDS,
        'NX',
      );
      if (fresh === null && !isRetry) return;

      ctx.orgId = account.organization_id;
      ctx.isPlatformAdmin = account.is_platform_admin;
      const sent = await this.prisma.withContext(dbContext(ctx, account.id), async (tx) => {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: account.id },
          select: { email: true, fullName: true, language: true },
        });
        const { token } = await this.tokens.create(tx, account.id, 'password_reset');
        await this.audit.record(tx, {
          action: 'auth.password.reset_request',
          entityType: 'users',
          entityId: account.id,
        });
        return { user, token };
      });
      await this.mail.send(
        passwordResetEmail({
          to: sent.user.email,
          fullName: sent.user.fullName,
          link: this.link('reset', sent.token),
          language: language(sent.user.language),
        }),
      );
    });
  }

  /** Public website form → the team mailbox (no database, no audit: nothing is stored). */
  private async contact(data: ContactJob): Promise<void> {
    await this.requestContext.run(systemContext(data.requestId), () =>
      this.mail.send(
        contactEmail({ to: this.contactTo, request: data.request, receivedAt: data.receivedAt }),
      ),
    );
  }

  /** /app/invite/{token} or /app/reset/{token} on the staff portal (App Flow 2). */
  private link(kind: 'invite' | 'reset', token: string): string {
    return new URL(`/app/${kind}/${token}`, this.appUrl).toString();
  }
}
