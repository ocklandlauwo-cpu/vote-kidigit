import { Injectable, Logger } from '@nestjs/common';
import {
  type AssignableRoleListResponse,
  isAdminLevel,
  type InviteUserRequest,
  type InviteUserResponse,
  type UpdateUserRequest,
  type UserDetail,
  type UserListQuery,
  type UserPage,
  type UserSummary,
} from '@vote-kidigit/shared';
import { AuditQueryService } from '../../audit/audit-query.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuthStateService } from '../../auth/auth-state.service.js';
import type { AuthState } from '../../auth/auth.types.js';
import { SessionService } from '../../auth/session.service.js';
import { TokensService } from '../../auth/tokens.service.js';
import { AppError } from '../../common/app-error.js';
import { errorReason } from '../../common/connection-errors.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import { mayGrant } from '../roles/role-rules.js';
import { byRoleOrder } from '../roles/roles.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

const userSelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  isOrgSuperAdmin: true,
  lastLoginAt: true,
  createdAt: true,
  passwordHash: true,
  userRoles: {
    select: {
      role: {
        select: {
          id: true,
          name: true,
          systemKey: true,
          rolePermissions: { select: { permissionKey: true } },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

interface RoleRow {
  id: string;
  name: string;
  systemKey: string | null;
  permissions: string[];
}

const roleOf = (row: UserRow): RoleRow | null => {
  const role = row.userRoles[0]?.role;
  return role
    ? {
        id: role.id,
        name: role.name,
        systemKey: role.systemKey,
        permissions: role.rolePermissions.map((p) => p.permissionKey),
      }
    : null;
};

const toSummary = (row: UserRow): UserSummary => {
  const role = roleOf(row);
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    status: row.status,
    isOrgSuperAdmin: row.isOrgSuperAdmin,
    role: role ? { id: role.id, name: role.name, systemKey: role.systemKey } : null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
};

/**
 * Staff accounts of the caller's organization (Backend Schema 12.4, App Flow 7.1).
 *
 * Who may act on whom: staff.manage for moderators and observers; admins.manage as well when
 * the user's current or new role is admin-level (ADMIN_LEVEL_PERMISSIONS); only an Org Super
 * Admin acts on an Org Super Admin or hands out that role; nobody changes their own role or
 * deactivates or deletes themselves. The database keeps at least one active Org Super Admin.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auditQuery: AuditQueryService,
    private readonly authState: AuthStateService,
    private readonly sessions: SessionService,
    private readonly tokens: TokensService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /users (USR-01). */
  list(query: UserListQuery): Promise<UserPage> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.status && { status: query.status }),
      ...(query.roleId && { userRoles: { some: { roleId: query.roleId } } }),
      ...(query.q && {
        OR: [
          { fullName: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
          { phone: { contains: query.q } },
        ],
      }),
    };
    return this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      const [rows, total] = await Promise.all([
        tx.user.findMany({
          where,
          orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: userSelect,
        }),
        tx.user.count({ where }),
      ]);
      return { items: rows.map(toSummary), total, page: query.page, pageSize: query.pageSize };
    });
  }

  /** GET /users/roles: every role, and whether the caller may give it (USR-02, USR-03). */
  assignableRoles(actor: AuthState): Promise<AssignableRoleListResponse> {
    return this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      const roles = await tx.role.findMany({
        select: {
          id: true,
          name: true,
          systemKey: true,
          isSystem: true,
          rolePermissions: { select: { permissionKey: true } },
        },
      });
      return {
        items: roles.sort(byRoleOrder).map((role) => ({
          id: role.id,
          name: role.name,
          systemKey: role.systemKey,
          isSystem: role.isSystem,
          assignable: mayGrant(actor, {
            id: role.id,
            systemKey: role.systemKey,
            permissions: role.rolePermissions.map((p) => p.permissionKey),
          }),
        })),
      };
    });
  }

  /** GET /users/:userId (USR-03). */
  detail(userId: string): Promise<UserDetail> {
    return this.prisma.withContext(this.requestContext.getOrThrow(), (tx) =>
      this.loadDetail(tx, userId),
    );
  }

  /** POST /users (USR-02): an invited user with a role; the invitation is queued after commit. */
  async invite(actor: AuthState, body: InviteUserRequest): Promise<InviteUserResponse> {
    const ctx = this.requestContext.getOrThrow();
    const userId = await this.prisma.withContext(ctx, async (tx) => {
      // Accounts are unique across organizations (one organization per account in V1).
      const [taken] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM app.find_user_for_login(${body.email})`;
      if (taken) {
        throw new AppError('VALIDATION_FAILED', 'This email already has an account.', {
          source: 'body',
          issues: [{ path: 'email', code: 'taken', message: 'already has an account' }],
        });
      }
      const role = await this.loadRole(tx, body.roleId);
      this.assertMayGrant(actor, role);
      const user = await tx.user.create({
        data: {
          organizationId: ctx.orgId,
          email: body.email,
          fullName: body.fullName,
          phone: body.phone ?? null,
          status: 'invited',
          isOrgSuperAdmin: role.systemKey === 'org_super_admin',
        },
        select: { id: true },
      });
      await tx.userRole.create({
        data: { userId: user.id, roleId: role.id, organizationId: ctx.orgId ?? '' },
      });
      await this.audit.record(tx, {
        action: 'user.invite',
        entityType: 'users',
        entityId: user.id,
        after: { email: body.email, fullName: body.fullName, phone: body.phone, role: role.name },
      });
      return user.id;
    });
    const invitationSent = await this.queueInvitation(userId);
    return { user: await this.detail(userId), invitationSent };
  }

  /** PATCH /users/:userId: name, phone and role. */
  async update(actor: AuthState, userId: string, body: UpdateUserRequest): Promise<UserDetail> {
    const detail = await this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      const user = await this.loadUser(tx, userId);
      const current = roleOf(user);
      const roleChange = body.roleId !== undefined && body.roleId !== current?.id;
      if (roleChange || userId !== actor.userId) this.assertMayManage(actor, user);
      let next: RoleRow | null = null;
      if (roleChange && body.roleId) {
        if (userId === actor.userId) {
          throw new AppError('FORBIDDEN', 'You cannot change your own role.');
        }
        next = await this.loadRole(tx, body.roleId);
        this.assertMayGrant(actor, next);
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.create({
          data: { userId, roleId: next.id, organizationId: actor.orgId ?? '' },
        });
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(body.fullName !== undefined && { fullName: body.fullName }),
          ...(body.phone !== undefined && { phone: body.phone }),
          ...(next && { isOrgSuperAdmin: next.systemKey === 'org_super_admin' }),
        },
      });
      await this.audit.record(tx, {
        action: next ? 'user.role.change' : 'user.update',
        entityType: 'users',
        entityId: userId,
        before: { fullName: user.fullName, phone: user.phone, role: current?.name ?? null },
        after: {
          fullName: body.fullName ?? user.fullName,
          phone: body.phone === undefined ? user.phone : body.phone,
          role: next?.name ?? current?.name ?? null,
        },
      });
      return this.loadDetail(tx, userId);
    });
    await this.authState.invalidateUser(userId);
    return detail;
  }

  /** POST /users/:userId/deactivate: signed out at once, cannot sign in. */
  async deactivate(actor: AuthState, userId: string): Promise<UserDetail> {
    const detail = await this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      const user = await this.loadUser(tx, userId);
      this.assertNotSelf(actor, userId, 'You cannot deactivate yourself.');
      this.assertMayManage(actor, user);
      if (user.status === 'deactivated') throw new AppError('INVALID_TRANSITION');
      // The rule "not the only moderator of an Open event" joins in step 26.
      await tx.user.update({ where: { id: userId }, data: { status: 'deactivated' } });
      await tx.userToken.deleteMany({ where: { userId, usedAt: null } });
      await this.audit.record(tx, {
        action: 'user.deactivate',
        entityType: 'users',
        entityId: userId,
        before: { status: user.status },
        after: { status: 'deactivated' },
      });
      return this.loadDetail(tx, userId);
    });
    await this.endSessions(userId);
    return detail;
  }

  /** POST /users/:userId/reactivate: active again, or invited if never joined. */
  async reactivate(actor: AuthState, userId: string): Promise<UserDetail> {
    const detail = await this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      const user = await this.loadUser(tx, userId);
      this.assertMayManage(actor, user);
      if (user.status !== 'deactivated') throw new AppError('INVALID_TRANSITION');
      const status = user.passwordHash ? 'active' : 'invited';
      await tx.user.update({ where: { id: userId }, data: { status } });
      await this.audit.record(tx, {
        action: 'user.reactivate',
        entityType: 'users',
        entityId: userId,
        before: { status: 'deactivated' },
        after: { status },
      });
      return this.loadDetail(tx, userId);
    });
    await this.authState.invalidateUser(userId);
    return detail;
  }

  /** POST /users/:userId/resend-invite: a new link; earlier ones stop working. */
  async resendInvite(actor: AuthState, userId: string): Promise<{ invitationSent: boolean }> {
    await this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      const user = await this.loadUser(tx, userId);
      this.assertMayManage(actor, user);
      if (user.status !== 'invited') {
        throw new AppError('INVALID_TRANSITION', 'This user has already joined.');
      }
      await this.audit.record(tx, {
        action: 'user.resend_invite',
        entityType: 'users',
        entityId: userId,
      });
    });
    return { invitationSent: await this.queueInvitation(userId) };
  }

  /** DELETE /users/:userId: soft delete; the email can be invited again. */
  async remove(actor: AuthState, userId: string): Promise<void> {
    await this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      const user = await this.loadUser(tx, userId);
      this.assertNotSelf(actor, userId, 'You cannot delete yourself.');
      this.assertMayManage(actor, user);
      await tx.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(), status: 'deactivated' },
      });
      await tx.userToken.deleteMany({ where: { userId, usedAt: null } });
      await this.audit.record(tx, {
        action: 'user.delete',
        entityType: 'users',
        entityId: userId,
        before: { email: user.email, fullName: user.fullName, status: user.status },
      });
    });
    await this.endSessions(userId);
  }

  private assertNotSelf(actor: AuthState, userId: string, message: string): void {
    if (actor.userId === userId) throw new AppError('FORBIDDEN', message);
  }

  /** May the actor act on this user at all? */
  private assertMayManage(actor: AuthState, user: UserRow): void {
    if (user.isOrgSuperAdmin && !actor.isOrgSuperAdmin) {
      throw new AppError('FORBIDDEN', 'Only an Org Super Admin can change an Org Super Admin.');
    }
    const role = roleOf(user);
    if (role && isAdminLevel(role.permissions) && !actor.permissions.includes('admins.manage')) {
      throw new AppError('FORBIDDEN', 'You cannot manage users with this role.');
    }
  }

  private assertMayGrant(actor: AuthState, role: RoleRow): void {
    if (!mayGrant(actor, role)) throw new AppError('FORBIDDEN', 'You cannot give this role.');
  }

  private async loadUser(tx: Tx, userId: string): Promise<UserRow> {
    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: userSelect,
    });
    if (!user) throw new AppError('NOT_FOUND');
    return user;
  }

  private async loadRole(tx: Tx, roleId: string): Promise<RoleRow> {
    const role = await tx.role.findFirst({
      where: { id: roleId },
      select: {
        id: true,
        name: true,
        systemKey: true,
        rolePermissions: { select: { permissionKey: true } },
      },
    });
    if (!role) {
      throw new AppError('VALIDATION_FAILED', 'This role does not exist.', {
        source: 'body',
        issues: [{ path: 'roleId', code: 'not_found', message: 'does not exist' }],
      });
    }
    return {
      id: role.id,
      name: role.name,
      systemKey: role.systemKey,
      permissions: role.rolePermissions.map((p) => p.permissionKey),
    };
  }

  private async loadDetail(tx: Tx, userId: string): Promise<UserDetail> {
    const user = await this.loadUser(tx, userId);
    const invite =
      user.status === 'invited'
        ? await tx.userToken.findFirst({
            where: { userId, purpose: 'invite', usedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true, expiresAt: true },
          })
        : null;
    const { items } = await this.auditQuery.list(tx, {
      page: 1,
      pageSize: 10,
      aboutUserId: userId,
    });
    // Who did what and when only: values, reasons and IPs need audit.view.org (SYS-01).
    const recentActivity = items.map(({ id, action, actorLabel, createdAt }) => ({
      id,
      action,
      actorLabel,
      createdAt,
    }));
    return {
      ...toSummary(user),
      invitation: invite
        ? { sentAt: invite.createdAt.toISOString(), expiresAt: invite.expiresAt.toISOString() }
        : null,
      recentActivity,
    };
  }

  private async queueInvitation(userId: string): Promise<boolean> {
    try {
      await this.tokens.sendInvitation(userId, this.requestContext.getOrThrow().orgId);
      return true;
    } catch (error: unknown) {
      this.logger.error({ msg: 'invitation not queued', userId, reason: errorReason(error) });
      return false;
    }
  }

  private async endSessions(userId: string): Promise<void> {
    await this.authState.invalidateUser(userId);
    await this.sessions.destroyAllForUser(userId);
  }
}
