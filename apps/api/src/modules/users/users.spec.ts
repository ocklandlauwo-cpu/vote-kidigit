// Integration test of users, roles, organization settings and the audit log (Implementation
// Plan step 14, Backend Schema 12.4): invitations, role edits, deactivation rules and the audit
// entries each change writes.
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  type AssignableRoleListResponse,
  type AuditPage,
  type InviteUserResponse,
  type MeResponse,
  type OrganizationSettings,
  type Role,
  type RoleListResponse,
  type SystemRoleKey,
  type UserDetail,
  UserPageSchema,
} from '@vote-kidigit/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  apiClient,
  createOrganization,
  createUser,
  deleteOrganizations,
  ownerClient,
  platformContext,
  uniqueSuffix,
} from '../../testing/db.js';
import { createTestHttpApp, testIp } from '../../testing/http.js';

const PASSWORD = 'Uchaguzi2027';
const codeOf = (res: request.Response) => (res.body as { code?: string }).code;

interface Staff {
  id: string;
  email: string;
  agent: TestAgent;
  csrf: string;
}

describe('users, roles, organization and audit', () => {
  let app: NestExpressApplication;
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  let otherOrgId: string;
  const roleIds = {} as Record<SystemRoleKey, string>;
  const staff = {} as Record<'superAdmin' | 'admin' | 'moderator', Staff>;
  const orgIds: string[] = [];

  const server = () => app.getHttpServer();

  async function signIn(email: string, password = PASSWORD) {
    const agent = request.agent(server()).set('X-Forwarded-For', testIp());
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    return { agent, res, csrf: (res.body as MeResponse).csrfToken };
  }

  async function newStaff(
    role: SystemRoleKey,
    org = orgId,
  ): Promise<Omit<Staff, 'agent' | 'csrf'>> {
    const email = `${role}-${uniqueSuffix()}@example.test`;
    const id = await createUser(owner, org, {
      email,
      password: PASSWORD,
      isOrgSuperAdmin: role === 'org_super_admin',
    });
    const roleId =
      org === orgId
        ? roleIds[role]
        : (await owner.role.findFirstOrThrow({ where: { organizationId: org, systemKey: role } }))
            .id;
    await owner.userRole.create({ data: { userId: id, roleId, organizationId: org } });
    return { id, email };
  }

  async function signedIn(role: SystemRoleKey): Promise<Staff> {
    const user = await newStaff(role);
    const { agent, csrf } = await signIn(user.email);
    return { ...user, agent, csrf };
  }

  const send = (who: Staff, method: 'post' | 'patch' | 'delete', path: string, body?: object) =>
    who.agent[method](`/api/v1${path}`).set('X-CSRF-Token', who.csrf).send(body);

  async function auditCount(action: string, entityId: string) {
    return owner.auditLog.count({ where: { action, entityId } });
  }

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Ushirika');
    otherOrgId = await createOrganization(owner, 'Shirika Jingine');
    orgIds.push(orgId, otherOrgId);
    for (const id of [orgId, otherOrgId]) {
      await api.withContext(
        platformContext(),
        (tx) => tx.$executeRaw`SELECT app.create_default_roles(${id}::uuid)`,
      );
    }
    for (const role of await owner.role.findMany({ where: { organizationId: orgId } })) {
      roleIds[role.systemKey as SystemRoleKey] = role.id;
    }
    staff.superAdmin = await signedIn('org_super_admin');
    staff.admin = await signedIn('admin');
    staff.moderator = await signedIn('moderator');
  });

  afterAll(async () => {
    await deleteOrganizations(owner, orgIds);
    await owner.$disconnect();
    await api.$disconnect();
    await app.close();
  });

  describe('invite', () => {
    it('invites a moderator: invited status, role, audit entry, invitation queued', async () => {
      const email = `new-${uniqueSuffix()}@example.test`;
      const res = await send(staff.admin, 'post', '/users', {
        fullName: 'Juma Ali',
        email: email.toUpperCase(),
        phone: '+255712000111',
        roleId: roleIds.moderator,
      }).expect(201);
      const body = res.body as InviteUserResponse;
      expect(body.invitationSent).toBe(true);
      expect(body.user).toMatchObject({
        email,
        fullName: 'Juma Ali',
        status: 'invited',
        isOrgSuperAdmin: false,
        role: { id: roleIds.moderator, systemKey: 'moderator' },
      });
      expect(await auditCount('user.invite', body.user.id)).toBe(1);
      expect(body.user.recentActivity.map((e) => e.action)).toContain('user.invite');
    });

    it('needs admins.manage to invite an Admin or an Org Super Admin', async () => {
      for (const role of ['admin', 'org_super_admin'] as const) {
        const res = await send(staff.admin, 'post', '/users', {
          fullName: 'Juma Ali',
          email: `x-${uniqueSuffix()}@example.test`,
          roleId: roleIds[role],
        }).expect(403);
        expect(codeOf(res)).toBe('FORBIDDEN');
      }
      const res = await send(staff.superAdmin, 'post', '/users', {
        fullName: 'Neema Mushi',
        email: `sa-${uniqueSuffix()}@example.test`,
        roleId: roleIds.org_super_admin,
      }).expect(201);
      expect((res.body as InviteUserResponse).user.isOrgSuperAdmin).toBe(true);
    });

    it('refuses an email that already has an account, in any organization', async () => {
      const other = await newStaff('moderator', otherOrgId);
      const res = await send(staff.admin, 'post', '/users', {
        fullName: 'Juma Ali',
        email: other.email,
        roleId: roleIds.moderator,
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain('"path":"email"');
    });

    it('refuses a role of another organization', async () => {
      const foreign = await owner.role.findFirstOrThrow({
        where: { organizationId: otherOrgId, systemKey: 'moderator' },
      });
      await send(staff.admin, 'post', '/users', {
        fullName: 'Juma Ali',
        email: `x-${uniqueSuffix()}@example.test`,
        roleId: foreign.id,
      }).expect(400);
    });

    it('is not open to moderators', async () => {
      await send(staff.moderator, 'post', '/users', {
        fullName: 'Juma Ali',
        email: `x-${uniqueSuffix()}@example.test`,
        roleId: roleIds.observer,
      }).expect(403);
    });
  });

  describe('assignable roles', () => {
    it('lists every role and which ones the caller may give', async () => {
      const assignable = async (who: Staff): Promise<Record<string, boolean>> => {
        const res = await who.agent.get('/api/v1/users/roles').expect(200);
        const { items } = res.body as AssignableRoleListResponse;
        const bySystemKey: Record<string, boolean> = {};
        for (const role of items) if (role.systemKey) bySystemKey[role.systemKey] = role.assignable;
        return bySystemKey;
      };
      expect(await assignable(staff.admin)).toEqual({
        org_super_admin: false,
        admin: false,
        moderator: true,
        observer: true,
      });
      expect(await assignable(staff.superAdmin)).toEqual({
        org_super_admin: true,
        admin: true,
        moderator: true,
        observer: true,
      });
      await staff.moderator.agent.get('/api/v1/users/roles').expect(403);
    });
  });

  describe('list and detail', () => {
    it('searches and filters by status and role within the organization', async () => {
      const tag = uniqueSuffix();
      await send(staff.admin, 'post', '/users', {
        fullName: `Asha ${tag}`,
        email: `asha-${tag}@example.test`,
        roleId: roleIds.observer,
      }).expect(201);
      const all = UserPageSchema.parse(
        (await staff.admin.agent.get('/api/v1/users').query({ q: tag }).expect(200)).body,
      );
      expect(all.items.map((u) => u.fullName)).toEqual([`Asha ${tag}`]);
      const observers = UserPageSchema.parse(
        (
          await staff.admin.agent
            .get('/api/v1/users')
            .query({ roleId: roleIds.observer, status: 'invited' })
            .expect(200)
        ).body,
      );
      expect(
        observers.items.every((u) => u.role?.systemKey === 'observer' && u.status === 'invited'),
      ).toBe(true);
      const everyone = UserPageSchema.parse(
        (await staff.admin.agent.get('/api/v1/users').query({ pageSize: 100 }).expect(200)).body,
      );
      expect(
        everyone.items.some((u) => u.email.startsWith('moderator-') && u.id === staff.moderator.id),
      ).toBe(true);
    });

    it('answers 404 for users of other organizations', async () => {
      const other = await newStaff('moderator', otherOrgId);
      await staff.admin.agent.get(`/api/v1/users/${other.id}`).expect(404);
      await send(staff.admin, 'post', `/users/${other.id}/deactivate`).expect(404);
      await staff.admin.agent.get(`/api/v1/users/${randomUUID()}`).expect(404);
    });
  });

  describe('role changes', () => {
    it('lets an Admin move a moderator to observer, with an audit entry and at once', async () => {
      const user = await signedIn('moderator');
      const res = await send(staff.admin, 'patch', `/users/${user.id}`, {
        roleId: roleIds.observer,
        fullName: 'Mwangalizi Mpya',
      }).expect(200);
      expect((res.body as UserDetail).role?.systemKey).toBe('observer');
      const me = (await user.agent.get('/api/v1/me').expect(200)).body as MeResponse;
      expect(me.role?.systemKey).toBe('observer');
      expect(me.permissions).not.toContain('event.edit');
      const entry = await owner.auditLog.findFirstOrThrow({
        where: { action: 'user.role.change', entityId: user.id },
      });
      expect(entry.before).toMatchObject({ role: 'Moderator' });
      expect(entry.after).toMatchObject({ role: 'Observer', fullName: 'Mwangalizi Mpya' });
    });

    it('keeps admin-level roles for users with admins.manage', async () => {
      const user = await newStaff('moderator');
      await send(staff.admin, 'patch', `/users/${user.id}`, { roleId: roleIds.admin }).expect(403);
      const admin2 = await newStaff('admin');
      await send(staff.admin, 'patch', `/users/${admin2.id}`, { roleId: roleIds.observer }).expect(
        403,
      );
      await send(staff.superAdmin, 'patch', `/users/${user.id}`, { roleId: roleIds.admin }).expect(
        200,
      );
    });

    it('never lets anyone change their own role', async () => {
      const res = await send(staff.superAdmin, 'patch', `/users/${staff.superAdmin.id}`, {
        roleId: roleIds.admin,
      }).expect(403);
      expect(codeOf(res)).toBe('FORBIDDEN');
      // Own name and phone are fine.
      await send(staff.admin, 'patch', `/users/${staff.admin.id}`, {
        phone: '+255700000002',
      }).expect(200);
    });

    it('turns a user into an Org Super Admin with the role, and back', async () => {
      const user = await newStaff('admin');
      const up = await send(staff.superAdmin, 'patch', `/users/${user.id}`, {
        roleId: roleIds.org_super_admin,
      }).expect(200);
      expect((up.body as UserDetail).isOrgSuperAdmin).toBe(true);
      const down = await send(staff.superAdmin, 'patch', `/users/${user.id}`, {
        roleId: roleIds.admin,
      }).expect(200);
      expect((down.body as UserDetail).isOrgSuperAdmin).toBe(false);
    });
  });

  describe('deactivation', () => {
    it('deactivates a moderator: signed out at once, cannot sign in, reactivates', async () => {
      const user = await signedIn('moderator');
      const res = await send(staff.admin, 'post', `/users/${user.id}/deactivate`).expect(200);
      expect((res.body as UserDetail).status).toBe('deactivated');
      await user.agent.get('/api/v1/me').expect(401);
      expect(codeOf((await signIn(user.email)).res)).toBe('ACCOUNT_INACTIVE');
      expect(await auditCount('user.deactivate', user.id)).toBe(1);
      await send(staff.admin, 'post', `/users/${user.id}/deactivate`).expect(409);

      const back = await send(staff.admin, 'post', `/users/${user.id}/reactivate`).expect(200);
      expect((back.body as UserDetail).status).toBe('active');
      expect((await signIn(user.email)).res.status).toBe(200);
      expect(await auditCount('user.reactivate', user.id)).toBe(1);
    });

    it('reactivates a never-joined user as invited', async () => {
      const res = await send(staff.admin, 'post', '/users', {
        fullName: 'Juma Ali',
        email: `x-${uniqueSuffix()}@example.test`,
        roleId: roleIds.observer,
      }).expect(201);
      const id = (res.body as InviteUserResponse).user.id;
      await send(staff.admin, 'post', `/users/${id}/deactivate`).expect(200);
      const back = await send(staff.admin, 'post', `/users/${id}/reactivate`).expect(200);
      expect((back.body as UserDetail).status).toBe('invited');
    });

    it('does not let Admins deactivate Org Super Admins or other Admins', async () => {
      const sa = await newStaff('org_super_admin');
      const admin2 = await newStaff('admin');
      expect(
        codeOf(await send(staff.admin, 'post', `/users/${sa.id}/deactivate`).expect(403)),
      ).toBe('FORBIDDEN');
      await send(staff.admin, 'post', `/users/${admin2.id}/deactivate`).expect(403);
      await send(staff.superAdmin, 'post', `/users/${sa.id}/deactivate`).expect(200);
    });

    it('does not let anyone deactivate or delete themselves', async () => {
      await send(staff.superAdmin, 'post', `/users/${staff.superAdmin.id}/deactivate`).expect(403);
      await send(staff.admin, 'delete', `/users/${staff.admin.id}`).expect(403);
    });
  });

  describe('resend invitation and delete', () => {
    it('resends only while invited', async () => {
      const res = await send(staff.admin, 'post', '/users', {
        fullName: 'Juma Ali',
        email: `x-${uniqueSuffix()}@example.test`,
        roleId: roleIds.observer,
      }).expect(201);
      const id = (res.body as InviteUserResponse).user.id;
      const again = await send(staff.admin, 'post', `/users/${id}/resend-invite`).expect(200);
      expect(again.body).toEqual({ invitationSent: true });
      expect(await auditCount('user.resend_invite', id)).toBe(1);
      await send(staff.admin, 'post', `/users/${staff.moderator.id}/resend-invite`).expect(409);
    });

    it('soft-deletes a user, ends their sessions and frees the email', async () => {
      const user = await signedIn('observer');
      await send(staff.admin, 'delete', `/users/${user.id}`).expect(204);
      await user.agent.get('/api/v1/me').expect(401);
      await staff.admin.agent.get(`/api/v1/users/${user.id}`).expect(404);
      expect(await auditCount('user.delete', user.id)).toBe(1);
      const row = await owner.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.deletedAt).not.toBeNull();
      await send(staff.admin, 'post', '/users', {
        fullName: 'Tena',
        email: user.email,
        roleId: roleIds.observer,
      }).expect(201);
    });
  });

  describe('roles', () => {
    it('lists the default roles with their permissions and user counts', async () => {
      const res = await staff.superAdmin.agent.get('/api/v1/roles').expect(200);
      const roles = (res.body as RoleListResponse).items;
      const moderator = roles.find((r) => r.systemKey === 'moderator');
      expect(moderator?.isSystem).toBe(true);
      expect(roles.slice(0, 4).map((r) => r.systemKey)).toEqual([
        'org_super_admin',
        'admin',
        'moderator',
        'observer',
      ]);
      expect(moderator?.permissions).toContain('event.publish');
      expect(moderator?.userCount).toBeGreaterThan(0);
      await staff.admin.agent.get('/api/v1/roles').expect(403);
    });

    it('creates and edits a custom role; its users get the change at once', async () => {
      const created = await send(staff.superAdmin, 'post', '/roles', {
        name: `Karani ${uniqueSuffix()}`,
        description: 'Voters only',
        permissions: ['event.view', 'voter.view', 'voter.view'],
      }).expect(201);
      const role = created.body as Role;
      expect(role.permissions).toEqual(['event.view', 'voter.view']);
      expect(await auditCount('role.create', role.id)).toBe(1);

      const clerk = await newStaff('observer');
      await send(staff.superAdmin, 'patch', `/users/${clerk.id}`, { roleId: role.id }).expect(200);
      const { agent } = await signIn(clerk.email);

      await send(staff.superAdmin, 'patch', `/roles/${role.id}`, {
        permissions: ['event.view', 'voter.view', 'voter.manage'],
      }).expect(200);
      const me = (await agent.get('/api/v1/me').expect(200)).body as MeResponse;
      expect(me.permissions).toContain('voter.manage');
      const entry = await owner.auditLog.findFirstOrThrow({
        where: { action: 'role.update', entityId: role.id },
      });
      expect(entry.after).toMatchObject({
        permissions: ['event.view', 'voter.manage', 'voter.view'],
      });
    });

    it('validates names and permissions', async () => {
      const name = `Jina ${uniqueSuffix()}`;
      await send(staff.superAdmin, 'post', '/roles', { name, permissions: [] }).expect(201);
      expect(
        JSON.stringify(
          (
            await send(staff.superAdmin, 'post', '/roles', {
              name: name.toUpperCase(),
              permissions: [],
            }).expect(400)
          ).body,
        ),
      ).toContain('"path":"name"');
      await send(staff.superAdmin, 'post', '/roles', {
        name: `P ${uniqueSuffix()}`,
        permissions: ['platform.orgs.manage'],
      }).expect(400);
      await send(staff.superAdmin, 'post', '/roles', {
        name: `P ${uniqueSuffix()}`,
        permissions: ['no.such.permission'],
      }).expect(400);
    });

    it('keeps default role names and the fixed Org Super Admin permission', async () => {
      await send(staff.superAdmin, 'patch', `/roles/${roleIds.moderator}`, {
        name: 'Msimamizi',
      }).expect(403);
      const sa = (
        await staff.superAdmin.agent.get(`/api/v1/roles/${roleIds.org_super_admin}`).expect(200)
      ).body as Role;
      const without = sa.permissions.filter((p) => p !== 'roles.manage');
      const res = await send(staff.superAdmin, 'patch', `/roles/${roleIds.org_super_admin}`, {
        permissions: without,
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain('roles.manage');
      // Default role permissions themselves can change.
      const observer = (
        await staff.superAdmin.agent.get(`/api/v1/roles/${roleIds.observer}`).expect(200)
      ).body as Role;
      await send(staff.superAdmin, 'patch', `/roles/${roleIds.observer}`, {
        permissions: [...observer.permissions, 'kiosk.operate'],
      }).expect(200);
      await send(staff.superAdmin, 'patch', `/roles/${roleIds.observer}`, {
        permissions: observer.permissions,
      }).expect(200);
    });

    it('deletes a custom role, moving its users first', async () => {
      const role = (
        await send(staff.superAdmin, 'post', '/roles', {
          name: `Muda ${uniqueSuffix()}`,
          permissions: ['event.view'],
        }).expect(201)
      ).body as Role;
      const user = await newStaff('observer');
      await send(staff.superAdmin, 'patch', `/users/${user.id}`, { roleId: role.id }).expect(200);

      const inUse = await send(staff.superAdmin, 'delete', `/roles/${role.id}`).expect(409);
      expect(inUse.body).toMatchObject({
        code: 'INVALID_TRANSITION',
        details: { reason: 'ROLE_IN_USE', userCount: 1 },
      });
      await send(
        staff.superAdmin,
        'delete',
        `/roles/${role.id}?moveToRoleId=${roleIds.org_super_admin}`,
      ).expect(400);
      await send(
        staff.superAdmin,
        'delete',
        `/roles/${role.id}?moveToRoleId=${roleIds.observer}`,
      ).expect(204);
      const moved = (await staff.superAdmin.agent.get(`/api/v1/users/${user.id}`).expect(200))
        .body as UserDetail;
      expect(moved.role?.systemKey).toBe('observer');
      expect(await auditCount('role.delete', role.id)).toBe(1);
      await send(staff.superAdmin, 'delete', `/roles/${roleIds.observer}`).expect(403);
    });
  });

  describe('role and grant rules (security review)', () => {
    /** A user whose custom role holds roles.manage and event.view, but not admins.manage. */
    async function roleLead(): Promise<Staff & { roleId: string }> {
      const role = (
        await send(staff.superAdmin, 'post', '/roles', {
          name: `Lead ${uniqueSuffix()}`,
          permissions: ['roles.manage', 'event.view'],
        }).expect(201)
      ).body as Role;
      const user = await newStaff('observer');
      await send(staff.superAdmin, 'patch', `/users/${user.id}`, { roleId: role.id }).expect(200);
      const { agent, csrf } = await signIn(user.email);
      return { ...user, agent, csrf, roleId: role.id };
    }

    it('does not let a role manager widen their own role or the Org Super Admin role', async () => {
      const lead = await roleLead();
      await send(lead, 'patch', `/roles/${lead.roleId}`, {
        permissions: ['roles.manage', 'event.view', 'admins.manage'],
      }).expect(403);
      const sa = (
        await staff.superAdmin.agent.get(`/api/v1/roles/${roleIds.org_super_admin}`).expect(200)
      ).body as Role;
      await send(lead, 'patch', `/roles/${roleIds.org_super_admin}`, {
        permissions: sa.permissions,
      }).expect(403);
      const me = (await lead.agent.get('/api/v1/me').expect(200)).body as MeResponse;
      expect(me.permissions).not.toContain('admins.manage');
    });

    it('only lets a role manager give permissions they hold, never admin-level ones', async () => {
      const lead = await roleLead();
      await send(lead, 'post', '/roles', {
        name: `Wide ${uniqueSuffix()}`,
        permissions: ['event.view', 'voter.manage'],
      }).expect(403);
      await send(lead, 'post', '/roles', {
        name: `Admin-like ${uniqueSuffix()}`,
        permissions: ['roles.manage'],
      }).expect(403);
      const observer = (
        await staff.superAdmin.agent.get(`/api/v1/roles/${roleIds.observer}`).expect(200)
      ).body as Role;
      await send(lead, 'patch', `/roles/${roleIds.observer}`, {
        permissions: [...observer.permissions, 'kiosk.operate'],
      }).expect(403);
      await send(lead, 'patch', `/roles/${roleIds.admin}`, { permissions: ['event.view'] }).expect(
        403,
      );
      await send(lead, 'post', '/roles', {
        name: `Narrow ${uniqueSuffix()}`,
        permissions: ['event.view'],
      }).expect(201);
    });

    it('applies the grant rules when deleting a role moves its users', async () => {
      const lead = await roleLead();
      const doomed = (
        await send(lead, 'post', '/roles', {
          name: `Doomed ${uniqueSuffix()}`,
          permissions: ['event.view'],
        }).expect(201)
      ).body as Role;
      const safe = (
        await send(lead, 'post', '/roles', {
          name: `Safe ${uniqueSuffix()}`,
          permissions: ['event.view'],
        }).expect(201)
      ).body as Role;
      const member = await newStaff('observer');
      await send(staff.superAdmin, 'patch', `/users/${member.id}`, { roleId: doomed.id }).expect(
        200,
      );

      for (const target of [roleIds.admin, roleIds.observer]) {
        await send(lead, 'delete', `/roles/${doomed.id}?moveToRoleId=${target}`).expect(403);
      }
      await send(lead, 'delete', `/roles/${doomed.id}?moveToRoleId=${safe.id}`).expect(204);
      const moved = (await staff.superAdmin.agent.get(`/api/v1/users/${member.id}`).expect(200))
        .body as UserDetail;
      expect(moved.role?.id).toBe(safe.id);
    });

    it('treats organization-wide event permissions as admin-level', async () => {
      const wide = (
        await send(staff.superAdmin, 'post', '/roles', {
          name: `All events ${uniqueSuffix()}`,
          permissions: ['event.view', 'event.access_all'],
        }).expect(201)
      ).body as Role;
      await send(staff.admin, 'post', '/users', {
        fullName: 'Juma Ali',
        email: `x-${uniqueSuffix()}@example.test`,
        roleId: wide.id,
      }).expect(403);
    });

    it('shows recent activity without changed values, reasons or IP addresses', async () => {
      const user = await newStaff('moderator');
      await send(staff.admin, 'patch', `/users/${user.id}`, { fullName: 'Jina Jipya' }).expect(200);
      const detail = (await staff.admin.agent.get(`/api/v1/users/${user.id}`).expect(200))
        .body as UserDetail;
      expect(detail.recentActivity.length).toBeGreaterThan(0);
      for (const entry of detail.recentActivity) {
        expect(Object.keys(entry).sort()).toEqual(['action', 'actorLabel', 'createdAt', 'id']);
      }
    });
  });

  describe('organization settings and onboarding', () => {
    it('is readable by every staff member and editable with org.settings.manage', async () => {
      const read = (await staff.moderator.agent.get('/api/v1/organization').expect(200))
        .body as OrganizationSettings;
      expect(read).toMatchObject({ id: orgId, name: 'Chama cha Ushirika', logoUrl: null });
      await send(staff.moderator, 'patch', '/organization', { name: 'Hijack' }).expect(403);
    });

    it('saves sections, ticks the checklist and records the change', async () => {
      const before = (await staff.admin.agent.get('/api/v1/organization').expect(200))
        .body as OrganizationSettings;
      const item = (s: OrganizationSettings, key: string) =>
        s.onboarding.items.find((i) => i.key === key)?.done;
      expect(before.onboarding.items.map((i) => i.key)).toEqual([
        'timeZone',
        'branding',
        'smsSender',
        'moderator',
        'firstEvent',
      ]);
      expect(item(before, 'moderator')).toBe(true); // moderators exist in this organization
      expect(item(before, 'firstEvent')).toBe(false);

      // Saving the Regional section confirms the time zone even when it is unchanged.
      const regional = (
        await send(staff.admin, 'patch', '/organization', { timeZone: before.timeZone }).expect(200)
      ).body as OrganizationSettings;
      expect(item(regional, 'timeZone')).toBe(true);

      const saved = (
        await send(staff.admin, 'patch', '/organization', {
          primaryColor: '#0b6e8a',
          smsSenderId: 'USHIRIKA',
          sessionTimeoutMinutes: 30,
        }).expect(200)
      ).body as OrganizationSettings;
      expect(saved).toMatchObject({
        primaryColor: '#0B6E8A',
        smsSenderId: 'USHIRIKA',
        sessionTimeoutMinutes: 30,
      });
      expect(item(saved, 'smsSender')).toBe(true);
      expect(item(saved, 'branding')).toBe(false); // the logo arrives with uploads (step 17)
      const me = (await staff.moderator.agent.get('/api/v1/me').expect(200)).body as MeResponse;
      expect(me.organization?.sessionTimeoutMinutes).toBe(30);
      const entry = await owner.auditLog.findFirstOrThrow({
        where: { action: 'org.settings.update', entityId: orgId },
        orderBy: { createdAt: 'desc' },
      });
      expect(entry.after).toMatchObject({ smsSenderId: 'USHIRIKA', sessionTimeoutMinutes: 30 });

      const dismissed = (
        await send(staff.admin, 'patch', '/organization', { onboardingDismissed: true }).expect(200)
      ).body as OrganizationSettings;
      expect(dismissed.onboarding.dismissed).toBe(true);
      await send(staff.admin, 'patch', '/organization', { onboardingDismissed: false }).expect(200);
    });

    it('validates the settings', async () => {
      for (const body of [
        { primaryColor: 'blue' },
        { timeZone: 'Mars/Olympus' },
        { sessionTimeoutMinutes: 90 },
        { archiveAfterDays: 1 },
        {},
      ]) {
        await send(staff.admin, 'patch', '/organization', body).expect(400);
      }
    });
  });

  describe('audit log', () => {
    it('shows the organization entries with filters, never another organization', async () => {
      const other = await newStaff('admin', otherOrgId);
      const { agent: otherAgent, csrf } = await signIn(other.email);
      await otherAgent
        .patch('/api/v1/organization')
        .set('X-CSRF-Token', csrf)
        .send({ helpPhone: '+255700000009' })
        .expect(200);

      const res = await staff.admin.agent
        .get('/api/v1/audit')
        .query({ action: 'user.', pageSize: 100 })
        .expect(200);
      const page = res.body as AuditPage;
      expect(page.items.length).toBeGreaterThan(0);
      expect(
        page.items.every((e) => e.action.startsWith('user.') && e.organizationId === orgId),
      ).toBe(true);

      const all = (
        await staff.admin.agent.get('/api/v1/audit').query({ pageSize: 100 }).expect(200)
      ).body as AuditPage;
      expect(all.items.every((e) => e.organizationId === orgId)).toBe(true);
      await staff.moderator.agent.get('/api/v1/audit').expect(403);
    });

    it('filters by user', async () => {
      const res = await staff.admin.agent
        .get('/api/v1/audit')
        .query({ actorUserId: staff.superAdmin.id, pageSize: 100 })
        .expect(200);
      const page = res.body as AuditPage;
      expect(page.items.every((e) => e.actorUserId === staff.superAdmin.id)).toBe(true);
    });
  });
});
