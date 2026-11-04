import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ChangePasswordRequest,
  LoginRequest,
  MeResponse,
  UpdateMeRequest,
} from '@vote-kidigit/shared';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { Env } from '../config/env.schema.js';
import { RequestContextService } from '../context/request-context.js';
import { type DbContext, PrismaService } from '../database/prisma.service.js';
import { AuthStateService } from './auth-state.service.js';
import type { AuthState } from './auth.types.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './passwords.js';
import { SessionService } from './session.service.js';

/** Row returned by app.find_user_for_login (migration 005). */
interface LoginRow {
  id: string;
  organization_id: string | null;
  password_hash: string | null;
  status: 'invited' | 'active' | 'deactivated';
  locked_until: Date | null;
  failed_login_count: number;
  is_platform_admin: boolean;
}

/** PRD USR-06: the last 5 passwords cannot be reused. */
export const PASSWORD_HISTORY_SIZE = 5;

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

function regenerate(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.regenerate((error: unknown) => (error ? reject(asError(error)) : resolve())),
  );
}

function destroy(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.destroy((error: unknown) => (error ? reject(asError(error)) : resolve())),
  );
}

/** Staff sign-in, sign-out, profile and password change (Backend Schema 8.1, 12.2). */
@Injectable()
export class AuthService {
  private readonly maxAttempts: number;
  private readonly lockMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authState: AuthStateService,
    private readonly sessions: SessionService,
    private readonly requestContext: RequestContextService,
    config: ConfigService<Env, true>,
  ) {
    this.maxAttempts = config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    this.lockMinutes = config.get('LOGIN_LOCK_MINUTES', { infer: true });
  }

  /**
   * POST /auth/login. Every failure that could reveal whether an account exists returns the
   * same INVALID_CREDENTIALS; the account status is only revealed after a correct password.
   */
  async login(body: LoginRequest, req: Request): Promise<MeResponse> {
    const ctx = this.requestContext.getOrThrow();
    const anonymous: DbContext = {
      orgId: null,
      userId: null,
      isPlatformAdmin: false,
      requestId: ctx.requestId,
    };
    const [row] = await this.prisma.withContext(
      anonymous,
      (tx) => tx.$queryRaw<LoginRow[]>`SELECT * FROM app.find_user_for_login(${body.email})`,
    );

    if (!row?.password_hash) {
      // Unknown email or invitation not yet accepted: same answer, same timing.
      await verifyAgainstDummy(body.password);
      throw new AppError('INVALID_CREDENTIALS');
    }

    const userContext: DbContext = {
      orgId: row.organization_id,
      userId: row.id,
      isPlatformAdmin: row.is_platform_admin,
      requestId: ctx.requestId,
    };
    const now = new Date();
    if (row.locked_until && row.locked_until > now) {
      throw new AppError('ACCOUNT_LOCKED', undefined, {
        lockedUntil: row.locked_until.toISOString(),
      });
    }

    if (!(await verifyPassword(row.password_hash, body.password))) {
      const attempts = row.failed_login_count + 1;
      const lockedUntil =
        attempts >= this.maxAttempts ? new Date(now.getTime() + this.lockMinutes * 60_000) : null;
      await this.prisma.withContext(userContext, async (tx) => {
        await tx.user.update({
          where: { id: row.id },
          data: lockedUntil ? { failedLoginCount: 0, lockedUntil } : { failedLoginCount: attempts },
        });
        await this.audit.record(tx, {
          action: lockedUntil ? 'auth.login.locked' : 'auth.login.failed',
          entityType: 'users',
          entityId: row.id,
          organizationId: row.organization_id,
        });
      });
      if (lockedUntil) {
        throw new AppError('ACCOUNT_LOCKED', undefined, { lockedUntil: lockedUntil.toISOString() });
      }
      throw new AppError('INVALID_CREDENTIALS');
    }

    if (row.status === 'deactivated') throw new AppError('ACCOUNT_INACTIVE');
    if (row.status !== 'active') throw new AppError('INVALID_CREDENTIALS');

    await this.prisma.withContext(userContext, async (tx) => {
      if (row.organization_id) {
        const org = await tx.organization.findFirst({
          where: { id: row.organization_id },
          select: { status: true, deletedAt: true },
        });
        if (!org || org.status !== 'active' || org.deletedAt) throw new AppError('ORG_SUSPENDED');
      }
      await tx.user.update({
        where: { id: row.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      });
    });

    await this.authState.invalidateUser(row.id);
    const state = await this.authState.get({
      userId: row.id,
      orgId: row.organization_id,
      isPlatformAdmin: row.is_platform_admin,
    });
    if (!state) throw new AppError('INVALID_CREDENTIALS');

    // New session id on sign-in (no session fixation).
    await regenerate(req);
    req.session.userId = state.userId;
    req.session.orgId = state.orgId;
    req.session.isPlatformAdmin = state.isPlatformAdmin;
    req.session.csrf = randomBytes(32).toString('base64url');
    req.session.timeoutMinutes = state.sessionTimeoutMinutes;
    req.session.cookie.maxAge = state.sessionTimeoutMinutes * 60_000;
    await this.sessions.track(state.userId, req.sessionID, state.sessionTimeoutMinutes);

    this.actAs(state);
    await this.prisma.withContext(userContext, (tx) =>
      this.audit.record(tx, { action: 'auth.login', entityType: 'users', entityId: state.userId }),
    );
    return this.toMe(state, req);
  }

  /** POST /auth/logout: ends this session only. */
  async logout(auth: AuthState, req: Request): Promise<void> {
    await this.prisma.withContext(this.dbContext(), (tx) =>
      this.audit.record(tx, { action: 'auth.logout', entityType: 'users', entityId: auth.userId }),
    );
    const sessionId = req.sessionID;
    await destroy(req);
    await this.sessions.untrack(auth.userId, sessionId);
  }

  /** GET /me */
  toMe(state: AuthState, req: Request): MeResponse {
    return {
      id: state.userId,
      email: state.email,
      fullName: state.fullName,
      phone: state.phone,
      language: state.language,
      themePreference: state.themePreference,
      isPlatformAdmin: state.isPlatformAdmin,
      isOrgSuperAdmin: state.isOrgSuperAdmin,
      organization: state.organization,
      role: state.role,
      permissions: state.permissions,
      mappedEventIds: state.mappedEventIds,
      csrfToken: req.session.csrf ?? '',
      sessionExpiresAt: new Date(Date.now() + state.sessionTimeoutMinutes * 60_000).toISOString(),
    };
  }

  /** PATCH /me: name, phone, language, theme preference. */
  async updateMe(auth: AuthState, body: UpdateMeRequest, req: Request): Promise<MeResponse> {
    await this.prisma.withContext(this.dbContext(), async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: { fullName: true, phone: true, language: true, themePreference: true },
      });
      const after = await tx.user.update({
        where: { id: auth.userId },
        data: body,
        select: { fullName: true, phone: true, language: true, themePreference: true },
      });
      await this.audit.record(tx, {
        action: 'me.update',
        entityType: 'users',
        entityId: auth.userId,
        before,
        after,
      });
    });
    await this.authState.invalidateUser(auth.userId);
    const state = await this.authState.get(auth);
    if (!state) throw new AppError('UNAUTHENTICATED');
    return this.toMe(state, req);
  }

  /**
   * POST /me/password: the current password must be right; the new one must meet the policy
   * (validated by the request schema) and differ from the last 5. Other sessions of the user
   * end; this one continues under a new session id.
   */
  async changePassword(auth: AuthState, body: ChangePasswordRequest, req: Request): Promise<void> {
    await this.prisma.withContext(this.dbContext(), async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: { passwordHash: true },
      });
      if (!user.passwordHash || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
        throw new AppError('VALIDATION_FAILED', 'Current password is incorrect.', {
          source: 'body',
          issues: [{ path: 'currentPassword', code: 'incorrect', message: 'is incorrect' }],
        });
      }

      const history = await tx.passwordHistory.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: 'desc' },
        take: PASSWORD_HISTORY_SIZE,
        select: { passwordHash: true },
      });
      for (const hash of [user.passwordHash, ...history.map((h) => h.passwordHash)]) {
        if (await verifyPassword(hash, body.newPassword)) throw new AppError('PASSWORD_REUSED');
      }

      const passwordHash = await hashPassword(body.newPassword);
      await tx.user.update({
        where: { id: auth.userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await tx.passwordHistory.create({ data: { userId: auth.userId, passwordHash } });
      const keep = await tx.passwordHistory.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: 'desc' },
        take: PASSWORD_HISTORY_SIZE,
        select: { id: true },
      });
      await tx.passwordHistory.deleteMany({
        where: { userId: auth.userId, id: { notIn: keep.map((k) => k.id) } },
      });
      await this.audit.record(tx, {
        action: 'me.password.change',
        entityType: 'users',
        entityId: auth.userId,
      });
    });

    const { csrf, timeoutMinutes } = req.session;
    await this.sessions.destroyAllForUser(auth.userId, req.sessionID);
    await regenerate(req);
    Object.assign(req.session, {
      userId: auth.userId,
      orgId: auth.orgId,
      isPlatformAdmin: auth.isPlatformAdmin,
      csrf,
      timeoutMinutes,
    });
    req.session.cookie.maxAge = auth.sessionTimeoutMinutes * 60_000;
    await this.sessions.track(auth.userId, req.sessionID, auth.sessionTimeoutMinutes);
  }

  private dbContext(): DbContext {
    const { orgId, userId, isPlatformAdmin, requestId } = this.requestContext.getOrThrow();
    return { orgId, userId, isPlatformAdmin, requestId };
  }

  /** After sign-in the request acts as the user (the guard did not run on the public route). */
  private actAs(state: AuthState): void {
    const ctx = this.requestContext.getOrThrow();
    ctx.orgId = state.orgId;
    ctx.userId = state.userId;
    ctx.isPlatformAdmin = state.isPlatformAdmin;
    ctx.actorType = 'user';
    ctx.actorLabel = `${state.fullName} <${state.email}>`;
  }
}
