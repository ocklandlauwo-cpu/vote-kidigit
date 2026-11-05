// Integration test of the Platform Super Admin endpoints (Implementation Plan step 12, Backend
// Schema 12.3): create and suspend organizations, the first Org Super Admin invitation, settings,
// the platform audit log, and that nobody else reaches these routes (404) while platform admins
// cannot read organization data such as voters.
import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  type AuditPage,
  CreateOrganizationResponseSchema,
  type MeResponse,
  type OrganizationDetail,
  OrganizationPageSchema,
  PlatformDashboardSchema,
  type PlatformSettings,
} from '@vote-kidigit/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { RequirePermission } from '../../auth/decorators.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { MailService, type MailMessage } from '../../mail/mail.service.js';
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
import { WorkerModule } from '../../worker.module.js';

const PASSWORD = 'Uchaguzi2027';
const ORGS = '/api/v1/platform/organizations';

@Controller('probe')
class VoterProbeController {
  @Get('events/:eventId/voters')
  @RequirePermission('voter.view')
  voters() {
    return [];
  }
}

const codeOf = (res: request.Response) => (res.body as { code?: string }).code;

describe('Platform Super Admin', () => {
  let app: NestExpressApplication;
  let worker: TestingModule;
  let owner: PrismaClient;
  let api: PrismaService;
  let outbox: MailMessage[];
  let platform: TestAgent;
  let platformCsrf: string;
  let orgAdmin: TestAgent;
  let existingOrgId: string;
  const orgIds: string[] = [];
  const platformUserIds: string[] = [];

  const server = () => app.getHttpServer();

  async function signIn(email: string, password = PASSWORD) {
    const agent = request.agent(server()).set('X-Forwarded-For', testIp());
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    return { agent, res, csrf: (res.body as MeResponse).csrfToken };
  }

  async function waitForMail(to: string): Promise<string> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const mail = outbox.find((m) => m.to === to);
      if (mail) {
        outbox.splice(outbox.indexOf(mail), 1);
        const token = /\/app\/invite\/([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1];
        if (!token) throw new Error(`no link in: ${mail.text}`);
        return token;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`no email to ${to}`);
  }

  /** Creates an organization through the API and remembers it for clean-up. */
  async function createOrg(overrides: Record<string, unknown> = {}) {
    const email = `owner-${uniqueSuffix()}@example.test`;
    const res = await platform
      .post(ORGS)
      .set('X-CSRF-Token', platformCsrf)
      .send({
        name: `Chama cha Akiba ${uniqueSuffix()}`,
        contactPhone: '+255712345678',
        superAdmin: { fullName: 'Neema Mushi', email },
        ...overrides,
      });
    const parsed = CreateOrganizationResponseSchema.safeParse(res.body);
    if (parsed.success) orgIds.push(parsed.data.organization.id);
    return { res, email, body: parsed.success ? parsed.data : undefined };
  }

  const post = (path: string, body: object = {}) =>
    platform.post(path).set('X-CSRF-Token', platformCsrf).send(body);

  beforeAll(async () => {
    ({ app } = await createTestHttpApp([VoterProbeController]));
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    outbox = worker.get(MailService).outbox;
    owner = ownerClient();
    api = apiClient();

    const platformEmail = `platform-${uniqueSuffix()}@example.test`;
    platformUserIds.push(
      await createUser(owner, null, { email: platformEmail, password: PASSWORD }),
    );
    ({ agent: platform, csrf: platformCsrf } = await signIn(platformEmail));

    // An existing organization with an Admin, who must not see platform routes.
    existingOrgId = await createOrganization(owner, 'Shule ya Msingi');
    orgIds.push(existingOrgId);
    await api.withContext(
      platformContext(),
      (tx) => tx.$executeRaw`SELECT app.create_default_roles(${existingOrgId}::uuid)`,
    );
    const adminEmail = `admin-${uniqueSuffix()}@example.test`;
    const adminId = await createUser(owner, existingOrgId, {
      email: adminEmail,
      password: PASSWORD,
    });
    const adminRole = await owner.role.findFirstOrThrow({
      where: { organizationId: existingOrgId, systemKey: 'admin' },
    });
    await owner.userRole.create({
      data: { userId: adminId, roleId: adminRole.id, organizationId: existingOrgId },
    });
    ({ agent: orgAdmin } = await signIn(adminEmail));
  });

  afterAll(async () => {
    await owner.platformSetting.update({
      where: { id: 1 },
      data: {
        defaultSessionTimeoutMinutes: 15,
        ussdShortCode: null,
        supportPhone: null,
        supportEmail: null,
      },
    });
    await deleteOrganizations(owner, orgIds);
    await owner.user.deleteMany({ where: { id: { in: platformUserIds } } });
    await owner.$disconnect();
    await api.$disconnect();
    await worker.close();
    await app.close();
  });

  describe('create organization', () => {
    it('creates the organization, its default roles and an invited Org Super Admin', async () => {
      const { res, email, body } = await createOrg();
      expect(res.status).toBe(201);
      expect(body?.invitationSent).toBe(true);
      const org = body?.organization;
      if (!org) throw new Error('no organization');
      expect(org).toMatchObject({
        status: 'active',
        timeZone: 'Africa/Dar_es_Salaam',
        contactPhone: '+255712345678',
        superAdmin: { email, fullName: 'Neema Mushi', status: 'invited' },
        staffCount: 1,
      });
      expect(org.slug).toMatch(/^chama-cha-akiba-/);
      expect(org.staff).toEqual([
        expect.objectContaining({ email, isOrgSuperAdmin: true, roleName: 'Org Super Admin' }),
      ]);
      const roles = await owner.role.findMany({ where: { organizationId: org.id } });
      expect(roles.map((r) => r.systemKey).sort()).toEqual(
        ['admin', 'moderator', 'observer', 'org_super_admin'].sort(),
      );
      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'platform.org.create', entityId: org.id },
      });
      expect(audit.organizationId).toBe(org.id);

      // The invitation reaches the Org Super Admin, who joins with every org permission.
      const token = await waitForMail(email);
      const agent = request.agent(server()).set('X-Forwarded-For', testIp());
      const accepted = await agent
        .post('/api/v1/auth/invite/accept')
        .send({ token, fullName: 'Neema Mushi', password: 'Karibu2027Sana' })
        .expect(200);
      const me = accepted.body as MeResponse;
      expect(me.organization?.id).toBe(org.id);
      expect(me.role?.systemKey).toBe('org_super_admin');
      expect(me.permissions).toContain('roles.manage');
      expect(me.permissions).not.toContain('platform.orgs.manage');
    });

    it('refuses an email that already has an account, creating nothing', async () => {
      const name = `Duplicate ${uniqueSuffix()}`;
      const first = await createOrg();
      const { res } = await createOrg({
        name,
        superAdmin: { fullName: 'Juma', email: first.email.toUpperCase() },
      });
      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(res.body)).toContain('superAdmin.email');
      expect(await owner.organization.count({ where: { name } })).toBe(0);
    });

    it('gives organizations with the same name different slugs', async () => {
      const name = `Kikundi ${uniqueSuffix()}`;
      const a = await createOrg({ name });
      const b = await createOrg({ name });
      expect(b.body?.organization.slug).toBe(`${a.body?.organization.slug}-2`);
    });

    it('validates the request', async () => {
      for (const overrides of [
        { name: 'X' },
        { timeZone: 'Mars/Olympus' },
        { contactPhone: '0712345678' },
        { smsSenderId: 'WAY TOO LONG SENDER' },
        { superAdmin: { fullName: 'Juma', email: 'not-an-email' } },
      ]) {
        const { res } = await createOrg(overrides);
        expect(res.status).toBe(400);
        expect(codeOf(res)).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('list and detail', () => {
    it('searches, filters by status and pages', async () => {
      const tag = uniqueSuffix();
      const a = await createOrg({ name: `Tafuta ${tag} A` });
      await createOrg({ name: `Tafuta ${tag} B` });
      await post(`${ORGS}/${a.body?.organization.id}/suspend`, { reason: 'Test' }).expect(200);

      const all = await platform
        .get(ORGS)
        .query({ q: tag, pageSize: 25, sort: 'name' })
        .expect(200);
      const page = OrganizationPageSchema.parse(all.body);
      expect(page.total).toBe(2);
      expect(page.items.map((o) => o.name)).toEqual([`Tafuta ${tag} A`, `Tafuta ${tag} B`]);

      const suspended = OrganizationPageSchema.parse(
        (await platform.get(ORGS).query({ q: tag, status: 'suspended' }).expect(200)).body,
      );
      expect(suspended.items.map((o) => o.name)).toEqual([`Tafuta ${tag} A`]);

      await platform.get(ORGS).query({ pageSize: 30 }).expect(400);
    });

    it('answers 404 for unknown and malformed ids', async () => {
      expect(codeOf(await platform.get(`${ORGS}/${randomUUID()}`).expect(404))).toBe('NOT_FOUND');
      await platform.get(`${ORGS}/not-an-id`).expect(404);
    });

    it('edits organization details and records the change', async () => {
      const { body } = await createOrg();
      const id = body?.organization.id ?? '';
      const res = await platform
        .patch(`${ORGS}/${id}`)
        .set('X-CSRF-Token', platformCsrf)
        .send({ name: 'Jina Jipya', sessionTimeoutMinutes: 30, contactPhone: '' })
        .expect(200);
      expect(res.body as OrganizationDetail).toMatchObject({
        name: 'Jina Jipya',
        sessionTimeoutMinutes: 30,
        contactPhone: null,
      });
      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'platform.org.update', entityId: id },
      });
      expect(audit.after).toMatchObject({ name: 'Jina Jipya', sessionTimeoutMinutes: 30 });
      await platform
        .patch(`${ORGS}/${id}`)
        .set('X-CSRF-Token', platformCsrf)
        .send({ sessionTimeoutMinutes: 2 })
        .expect(400);
    });
  });

  describe('suspend and reactivate', () => {
    it('signs the staff out, blocks sign-in and lets them back after reactivation', async () => {
      const orgId = await createOrganization(owner, 'Kusimamishwa');
      orgIds.push(orgId);
      const email = `staff-${uniqueSuffix()}@example.test`;
      await createUser(owner, orgId, { email, password: PASSWORD });
      const { agent: staff } = await signIn(email);
      await staff.get('/api/v1/me').expect(200);

      await post(`${ORGS}/${orgId}/suspend`).expect(400); // a reason is required
      const res = await post(`${ORGS}/${orgId}/suspend`, { reason: 'Unpaid invoice' }).expect(200);
      expect((res.body as OrganizationDetail).status).toBe('suspended');

      await staff.get('/api/v1/me').expect(401);
      const blocked = await signIn(email);
      expect(blocked.res.status).toBe(403);
      expect(codeOf(blocked.res)).toBe('ORG_SUSPENDED');
      const again = await post(`${ORGS}/${orgId}/suspend`, { reason: 'Twice' }).expect(409);
      expect(codeOf(again)).toBe('INVALID_TRANSITION');

      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'platform.org.suspend', entityId: orgId },
      });
      expect(audit.reason).toBe('Unpaid invoice');

      await post(`${ORGS}/${orgId}/reactivate`).expect(200);
      expect((await signIn(email)).res.status).toBe(200);
      await post(`${ORGS}/${orgId}/reactivate`).expect(409);
    });
  });

  describe('resend invitation', () => {
    it('sends a new link while the Org Super Admin has not joined', async () => {
      const { body, email } = await createOrg();
      const id = body?.organization.id ?? '';
      const first = await waitForMail(email);
      const res = await post(`${ORGS}/${id}/resend-invite`).expect(200);
      expect(res.body).toEqual({ invitationSent: true });
      const second = await waitForMail(email);
      expect(second).not.toBe(first);
      // Only the newest link works.
      await request(server())
        .get(`/api/v1/auth/tokens/${first}`)
        .set('X-Forwarded-For', testIp())
        .expect(404);

      await request(server())
        .post('/api/v1/auth/invite/accept')
        .set('X-Forwarded-For', testIp())
        .send({ token: second, fullName: 'Neema Mushi', password: 'Karibu2027Sana' })
        .expect(200);
      const joined = await post(`${ORGS}/${id}/resend-invite`).expect(409);
      expect(codeOf(joined)).toBe('INVALID_TRANSITION');
    });
  });

  describe('settings', () => {
    it('reads and updates platform settings; new organizations get the default timeout', async () => {
      const res = await platform
        .patch('/api/v1/platform/settings')
        .set('X-CSRF-Token', platformCsrf)
        .send({
          defaultSessionTimeoutMinutes: 20,
          ussdShortCode: '*150*12#',
          supportPhone: '+255700000001',
        })
        .expect(200);
      expect(res.body as PlatformSettings).toMatchObject({
        defaultSessionTimeoutMinutes: 20,
        ussdShortCode: '*150*12#',
        supportPhone: '+255700000001',
      });
      expect(
        ((await platform.get('/api/v1/platform/settings').expect(200)).body as PlatformSettings)
          .ussdShortCode,
      ).toBe('*150*12#');
      const { body } = await createOrg();
      expect(body?.organization.sessionTimeoutMinutes).toBe(20);

      await platform
        .patch('/api/v1/platform/settings')
        .set('X-CSRF-Token', platformCsrf)
        .send({ ussdShortCode: '150' })
        .expect(400);
      expect(
        await owner.auditLog.count({
          where: { action: 'platform.settings.update', organizationId: null },
        }),
      ).toBeGreaterThan(0);
    });
  });

  describe('dashboard and audit', () => {
    it('counts organizations and staff and lists recent activity', async () => {
      await createOrg();
      const res = await platform.get('/api/v1/platform/dashboard').expect(200);
      const dashboard = PlatformDashboardSchema.parse(res.body);
      expect(dashboard.organizations.total).toBeGreaterThanOrEqual(2);
      expect(dashboard.organizations.total).toBe(
        dashboard.organizations.active + dashboard.organizations.suspended,
      );
      expect(dashboard.staffUsers.invited).toBeGreaterThanOrEqual(1);
      expect(dashboard.recentActivity.length).toBeGreaterThan(0);
      expect(dashboard.recentActivity.length).toBeLessThanOrEqual(10);
    });

    it('filters the platform audit log by organization', async () => {
      const { body } = await createOrg();
      const id = body?.organization.id ?? '';
      const res = await platform
        .get('/api/v1/platform/audit')
        .query({ organizationId: id, pageSize: 25 })
        .expect(200);
      const page = res.body as AuditPage;
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.every((e) => e.organizationId === id)).toBe(true);
      expect(page.items.map((e) => e.action)).toContain('platform.org.create');
      expect(page.items[0]?.organizationName).toBe(body?.organization.name);

      const platformOnly = (
        await platform
          .get('/api/v1/platform/audit')
          .query({ organizationId: 'platform' })
          .expect(200)
      ).body as AuditPage;
      expect(platformOnly.items.every((e) => e.organizationId === null)).toBe(true);
    });
  });

  describe('access', () => {
    const routes: [method: 'get' | 'post' | 'patch', path: string][] = [
      ['get', '/api/v1/platform/dashboard'],
      ['get', ORGS],
      ['post', ORGS],
      ['get', `${ORGS}/:orgId`],
      ['patch', `${ORGS}/:orgId`],
      ['post', `${ORGS}/:orgId/suspend`],
      ['post', `${ORGS}/:orgId/reactivate`],
      ['post', `${ORGS}/:orgId/resend-invite`],
      ['get', '/api/v1/platform/settings'],
      ['patch', '/api/v1/platform/settings'],
      ['get', '/api/v1/platform/audit'],
    ];

    it.each(routes)('an Org Admin gets 404 on %s %s', async (method, path) => {
      const me = (await orgAdmin.get('/api/v1/me').expect(200)).body as MeResponse;
      const res = await orgAdmin[method](path.replace(':orgId', existingOrgId))
        .set('X-CSRF-Token', me.csrfToken)
        .send({ reason: 'x', name: 'Hijack' });
      expect(res.status).toBe(404);
      expect(codeOf(res)).toBe('NOT_FOUND');
    });

    it('a platform admin cannot read voters or act inside an organization', async () => {
      const voters = await platform.get(`/api/probe/events/${randomUUID()}/voters`);
      expect(voters.status).toBe(403);
      await platform.get('/api/v1/permissions').expect(403);
      // Organization detail shows staff, never voter data.
      const detail = (await platform.get(`${ORGS}/${existingOrgId}`).expect(200))
        .body as OrganizationDetail;
      expect(Object.keys(detail)).not.toContain('voters');
    });
  });
});
