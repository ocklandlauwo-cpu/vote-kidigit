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
    table: 'public.voting_events',
    insertFor: (tx, org) =>
      tx.$executeRaw`INSERT INTO public.voting_events (organization_id, name, start_at, end_at)
        VALUES (${org}::uuid, 'Intruder', now() + interval '1 day', now() + interval '2 days')`,
  },
  {
    table: 'public.event_assignments',
    insertFor: (tx, org, f) =>
      tx.$executeRaw`INSERT INTO public.event_assignments (organization_id, event_id, user_id, type)
        VALUES (${org}::uuid, ${f.eventId}::uuid, ${f.spareUserId}::uuid, 'observer')`,
  },
  {
    table: 'public.categories',
    insertFor: (tx, org, f) =>
      tx.$executeRaw`INSERT INTO public.categories (organization_id, event_id, name, display_order)
        VALUES (${org}::uuid, ${f.eventId}::uuid, ${`Intruder ${uniqueSuffix()}`}, 99)`,
  },
  {
    table: 'public.contesters',
    insertFor: (tx, org, f) =>
      tx.$executeRaw`INSERT INTO public.contesters (organization_id, event_id, category_id, full_name)
        VALUES (${org}::uuid, ${f.eventId}::uuid, ${f.categoryId}::uuid, 'Intruder')`,
  },
  {
    table: 'public.voters',
    // Backend Schema 10.2: platform admins never read individual voters.
    platformCanRead: false,
    insertFor: (tx, org, f) =>
      tx.$executeRaw`INSERT INTO public.voters (organization_id, event_id, full_name, membership_id, phone, gender)
        VALUES (${org}::uuid, ${f.eventId}::uuid, 'Intruder', ${`M-${uniqueSuffix()}`}, '+255700000000', 'female')`,
  },
  {
    table: 'public.category_voters',
    // The setup trigger runs first and cannot see B's voter: refused as not found.
    insertRefusal: /row-level security|NOT_FOUND/,
    insertFor: (tx, org, f) =>
      tx.$executeRaw`INSERT INTO public.category_voters (category_id, voter_id, organization_id)
        VALUES (${f.categoryId}::uuid, ${f.spareVoterId}::uuid, ${org}::uuid)`,
  },
  {
    table: 'public.files',
    immutable: true,
    insertFor: (tx, org) =>
      tx.$executeRaw`INSERT INTO public.files (organization_id, kind, storage_path, mime_type, size_bytes, sha256)
        VALUES (${org}::uuid, 'org_logo', ${`org/${org}/org_logo/${uniqueSuffix()}.png`}, 'image/png', 1, ${'0'.repeat(64)})`,
  },
  {
    table: 'public.voter_imports',
    insertFor: (tx, org, f) =>
      tx.$executeRaw`INSERT INTO public.voter_imports (organization_id, event_id)
        VALUES (${org}::uuid, ${f.eventId}::uuid)`,
  },
  {
    table: 'public.sms_templates',
    insertFor: (tx, org) =>
      tx.$executeRaw`INSERT INTO public.sms_templates (organization_id, type, channel, body)
        VALUES (${org}::uuid, 'event_cancelled', 'sms', 'Intruder')`,
  },
  {
    table: 'public.sms_batches',
    insertFor: (tx, org, f) =>
      tx.$executeRaw`INSERT INTO public.sms_batches (organization_id, event_id, type, channel, audience)
        VALUES (${org}::uuid, ${f.eventId}::uuid, 'code_delivery', 'sms', 'all')`,
  },
  {
    table: 'public.sms_messages',
    // Backend Schema 10.2: messages carry voters' phones, like voters.
    platformCanRead: false,
    insertFor: (tx, org, f) =>
      tx.$executeRaw`INSERT INTO public.sms_messages (organization_id, event_id, channel, type, to_address, body_redacted)
        VALUES (${org}::uuid, ${f.eventId}::uuid, 'sms', 'code_delivery', '+255700000000', 'Intruder')`,
  },
  {
    table: 'public.voter_participation',
    // Written only by app.cast_ballot(): vk_api reads it and nothing else. Platform admins
    // never see individual voters (Backend Schema 10.2).
    platformCanRead: false,
    appendOnly: true,
    insertRefusal: /permission denied/,
    insertFor: (tx, org, f) =>
      tx.$executeRaw`INSERT INTO public.voter_participation (voter_id, category_id, event_id, organization_id, channel, voted_at)
        VALUES (${f.voterId}::uuid, ${f.categoryId}::uuid, ${f.eventId}::uuid, ${org}::uuid, 'web', now())`,
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
  // A Draft event with one of each setup row; a spare voter not yet linked to the category.
  const event = await owner.votingEvent.create({
    data: {
      organizationId: orgId,
      name: 'Seeded event',
      startAt: new Date(Date.now() + 86_400_000),
      endAt: new Date(Date.now() + 2 * 86_400_000),
    },
    select: { id: true },
  });
  await owner.eventAssignment.create({
    data: { organizationId: orgId, eventId: event.id, userId, type: 'moderator' },
  });
  const category = await owner.category.create({
    data: { organizationId: orgId, eventId: event.id, name: 'Chair', displayOrder: 1 },
    select: { id: true },
  });
  await owner.contester.create({
    data: { organizationId: orgId, eventId: event.id, categoryId: category.id, fullName: 'Asha' },
  });
  const voter = await owner.voter.create({
    data: {
      organizationId: orgId,
      eventId: event.id,
      fullName: 'Juma',
      membershipId: `M-${uniqueSuffix()}`,
      phone: '+255712000001',
      gender: 'male',
    },
    select: { id: true },
  });
  const spareVoter = await owner.voter.create({
    data: {
      organizationId: orgId,
      eventId: event.id,
      fullName: 'Neema',
      membershipId: `M-${uniqueSuffix()}`,
      phone: '+255712000002',
      gender: 'female',
    },
    select: { id: true },
  });
  await owner.file.create({
    data: {
      organizationId: orgId,
      kind: 'contester_photo',
      storagePath: `org/${orgId}/contester_photo/${uniqueSuffix()}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 1,
      sha256: '0'.repeat(64),
    },
  });
  await owner.voterImport.create({ data: { organizationId: orgId, eventId: event.id } });
  await owner.smsTemplate.create({
    data: { organizationId: orgId, type: 'code_delivery', channel: 'sms', body: 'Msimbo wako' },
  });
  const batch = await owner.smsBatch.create({
    data: {
      organizationId: orgId,
      eventId: event.id,
      type: 'code_delivery',
      channel: 'sms',
      audience: 'all',
    },
  });
  await owner.smsMessage.create({
    data: {
      organizationId: orgId,
      eventId: event.id,
      batchId: batch.id,
      voterId: voter.id,
      channel: 'sms',
      type: 'code_delivery',
      toAddress: '+255712000001',
      bodyRedacted: 'Msimbo wako ni ••••-••••',
    },
  });
  await owner.categoryVoter.create({
    data: { categoryId: category.id, voterId: voter.id, organizationId: orgId },
  });
  await owner.voterParticipation.create({
    data: {
      voterId: voter.id,
      categoryId: category.id,
      eventId: event.id,
      organizationId: orgId,
      channel: 'web',
      votedAt: new Date(),
    },
  });
  return {
    userId,
    spareUserId,
    roleId: role.id,
    customRoleId: customRole.id,
    permissionKey,
    eventId: event.id,
    categoryId: category.id,
    voterId: voter.id,
    spareVoterId: spareVoter.id,
  };
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
