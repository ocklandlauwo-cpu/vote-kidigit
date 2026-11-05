import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ChangePasswordRequest,
  LoginRequest,
  MeResponse,
  UpdateMeRequest,
} from '@vote-kidigit/shared';
import type { Request } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { Env } from '../config/env.schema.js';
import { RequestContextService } from '../context/request-context.js';
import { type DbContext, PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { AuthStateService } from './auth-state.service.js';
import type { AuthState } from './auth.types.js';
import { advancePasswordEpoch, assertNotReused, savePassword } from './password-store.js';
import { verifyAgainstDummy, verifyPassword } from './passwords.js';
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

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/** Failure counts start again after a day without failures, for accounts and unknown emails alike. */
export const FAILURE_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Failure counter for unknown emails, mirroring the account lockout exactly: the count lives for
 * FAILURE_WINDOW_SECONDS after the latest failure (accounts: last_failed_login_at), and the lock
 * stores its absolute unlock time, returned unchanged while it lasts (accounts: locked_until).
 * Returns that unlock time in epoch ms, or 0 when not locked.
 * KEYS: count, lock; ARGV: max attempts, lock ms, now ms, window seconds.
 */
const UNKNOWN_EMAIL_SCRIPT = `
local lockedUntil = redis.call('GET', KEYS[2])
if lockedUntil then return tonumber(lockedUntil) end
local count = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[4])
if count >= tonumber(ARGV[1]) then
  local unlock = tonumber(ARGV[3]) + tonumber(ARGV[2])
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], tostring(unlock), 'PX', ARGV[2])
  return unlock
end
return 0
`;

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
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.maxAttempts = config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    this.lockMinutes = config.get('LOGIN_LOCK_MINUTES', { infer: true });
  }

  /**
   * POST /auth/login. Unknown emails, wrong passwords and pending invitations get the same
   * answer with the same timing, and unknown emails are locked after the same number of failures
   * as real accounts, so neither INVALID_CREDENTIALS nor ACCOUNT_LOCKED reveals whether an
   * account exists. The account status is only revealed after a correct password.
   */
  async login(body: LoginRequest, req: Request): Promise<MeResponse> {
    // Taken before the password hash is read: if the password changes while this sign-in is
    // verifying the old one, the new session counts as issued before the change and AuthGuard
    // rejects it.
    const issuedAt = Date.now();
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
      // Unknown email or invitation not yet accepted.
      await verifyAgainstDummy(body.password);
      return this.failUnknownEmail(body.email);
    }

    const userContext: DbContext = {
      orgId: row.organization_id,
      userId: row.id,
      isPlatformAdmin: row.is_platform_admin,
      requestId: ctx.requestId,
    };
    const now = new Date();
    // The password is always checked, so a locked account answers in the same time.
    const valid = await verifyPassword(row.password_hash, body.password);
    if (row.locked_until && row.locked_until > now) {
      throw new AppError('ACCOUNT_LOCKED', undefined, {
        lockedUntil: row.locked_until.toISOString(),
      });
    }

    if (!valid) {
      const lockedUntil = await this.recordFailure(userContext, 'auth.login');
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
      // Conditional: a lock set by a concurrent wrong attempt while this one was verifying
      // the password still wins.
      const unlocked = await tx.$queryRaw<{ id: string }[]>`
        UPDATE public.users
        SET failed_login_count = 0, locked_until = NULL, last_failed_login_at = NULL,
            last_login_at = now()
        WHERE id = ${row.id}::uuid AND (locked_until IS NULL OR locked_until <= now())
        RETURNING id`;
      if (unlocked.length === 0) {
        const { lockedUntil } = await tx.user.findUniqueOrThrow({
          where: { id: row.id },
          select: { lockedUntil: true },
        });
        throw new AppError('ACCOUNT_LOCKED', undefined, {
          lockedUntil: (lockedUntil ?? now).toISOString(),
        });
      }
    });

    await this.authState.invalidateUser(row.id);
    const state = await this.authState.get({
      userId: row.id,
      orgId: row.organization_id,
      isPlatformAdmin: row.is_platform_admin,
    });
    if (!state) throw new AppError('INVALID_CREDENTIALS');

    await this.startSession(state, req, issuedAt);
    this.actAsUser(state);
    await this.prisma.withContext(userContext, (tx) =>
      this.audit.record(tx, { action: 'auth.login', entityType: 'users', entityId: state.userId }),
    );
    return this.toMe(state, req);
  }

  /**
   * Starts a staff session for the user under a new session id (no session fixation).
   * `issuedAt` must not be later than the moment the password hash was verified or set.
   */
  async startSession(state: AuthState, req: Request, issuedAt: number): Promise<void> {
    await regenerate(req);
    req.session.userId = state.userId;
    req.session.orgId = state.orgId;
    req.session.isPlatformAdmin = state.isPlatformAdmin;
    req.session.csrf = randomBytes(32).toString('base64url');
    req.session.timeoutMinutes = state.sessionTimeoutMinutes;
    req.session.issuedAt = issuedAt;
    req.session.cookie.maxAge = state.sessionTimeoutMinutes * 60_000;
    await this.sessions.track(state.userId, req.sessionID, state.sessionTimeoutMinutes);
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
    const context = this.dbContext();
    const current = await this.prisma.withContext(context, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { passwordHash: true } }),
    );
    if (
      !current.passwordHash ||
      !(await verifyPassword(current.passwordHash, body.currentPassword))
    ) {
      // A wrong current password counts towards the account lockout, in its own committed
      // transaction (this request fails); at the lock every session of the user ends.
      const lockedUntil = await this.recordFailure(context, 'me.password');
      if (lockedUntil) {
        await this.sessions.destroyAllForUser(auth.userId);
        await destroy(req);
        throw new AppError('ACCOUNT_LOCKED', undefined, { lockedUntil: lockedUntil.toISOString() });
      }
      throw new AppError('VALIDATION_FAILED', 'Current password is incorrect.', {
        source: 'body',
        issues: [{ path: 'currentPassword', code: 'incorrect', message: 'is incorrect' }],
      });
    }

    await this.prisma.withContext(context, async (tx) => {
      await assertNotReused(tx, auth.userId, body.newPassword);
      await savePassword(tx, auth.userId, body.newPassword);
      await this.audit.record(tx, {
        action: 'me.password.change',
        entityType: 'users',
        entityId: auth.userId,
      });
    });

    // Other sessions end twice over: explicitly here, and through the session epoch, since
    // AuthGuard rejects any session issued before passwordChangedAt.
    const changedAt = await advancePasswordEpoch(this.prisma, context, auth.userId);
    await this.authState.invalidateUser(auth.userId);
    const { csrf, timeoutMinutes } = req.session;
    await this.sessions.destroyAllForUser(auth.userId, req.sessionID);
    await regenerate(req);
    Object.assign(req.session, {
      userId: auth.userId,
      orgId: auth.orgId,
      isPlatformAdmin: auth.isPlatformAdmin,
      csrf,
      timeoutMinutes,
      // Strictly after the change, which AuthGuard compares with <=.
      issuedAt: Math.max(Date.now(), changedAt.getTime() + 1),
    });
    req.session.cookie.maxAge = auth.sessionTimeoutMinutes * 60_000;
    await this.sessions.track(auth.userId, req.sessionID, auth.sessionTimeoutMinutes);
  }

  /**
   * Counts a wrong password against an account and locks it at LOGIN_MAX_ATTEMPTS, in one
   * statement so concurrent attempts cannot each read the old count. Audited. Returns the
   * unlock time when the account is now locked.
   */
  private async recordFailure(
    context: DbContext,
    actionPrefix: 'auth.login' | 'me.password',
  ): Promise<Date | null> {
    const userId = context.userId;
    if (!userId) throw new Error('recordFailure needs a user');
    return this.prisma.withContext(context, async (tx) => {
      const [row] = await tx.$queryRaw<{ locked_until: Date | null; locked_now: boolean }[]>`
        WITH current AS (
          SELECT id,
                 CASE WHEN last_failed_login_at > now() - make_interval(secs => ${FAILURE_WINDOW_SECONDS})
                      THEN failed_login_count ELSE 0 END + 1 AS attempts
          FROM public.users WHERE id = ${userId}::uuid FOR UPDATE
        )
        UPDATE public.users u SET
          failed_login_count = CASE WHEN c.attempts >= ${this.maxAttempts} THEN 0 ELSE c.attempts END,
          locked_until = CASE WHEN c.attempts >= ${this.maxAttempts}
                              THEN now() + make_interval(mins => ${this.lockMinutes})
                              ELSE u.locked_until END,
          last_failed_login_at = now()
        FROM current c
        WHERE u.id = c.id
        RETURNING locked_until, (locked_until > now()) AS locked_now`;
      const lockedUntil = row?.locked_now ? row.locked_until : null;
      await this.audit.record(tx, {
        action: `${actionPrefix}.${lockedUntil ? 'locked' : 'failed'}`,
        entityType: 'users',
        entityId: userId,
        organizationId: context.orgId,
      });
      return lockedUntil;
    });
  }

  /**
   * Unknown emails get the same lockout as real accounts (counted in Redis per normalized
   * email), so ACCOUNT_LOCKED does not reveal that an account exists.
   */
  private async failUnknownEmail(email: string): Promise<never> {
    const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    const lockedUntil = (await this.redis.eval(
      UNKNOWN_EMAIL_SCRIPT,
      2,
      `login-unknown:${digest}:count`,
      `login-unknown:${digest}:lock`,
      this.maxAttempts,
      this.lockMinutes * 60_000,
      Date.now(),
      FAILURE_WINDOW_SECONDS,
    )) as number;
    if (lockedUntil > 0) {
      throw new AppError('ACCOUNT_LOCKED', undefined, {
        lockedUntil: new Date(lockedUntil).toISOString(),
      });
    }
    throw new AppError('INVALID_CREDENTIALS');
  }

  private dbContext(): DbContext {
    const { orgId, userId, isPlatformAdmin, requestId } = this.requestContext.getOrThrow();
    return { orgId, userId, isPlatformAdmin, requestId };
  }

  /**
   * On a public route (sign-in, invitation, reset) the request acts as the user from here on,
   * for the audit log: AuthGuard did not run.
   */
  actAsUser(
    state: Pick<AuthState, 'userId' | 'orgId' | 'isPlatformAdmin' | 'fullName' | 'email'>,
  ): void {
    const ctx = this.requestContext.getOrThrow();
    ctx.orgId = state.orgId;
    ctx.userId = state.userId;
    ctx.isPlatformAdmin = state.isPlatformAdmin;
    ctx.actorType = 'user';
    ctx.actorLabel = `${state.fullName} <${state.email}>`;
  }
}
