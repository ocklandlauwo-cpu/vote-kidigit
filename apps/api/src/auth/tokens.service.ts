import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type {
  AcceptInviteRequest,
  ForgotPasswordRequest,
  MeResponse,
  ResetPasswordRequest,
  TokenInfoResponse,
} from '@vote-kidigit/shared';
import type { Queue } from 'bullmq';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { RequestContextService } from '../context/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { EMAIL_JOB, type InvitationJob, type PasswordResetJob } from '../queue/email-jobs.js';
import { EMAIL_QUEUE } from '../queue/queue.module.js';
import { AuthStateService } from './auth-state.service.js';
import { AuthService } from './auth.service.js';
import { assertNotReused, savePassword } from './password-store.js';
import { SessionService } from './session.service.js';
import { UserTokensService, userContext } from './user-tokens.service.js';

/** Invitation acceptance, forgot password and reset (Backend Schema 8.2). */
@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: UserTokensService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly authState: AuthStateService,
    private readonly sessions: SessionService,
    private readonly requestContext: RequestContextService,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
  ) {}

  /**
   * POST /auth/forgot: always 202. The account lookup happens in the worker, so the answer and
   * its timing are the same whether or not the email belongs to an account.
   */
  async forgot(body: ForgotPasswordRequest): Promise<void> {
    const job: PasswordResetJob = {
      email: body.email,
      requestId: this.requestContext.getOrThrow().requestId,
    };
    await this.emailQueue.add(EMAIL_JOB.passwordReset, job);
  }

  /** Queues the invitation email of an invited user (POST /users and resend, steps 12 and 14). */
  async sendInvitation(userId: string, organizationId: string | null): Promise<void> {
    const ctx = this.requestContext.getOrThrow();
    const job: InvitationJob = {
      userId,
      organizationId,
      invitedBy: ctx.userId,
      requestId: ctx.requestId,
    };
    await this.emailQueue.add(EMAIL_JOB.invitation, job);
  }

  /** GET /auth/tokens/:token: what the set-password screens show. */
  async info(token: string): Promise<TokenInfoResponse> {
    const row = await this.tokens.find(token, this.requestContext.getOrThrow().requestId);
    return {
      purpose: row.purpose,
      fullName: row.full_name,
      email: row.email,
      organizationName: row.organization_name,
      expiresAt: row.expires_at.toISOString(),
    };
  }

  /**
   * POST /auth/invite/accept: sets the name and password, activates the account, uses the
   * token and signs the user in.
   */
  async acceptInvite(body: AcceptInviteRequest, req: Request): Promise<MeResponse> {
    const ctx = this.requestContext.getOrThrow();
    const row = await this.tokens.find(body.token, ctx.requestId, 'invite');
    const context = userContext(row, ctx.requestId);
    const changedAt = new Date();
    this.auth.actAsUser({
      userId: row.user_id,
      orgId: row.organization_id,
      isPlatformAdmin: row.is_platform_admin,
      fullName: body.fullName,
      email: row.email,
    });
    await this.prisma.withContext(context, async (tx) => {
      if (row.organization_id) {
        const org = await tx.organization.findFirst({
          where: { id: row.organization_id, deletedAt: null },
          select: { status: true },
        });
        if (org?.status !== 'active') throw new AppError('ORG_SUSPENDED');
      }
      await this.tokens.consume(tx, row.token_id);
      const activated = await tx.user.updateMany({
        where: { id: row.user_id, status: 'invited', deletedAt: null },
        data: { status: 'active', fullName: body.fullName },
      });
      if (activated.count === 0) throw new AppError('TOKEN_USED');
      await savePassword(tx, row.user_id, body.password, changedAt);
      await this.audit.record(tx, {
        action: 'auth.invite.accept',
        entityType: 'users',
        entityId: row.user_id,
        before: { status: 'invited', fullName: row.full_name },
        after: { status: 'active', fullName: body.fullName },
      });
    });

    await this.authState.invalidateUser(row.user_id);
    const state = await this.authState.get({
      userId: row.user_id,
      orgId: row.organization_id,
      isPlatformAdmin: row.is_platform_admin,
    });
    if (!state) throw new AppError('ORG_SUSPENDED');
    // Strictly after the password change, which AuthGuard compares with <=.
    await this.auth.startSession(state, req, Math.max(Date.now(), changedAt.getTime() + 1));
    await this.prisma.withContext(context, (tx) =>
      this.audit.record(tx, { action: 'auth.login', entityType: 'users', entityId: state.userId }),
    );
    return this.auth.toMe(state, req);
  }

  /**
   * POST /auth/reset: the new password must meet the policy and differ from the last 5. Clears
   * the lockout, uses the token and ends every session of the user; the user then signs in.
   */
  async reset(body: ResetPasswordRequest): Promise<void> {
    const ctx = this.requestContext.getOrThrow();
    const row = await this.tokens.find(body.token, ctx.requestId, 'password_reset');
    const context = userContext(row, ctx.requestId);
    this.auth.actAsUser({
      userId: row.user_id,
      orgId: row.organization_id,
      isPlatformAdmin: row.is_platform_admin,
      fullName: row.full_name,
      email: row.email,
    });
    await this.prisma.withContext(context, async (tx) => {
      await this.tokens.consume(tx, row.token_id);
      await assertNotReused(tx, row.user_id, body.password);
      await savePassword(tx, row.user_id, body.password, new Date());
      await tx.user.update({
        where: { id: row.user_id },
        data: { failedLoginCount: 0, lockedUntil: null, lastFailedLoginAt: null },
      });
      await this.audit.record(tx, {
        action: 'auth.password.reset',
        entityType: 'users',
        entityId: row.user_id,
      });
    });
    // Sessions end explicitly here and through the session epoch (password_changed_at).
    await this.authState.invalidateUser(row.user_id);
    await this.sessions.destroyAllForUser(row.user_id);
  }
}
