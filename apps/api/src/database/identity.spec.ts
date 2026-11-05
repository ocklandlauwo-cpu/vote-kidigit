// Migration 003_tenancy_identity rules beyond tenant isolation: the last Org Super Admin
// (Backend Schema 11.3), default roles (11.6, 9.2), generated and checked columns, the
// organization copy on password history and tokens, and role privileges.
import { randomBytes } from 'node:crypto';
import { toAppError } from '../common/all-exceptions.filter.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  apiClient,
  createOrganization,
  createUser,
  deleteOrganizations,
  orgContext,
  ownerClient,
  platformContext,
  uniqueSuffix,
} from '../testing/db.js';
import type { PrismaService } from './prisma.service.js';

describe('migration 003_tenancy_identity', () => {
  let owner: PrismaClient;
  let api: PrismaService;
  const orgIds: string[] = [];

  async function newOrg(): Promise<string> {
    const id = await createOrganization(owner);
    orgIds.push(id);
    return id;
  }

  beforeAll(() => {
    owner = ownerClient();
    api = apiClient();
  });

  afterAll(async () => {
    await deleteOrganizations(owner, orgIds);
    await owner.$disconnect();
    await api.$disconnect();
  });

  describe('last Org Super Admin (11.3)', () => {
    it('refuses to deactivate the only active super admin', async () => {
      const org = await newOrg();
      const admin = await createUser(owner, org, { isOrgSuperAdmin: true });
      const failure = api
        .withContext(orgContext(org), (tx) =>
          tx.user.update({ where: { id: admin }, data: { status: 'deactivated' } }),
        )
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      const error = await failure;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('LAST_SUPER_ADMIN');
      // The deferred trigger fails at COMMIT; the HTTP layer still maps it to its code.
      expect(toAppError(error)).toMatchObject({ code: 'LAST_SUPER_ADMIN', status: 409 });
    });

    it('refuses to delete, soft-delete or demote the only active super admin', async () => {
      const org = await newOrg();
      const admin = await createUser(owner, org, { isOrgSuperAdmin: true });
      const attempts = [
        (tx: Parameters<Parameters<PrismaService['withContext']>[1]>[0]) =>
          tx.user.delete({ where: { id: admin } }),
        (tx: Parameters<Parameters<PrismaService['withContext']>[1]>[0]) =>
          tx.user.update({ where: { id: admin }, data: { deletedAt: new Date() } }),
        (tx: Parameters<Parameters<PrismaService['withContext']>[1]>[0]) =>
          tx.user.update({ where: { id: admin }, data: { isOrgSuperAdmin: false } }),
      ];
      for (const attempt of attempts) {
        await expect(api.withContext(orgContext(org), attempt)).rejects.toThrow('LAST_SUPER_ADMIN');
      }
    });

    it('allows it when another active super admin remains, including a hand-over in one transaction', async () => {
      const org = await newOrg();
      const first = await createUser(owner, org, { isOrgSuperAdmin: true });
      const second = await createUser(owner, org);
      await api.withContext(orgContext(org), async (tx) => {
        await tx.user.update({ where: { id: first }, data: { status: 'deactivated' } });
        await tx.user.update({ where: { id: second }, data: { isOrgSuperAdmin: true } });
      });
      const remaining = await owner.user.count({
        where: { organizationId: org, isOrgSuperAdmin: true, status: 'active' },
      });
      expect(remaining).toBe(1);
    });

    it('ignores users that never counted, such as an invited super admin', async () => {
      const org = await newOrg();
      await createUser(owner, org, { isOrgSuperAdmin: true });
      const invited = await createUser(owner, org, { isOrgSuperAdmin: true, status: 'invited' });
      await expect(
        api.withContext(orgContext(org), (tx) =>
          tx.user.update({ where: { id: invited }, data: { status: 'deactivated' } }),
        ),
      ).resolves.toBeDefined();
    });

    it('exempts an organization that is being deleted', async () => {
      const org = await newOrg();
      await createUser(owner, org, { isOrgSuperAdmin: true });
      await expect(deleteOrganizations(owner, [org])).resolves.toBeUndefined();
    });
  });

  describe('app.create_default_roles (11.6)', () => {
    it('creates the four system roles once, in platform context only', async () => {
      const org = await newOrg();
      await api.withContext(
        platformContext(),
        (tx) => tx.$executeRaw`SELECT app.create_default_roles(${org}::uuid)`,
      );
      await api.withContext(
        platformContext(),
        (tx) => tx.$executeRaw`SELECT app.create_default_roles(${org}::uuid)`,
      );
      const roles = await owner.role.findMany({
        where: { organizationId: org },
        select: { systemKey: true, isSystem: true },
        orderBy: { systemKey: 'asc' },
      });
      expect(roles).toEqual([
        { systemKey: 'admin', isSystem: true },
        { systemKey: 'moderator', isSystem: true },
        { systemKey: 'observer', isSystem: true },
        { systemKey: 'org_super_admin', isSystem: true },
      ]);

      await expect(
        api.withContext(
          orgContext(org),
          (tx) => tx.$executeRaw`SELECT app.create_default_roles(${org}::uuid)`,
        ),
      ).rejects.toThrow('FORBIDDEN');
    });

    it('grants the default permissions of Backend Schema 9.2', async () => {
      // A sample; permission.guard.spec.ts checks every role against the whole catalogue.
      const keys = ['roles.manage', 'staff.manage', 'event.publish', 'event.view'];
      const org = await newOrg();
      await api.withContext(
        platformContext(),
        (tx) => tx.$executeRaw`SELECT app.create_default_roles(${org}::uuid)`,
      );
      const grants = await owner.rolePermission.findMany({
        where: { organizationId: org, permissionKey: { in: keys } },
        select: { permissionKey: true, role: { select: { systemKey: true } } },
      });
      const byRole = (role: string) =>
        grants
          .filter((g) => g.role.systemKey === role)
          .map((g) => g.permissionKey)
          .sort();
      expect(byRole('org_super_admin')).toEqual([...keys].sort());
      expect(byRole('admin')).toEqual(['event.publish', 'event.view', 'staff.manage']);
      expect(byRole('moderator')).toEqual(['event.publish', 'event.view']);
      expect(byRole('observer')).toEqual(['event.view']);
      await deleteOrganizations(owner, [org]);
      orgIds.splice(orgIds.indexOf(org), 1);
    });
  });

  describe('users', () => {
    it('normalizes email into the generated email_normalized column', async () => {
      const org = await newOrg();
      const suffix = uniqueSuffix();
      const user = await api.withContext(orgContext(org), (tx) =>
        tx.user.create({
          data: {
            organizationId: org,
            email: `  Mixed.${suffix}@Example.TEST `,
            fullName: 'Mixed',
          },
        }),
      );
      expect(user.emailNormalized).toBe(`mixed.${suffix}@example.test`);
    });

    it('allows one active account per email across all organizations', async () => {
      const [orgA, orgB] = [await newOrg(), await newOrg()];
      const email = `dup-${uniqueSuffix()}@example.test`;
      await owner.user.create({ data: { organizationId: orgA, email, fullName: 'First' } });
      await expect(
        api.withContext(orgContext(orgB), (tx) =>
          tx.user.create({
            data: { organizationId: orgB, email: email.toUpperCase(), fullName: 'Second' },
          }),
        ),
      ).rejects.toThrow();
    });

    it('requires platform admins, and only them, to have no organization', async () => {
      const org = await newOrg();
      await expect(
        owner.user.create({
          data: { email: `p-${uniqueSuffix()}@example.test`, fullName: 'No org' },
        }),
      ).rejects.toThrow(/users_platform_admin_has_no_org/);
      await expect(
        owner.user.create({
          data: {
            organizationId: org,
            isPlatformAdmin: true,
            email: `p-${uniqueSuffix()}@example.test`,
            fullName: 'Admin with org',
          },
        }),
      ).rejects.toThrow(/users_platform_admin_has_no_org/);
    });
  });

  describe('password_history and user_tokens', () => {
    it("always take the user's organization, whatever the caller sends", async () => {
      const org = await newOrg();
      const other = await newOrg();
      const user = await createUser(owner, org);
      await api.withContext(
        orgContext(org),
        (tx) =>
          tx.$executeRaw`INSERT INTO public.password_history (user_id, organization_id, password_hash)
          VALUES (${user}::uuid, ${other}::uuid, 'h')`,
      );
      await api.withContext(
        orgContext(org),
        (tx) =>
          tx.$executeRaw`INSERT INTO public.user_tokens (user_id, organization_id, purpose, token_hash, expires_at)
          VALUES (${user}::uuid, ${other}::uuid, 'invite', ${randomBytes(32)}, now())`,
      );
      expect(await owner.passwordHistory.findFirst({ where: { userId: user } })).toMatchObject({
        organizationId: org,
      });
      expect(await owner.userToken.findFirst({ where: { userId: user } })).toMatchObject({
        organizationId: org,
      });
    });
  });

  describe('privileges', () => {
    it('lets vk_api read the permission catalogue but not change it', async () => {
      await expect(
        api.withContext(orgContext(await newOrg()), (tx) => tx.permission.count()),
      ).resolves.toBeGreaterThanOrEqual(0);
      await expect(
        api.withContext(
          platformContext(),
          (tx) =>
            tx.$executeRaw`INSERT INTO public.permissions (key, module, description_en, description_sw, scope)
            VALUES ('x.y', 'X', 'x', 'x', 'org')`,
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('hides password and token hashes from the read-only support role', async () => {
      const rows = await owner.$queryRaw<{ column: string; readable: boolean }[]>`
        SELECT c.col AS "column", has_column_privilege('vk_readonly', c.tbl, c.col, 'SELECT') AS readable
        FROM (VALUES ('public.users', 'password_hash'), ('public.password_history', 'password_hash'),
                     ('public.user_tokens', 'token_hash'), ('public.users', 'email')) AS c(tbl, col)`;
      expect(rows).toEqual([
        { column: 'password_hash', readable: false },
        { column: 'password_hash', readable: false },
        { column: 'token_hash', readable: false },
        { column: 'email', readable: true },
      ]);
    });
  });
});
