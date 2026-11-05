import { Injectable } from '@nestjs/common';
import {
  type CreateRoleRequest,
  FIXED_SUPER_ADMIN_PERMISSIONS,
  type PermissionKey,
  type Role,
  type RoleListResponse,
  systemRoleKeys,
  type UpdateRoleRequest,
} from '@vote-kidigit/shared';
import { AuditService } from '../../audit/audit.service.js';
import { AuthStateService } from '../../auth/auth-state.service.js';
import type { AuthState } from '../../auth/auth.types.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { assertMayEditRole, mayGrant } from './role-rules.js';

const roleSelect = {
  id: true,
  name: true,
  description: true,
  systemKey: true,
  isSystem: true,
  rolePermissions: { select: { permissionKey: true }, orderBy: { permissionKey: 'asc' } },
  _count: { select: { userRoles: { where: { user: { deletedAt: null } } } } },
} satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;

const toRole = (row: RoleRow): Role => ({
  id: row.id,
  name: row.name,
  description: row.description,
  systemKey: row.systemKey,
  isSystem: row.isSystem,
  userCount: row._count.userRoles,
  permissions: row.rolePermissions.map((p) => p.permissionKey as PermissionKey),
});

/** Default roles first in their fixed order (Backend Schema 9.2), then custom roles by name. */
export function byRoleOrder(
  a: { systemKey: string | null; name: string },
  b: { systemKey: string | null; name: string },
): number {
  const rank = (key: string | null) => {
    const index = key ? (systemRoleKeys as readonly string[]).indexOf(key) : -1;
    return index === -1 ? systemRoleKeys.length : index;
  };
  return rank(a.systemKey) - rank(b.systemKey) || a.name.localeCompare(b.name);
}

const taken = (path: string, message: string) =>
  new AppError('VALIDATION_FAILED', message, {
    source: 'body',
    issues: [{ path, code: 'taken', message }],
  });

/**
 * Roles of the caller's organization (USR-04, USR-05). Default roles keep their name and cannot
 * be deleted, but their permissions can change, except that Org Super Admin always keeps
 * roles.manage. A changed role takes effect for its users at once (invalidateOrg).
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authState: AuthStateService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /roles: default roles first, then custom roles by name. */
  list(): Promise<RoleListResponse> {
    return this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      const rows = await tx.role.findMany({ select: roleSelect });
      return { items: rows.sort(byRoleOrder).map(toRole) };
    });
  }

  detail(roleId: string): Promise<Role> {
    return this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) =>
      toRole(await this.load(tx, roleId)),
    );
  }

  /** POST /roles (also "Duplicate", with the copied permissions). */
  async create(actor: AuthState, body: CreateRoleRequest): Promise<Role> {
    const ctx = this.requestContext.getOrThrow();
    assertMayEditRole(actor, { id: '', systemKey: null, permissions: [] }, body.permissions);
    const role = await this.prisma.withContext(ctx, async (tx) => {
      await this.assertNameFree(tx, body.name);
      const { id } = await tx.role.create({
        data: {
          organizationId: ctx.orgId ?? '',
          name: body.name,
          description: body.description ?? null,
        },
        select: { id: true },
      });
      // role_permissions refers to the role by (role_id, organization_id), so it is written
      // separately rather than as a nested create.
      await tx.rolePermission.createMany({
        data: [...new Set(body.permissions)].map((permissionKey) => ({
          roleId: id,
          permissionKey,
          organizationId: ctx.orgId ?? '',
        })),
      });
      const created = await this.load(tx, id);
      await this.audit.record(tx, {
        action: 'role.create',
        entityType: 'roles',
        entityId: created.id,
        after: { name: created.name, permissions: toRole(created).permissions },
      });
      return toRole(created);
    });
    return role;
  }

  /** PATCH /roles/:roleId */
  async update(actor: AuthState, roleId: string, body: UpdateRoleRequest): Promise<Role> {
    const ctx = this.requestContext.getOrThrow();
    const role = await this.prisma.withContext(ctx, async (tx) => {
      const before = await this.load(tx, roleId);
      const current = toRole(before).permissions;
      assertMayEditRole(
        actor,
        { id: roleId, systemKey: before.systemKey, permissions: current },
        body.permissions ?? current,
      );
      if (before.isSystem && (body.name !== undefined || body.description !== undefined)) {
        throw new AppError('FORBIDDEN', 'Default roles cannot be renamed.');
      }
      if (body.name !== undefined && body.name !== before.name) {
        await this.assertNameFree(tx, body.name);
      }
      if (body.permissions && before.systemKey === 'org_super_admin') {
        const missing = FIXED_SUPER_ADMIN_PERMISSIONS.filter((k) => !body.permissions?.includes(k));
        if (missing.length) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Org Super Admin always keeps these permissions.',
            {
              source: 'body',
              issues: missing.map((key) => ({ path: 'permissions', code: 'fixed', message: key })),
            },
          );
        }
      }
      await tx.role.update({
        where: { id: roleId },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.description !== undefined && { description: body.description }),
        },
      });
      if (body.permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: [...new Set(body.permissions)].map((permissionKey) => ({
            roleId,
            permissionKey,
            organizationId: ctx.orgId ?? '',
          })),
        });
      }
      const after = await this.load(tx, roleId);
      const [b, a] = [toRole(before), toRole(after)];
      await this.audit.record(tx, {
        action: 'role.update',
        entityType: 'roles',
        entityId: roleId,
        before: { name: b.name, description: b.description, permissions: b.permissions },
        after: { name: a.name, description: a.description, permissions: a.permissions },
      });
      return a;
    });
    await this.authState.invalidateOrg(ctx.orgId ?? '');
    return role;
  }

  /**
   * DELETE /roles/:roleId: custom roles only. A role in use needs moveToRoleId; its users move
   * there in the same transaction.
   */
  async remove(actor: AuthState, roleId: string, moveToRoleId: string | undefined): Promise<void> {
    const ctx = this.requestContext.getOrThrow();
    await this.prisma.withContext(ctx, async (tx) => {
      const role = await this.load(tx, roleId);
      if (role.isSystem) throw new AppError('FORBIDDEN', 'Default roles cannot be deleted.');
      assertMayEditRole(
        actor,
        { id: roleId, systemKey: role.systemKey, permissions: toRole(role).permissions },
        [],
      );
      const users = role._count.userRoles;
      let target: RoleRow | null = null;
      if (users > 0) {
        if (!moveToRoleId) {
          throw new AppError('INVALID_TRANSITION', 'Move the users of this role first.', {
            reason: 'ROLE_IN_USE',
            userCount: users,
          });
        }
        target = await this.load(tx, moveToRoleId);
        // Moving users gives them the target role: the same rule as a role change.
        const targetFacts = {
          id: target.id,
          systemKey: target.systemKey,
          permissions: toRole(target).permissions,
        };
        if (!mayGrant(actor, targetFacts)) {
          throw new AppError('FORBIDDEN', 'You cannot give this role.');
        }
        if (target.id === roleId || target.systemKey === 'org_super_admin') {
          throw new AppError('VALIDATION_FAILED', 'Choose another role for these users.', {
            source: 'query',
            issues: [{ path: 'moveToRoleId', code: 'invalid', message: 'choose another role' }],
          });
        }
      }
      // Deleted users keep no role.
      await tx.userRole.deleteMany({ where: { roleId, user: { deletedAt: { not: null } } } });
      if (target) {
        await tx.userRole.updateMany({ where: { roleId }, data: { roleId: target.id } });
      }
      await tx.role.delete({ where: { id: roleId } });
      await this.audit.record(tx, {
        action: 'role.delete',
        entityType: 'roles',
        entityId: roleId,
        before: { name: role.name, permissions: toRole(role).permissions },
        after: target ? { usersMovedTo: target.name, userCount: users } : null,
      });
    });
    await this.authState.invalidateOrg(ctx.orgId ?? '');
  }

  private async load(tx: Tx, roleId: string): Promise<RoleRow> {
    const role = await tx.role.findFirst({ where: { id: roleId }, select: roleSelect });
    if (!role) throw new AppError('NOT_FOUND');
    return role;
  }

  private async assertNameFree(tx: Tx, name: string): Promise<void> {
    const existing = await tx.role.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) throw taken('name', 'A role with this name already exists.');
  }
}
