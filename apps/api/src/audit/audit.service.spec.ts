// Integration test: AuditService writes audit.audit_log in the caller's transaction, and the
// log is append-only (PRD AUD-01–04, Backend Schema 7.8, 11.1).
import { randomUUID } from 'node:crypto';
import { RequestContextService, type RequestContext } from '../context/request-context.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  apiClient,
  createOrganization,
  createUser,
  deleteOrganizations,
  ownerClient,
} from '../testing/db.js';
import { AuditService, auditDiff } from './audit.service.js';

describe('AuditService', () => {
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  let userId: string;
  const requestContext = new RequestContextService();
  const audit = new AuditService(requestContext);

  function staffContext(): RequestContext {
    return {
      requestId: randomUUID(),
      orgId,
      userId,
      isPlatformAdmin: false,
      actorType: 'user',
      actorLabel: 'Asha Moderator <asha@example.test>',
      ip: '196.249.97.10',
      userAgent: 'jest',
    };
  }

  beforeAll(async () => {
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner);
    userId = await createUser(owner, orgId, { isOrgSuperAdmin: true });
  });

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId]);
    await owner.$disconnect();
    await api.$disconnect();
  });

  it('writes the entry with the context of the request', async () => {
    const ctx = staffContext();
    await requestContext.run(ctx, () =>
      api.withContext(ctx, (tx) =>
        audit.record(tx, {
          action: 'org.settings.update',
          entityType: 'organizations',
          entityId: orgId,
          before: { name: 'Old', primaryColor: '#000000', helpPhone: '+255700000000' },
          after: { name: 'New', primaryColor: '#000000', helpPhone: '+255700000000' },
          reason: 'Rename',
        }),
      ),
    );
    const row = await owner.auditLog.findFirst({ where: { requestId: ctx.requestId } });
    expect(row).toMatchObject({
      organizationId: orgId,
      actorType: 'user',
      actorUserId: userId,
      actorLabel: 'Asha Moderator <asha@example.test>',
      action: 'org.settings.update',
      entityType: 'organizations',
      entityId: orgId,
      before: { name: 'Old' },
      after: { name: 'New' },
      reason: 'Rename',
      ip: '196.249.97.10',
      userAgent: 'jest',
    });
  });

  it('is rolled back together with the change it describes', async () => {
    const ctx = staffContext();
    await expect(
      requestContext.run(ctx, () =>
        api.withContext(ctx, async (tx) => {
          await audit.record(tx, { action: 'event.publish', entityType: 'voting_events' });
          throw new Error('the change failed');
        }),
      ),
    ).rejects.toThrow('the change failed');
    expect(await owner.auditLog.count({ where: { requestId: ctx.requestId } })).toBe(0);
  });

  it('cannot be updated, deleted or truncated', async () => {
    const ctx = staffContext();
    await requestContext.run(ctx, () =>
      api.withContext(ctx, (tx) =>
        audit.record(tx, { action: 'probe.write', entityType: 'probe' }),
      ),
    );
    // vk_api has no UPDATE / DELETE privilege at all
    await expect(
      api.withContext(ctx, (tx) => tx.$executeRaw`UPDATE audit.audit_log SET reason = 'x'`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      api.withContext(ctx, (tx) => tx.$executeRaw`DELETE FROM audit.audit_log`),
    ).rejects.toThrow(/permission denied/);
    // even the owner is stopped by the triggers
    await expect(owner.$executeRaw`UPDATE audit.audit_log SET reason = 'x'`).rejects.toThrow(
      'IMMUTABLE_RECORD',
    );
    await expect(owner.$executeRaw`DELETE FROM audit.audit_log`).rejects.toThrow(
      'IMMUTABLE_RECORD',
    );
    await expect(owner.$executeRaw`TRUNCATE audit.audit_log`).rejects.toThrow('IMMUTABLE_RECORD');
  });

  it('cannot be written for another organization', async () => {
    const ctx = staffContext();
    await expect(
      requestContext.run(ctx, () =>
        api.withContext(ctx, (tx) =>
          audit.record(tx, {
            action: 'probe.write',
            entityType: 'probe',
            organizationId: randomUUID(),
          }),
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('auditDiff', () => {
  it('keeps changed columns only and drops secrets', () => {
    expect(
      auditDiff(
        { fullName: 'A', status: 'active', passwordHash: 'old', updatedAt: new Date(0) },
        { fullName: 'B', status: 'active', passwordHash: 'new', updatedAt: new Date(1000) },
      ),
    ).toEqual({
      before: { fullName: 'A', updatedAt: '1970-01-01T00:00:00.000Z' },
      after: { fullName: 'B', updatedAt: '1970-01-01T00:00:01.000Z' },
    });
  });

  it('keeps whole records for creations and deletions', () => {
    expect(auditDiff(null, { name: 'Chair', codeHmac: Buffer.from('x') })).toEqual({
      before: null,
      after: { name: 'Chair' },
    });
  });
});
