// Tenant isolation of every table with an organization (Backend Schema 10.5). Each migration
// that adds a tenant table adds its seed rows below and an entry to TENANT_TABLES.
import { randomBytes } from 'node:crypto';
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
import {
  describeTenantIsolation,
  type IsolationSetup,
  type OrgFixtures,
  type TenantTableCase,
} from '../testing/rls-harness.js';
import type { PrismaService } from './prisma.service.js';

const TENANT_TABLES: TenantTableCase[] = [
  {
    table: 'public.organizations',
    orgColumn: 'id',
    insertFor: (tx) =>
      tx.$executeRaw`INSERT INTO public.organizations (name, slug) VALUES ('Intruder', ${`x-${uniqueSuffix()}`})`,
  },
  {
    table: 'public.users',
    insertFor: (tx, org) =>
      tx.$executeRaw`INSERT INTO public.users (organization_id, email, full_name)
        VALUES (${org}::uuid, ${`x-${uniqueSuffix()}@example.test`}, 'Intruder')`,
  },
  {
    table: 'public.password_history',
    insertFor: (tx, _org, f) =>
      tx.$executeRaw`INSERT INTO public.password_history (user_id, password_hash)
        VALUES (${f.userId}::uuid, 'x')`,
  },
  {
    table: 'public.user_tokens',
    insertFor: (tx, _org, f) =>
      tx.$executeRaw`INSERT INTO public.user_tokens (user_id, purpose, token_hash, expires_at)
        VALUES (${f.userId}::uuid, 'invite', ${randomBytes(32)}, now() + interval '1 hour')`,
  },
  {
    table: 'public.roles',
    insertFor: (tx, org) =>
      tx.$executeRaw`INSERT INTO public.roles (organization_id, name)
        VALUES (${org}::uuid, ${`Intruder ${uniqueSuffix()}`})`,
  },
  {
    table: 'public.role_permissions',
    insertFor: (tx, org, f) =>
      tx.$executeRaw`INSERT INTO public.role_permissions (role_id, permission_key, organization_id)
        VALUES (${f.customRoleId}::uuid, ${f.permissionKey}, ${org}::uuid)`,
  },
  {
    table: 'public.user_roles',
    insertFor: (tx, org, f) =>
      tx.$executeRaw`INSERT INTO public.user_roles (user_id, role_id, organization_id)
        VALUES (${f.spareUserId}::uuid, ${f.roleId}::uuid, ${org}::uuid)`,
  },
  {
    table: 'audit.audit_log',
    appendOnly: true,
    insertFor: (tx, org) =>
      tx.$executeRaw`INSERT INTO audit.audit_log (organization_id, actor_type, actor_label, action, entity_type)
        VALUES (${org}::uuid, 'system', 'Intruder', 'probe.write', 'probe')`,
  },
];

/** Seeds one row in every tenant table for `orgId` (as owner). */
async function seedOrganization(
  owner: PrismaClient,
  orgId: string,
  permissionKey: string,
): Promise<OrgFixtures> {
  const userId = await createUser(owner, orgId, { isOrgSuperAdmin: true });
  const spareUserId = await createUser(owner, orgId);
  const role = await owner.role.create({
    data: { organizationId: orgId, name: 'Seeded role' },
    select: { id: true },
  });
  const customRole = await owner.role.create({
    data: { organizationId: orgId, name: 'Second role' },
    select: { id: true },
  });
  await owner.rolePermission.create({
    data: { roleId: role.id, permissionKey, organizationId: orgId },
  });
  await owner.userRole.create({ data: { userId, roleId: role.id, organizationId: orgId } });
  await owner.passwordHistory.create({ data: { userId, passwordHash: 'seeded' } });
  await owner.userToken.create({
    data: {
      userId,
      purpose: 'password_reset',
      tokenHash: randomBytes(32),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  // Audit rows are permanent (append-only); the table has no foreign keys, so the
  // organization can still be deleted in clean-up.
  await owner.auditLog.create({
    data: {
      organizationId: orgId,
      actorType: 'system',
      actorLabel: 'System',
      action: 'test.seed',
      entityType: 'organizations',
      entityId: orgId,
    },
  });
  return { userId, spareUserId, roleId: role.id, customRoleId: customRole.id, permissionKey };
}

describe('row level security: tenant isolation', () => {
  let owner: PrismaClient;
  let api: PrismaService;
  let setup: IsolationSetup;
  const permissionKey = `test.rls.${uniqueSuffix()}`;
  const orgIds: string[] = [];

  beforeAll(async () => {
    owner = ownerClient();
    api = apiClient();
    await owner.permission.create({
      data: {
        key: permissionKey,
        module: 'Test',
        descriptionEn: 'RLS test permission',
        descriptionSw: 'Ruhusa ya majaribio',
        scope: 'org',
      },
    });
    const orgA = await createOrganization(owner, 'Org A');
    const orgB = await createOrganization(owner, 'Org B');
    orgIds.push(orgA, orgB);
    await seedOrganization(owner, orgA, permissionKey);
    const fixturesB = await seedOrganization(owner, orgB, permissionKey);
    setup = { api, orgA, orgB, fixturesB };
  });

  afterAll(async () => {
    await deleteOrganizations(owner, orgIds);
    await owner.permission.deleteMany({ where: { key: permissionKey } });
    await owner.$disconnect();
    await api.$disconnect();
  });

  describeTenantIsolation(TENANT_TABLES, () => setup);

  it('covers every table that has an organization_id column', async () => {
    const rows = await owner.$queryRaw<{ table: string }[]>`
      SELECT table_schema || '.' || table_name AS table FROM information_schema.columns
      WHERE column_name = 'organization_id' AND table_schema IN ('public', 'audit')
      ORDER BY 1`;
    const covered = new Set(TENANT_TABLES.map((t) => t.table));
    expect(rows.map((r) => r.table).filter((t) => !covered.has(t))).toEqual([]);
  });

  it('enables RLS on every tenant table', async () => {
    const rows = await owner.$queryRaw<{ table: string; rls: boolean }[]>`
      SELECT n.nspname || '.' || c.relname AS table, c.relrowsecurity AS rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname IN ('public', 'audit')`;
    for (const { table } of TENANT_TABLES) {
      expect(rows.find((r) => r.table === table)?.rls).toBe(true);
    }
  });
});

describe('row level security: platform_settings', () => {
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;

  beforeAll(async () => {
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner);
  });

  afterAll(async () => {
    await owner.platformSetting.update({ where: { id: 1 }, data: { supportEmail: null } });
    await deleteOrganizations(owner, [orgId]);
    await owner.$disconnect();
    await api.$disconnect();
  });

  it('is readable by everyone and has exactly one row', async () => {
    const rows = await api.withContext(orgContext(orgId), (tx) => tx.platformSetting.findMany());
    expect(rows.map((r) => r.id)).toEqual([1]);
  });

  it('can be changed only by platform admins', async () => {
    const asOrg = await api.withContext(orgContext(orgId), (tx) =>
      tx.platformSetting.updateMany({ data: { supportEmail: 'org@example.test' } }),
    );
    expect(asOrg.count).toBe(0);
    const asPlatform = await api.withContext(platformContext(), (tx) =>
      tx.platformSetting.updateMany({ data: { supportEmail: 'platform@example.test' } }),
    );
    expect(asPlatform.count).toBe(1);
  });

  it('never gains or loses its row through the API', async () => {
    await expect(
      api.withContext(platformContext(), (tx) => tx.platformSetting.deleteMany()),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      api.withContext(platformContext(), (tx) => tx.platformSetting.create({ data: { id: 2 } })),
    ).rejects.toThrow(/permission denied/i);
  });
});
