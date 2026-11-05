// Table-driven test of authorization (Implementation Plan step 11, Backend Schema 9): every
// default role against every permission (9.2), the guard algorithm (9.3) and the event-mapping
// rule for moderators and observers. Probe routes are generated for every permission; events
// come from a fake EventAccess until the events tables exist (step 15).
import { Controller, Get, type Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  PERMISSION_CATALOGUE,
  type PermissionKey,
  type SystemRoleKey,
  systemRoleKeys,
} from '@vote-kidigit/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import type { PrismaService, Tx } from '../database/prisma.service.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  apiClient,
  createOrganization,
  createUser,
  deleteOrganizations,
  ownerClient,
  platformContext,
  uniqueSuffix,
} from '../testing/db.js';
import { createTestHttpApp, testIp } from '../testing/http.js';
import { Public, RequirePermission, SignedIn } from './decorators.js';
import { EVENT_ACCESS, type EventAccess } from './event-access.js';

const PASSWORD = 'Uchaguzi2027';

// Backend Schema 9.2, written out independently of app.create_default_roles.
const OBSERVER: PermissionKey[] = [
  'event.view',
  'turnout.view',
  'results.view',
  'reports.download',
  'audit.view.event',
  'voter.view',
];
const MODERATOR: PermissionKey[] = [
  ...OBSERVER,
  'event.create',
  'event.edit',
  'event.publish',
  'event.close',
  'event.cancel',
  'category.manage',
  'contester.manage',
  'voter.manage',
  'messages.send',
  'code.regenerate',
  'kiosk.operate',
  'results.resolve_tie',
  'results.publish',
];
const ADMIN: PermissionKey[] = [
  ...MODERATOR,
  'staff.manage',
  'assignments.manage',
  'org.settings.manage',
  'audit.view.org',
  'event.access_all',
  'event.activate',
  'event.reopen',
  'event.archive',
];
const SUPER_ADMIN: PermissionKey[] = [...ADMIN, 'roles.manage', 'admins.manage'];
const EXPECTED: Record<SystemRoleKey, PermissionKey[]> = {
  org_super_admin: SUPER_ADMIN,
  admin: ADMIN,
  moderator: MODERATOR,
  observer: OBSERVER,
};

// Events seen by the fake EventAccess: one the role users are assigned to, one of their
// organization they are not assigned to; any other id is missing (or of another organization,
// which RLS hides the same way).
const ASSIGNED_EVENT = randomUUID();
const UNASSIGNED_EVENT = randomUUID();
const OTHER_ORG_EVENT = randomUUID();

const probePath = (key: string) => `probe/${key}`;
const eventProbePath = (key: string) => `probe/events/:eventId/${key}`;

/** One GET route per permission, decorated with @RequirePermission(key). */
function buildProbeController(): Type {
  class PermissionProbeController {}
  const proto = PermissionProbeController.prototype as unknown as Record<string, unknown>;
  for (const { key, scope } of PERMISSION_CATALOGUE) {
    const name = `probe_${key.replace(/\W/g, '_')}`;
    proto[name] = () => ({ ok: true });
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor) throw new Error(name);
    RequirePermission(key)(proto, name, descriptor);
    Get(scope === 'event' ? eventProbePath(key) : probePath(key))(proto, name, descriptor);
  }
  Controller()(PermissionProbeController);
  return PermissionProbeController;
}

@Controller('probe')
class MiscProbeController {
  @Get('signed-in')
  @SignedIn()
  signedIn() {
    return { ok: true };
  }

  @Get('undecorated')
  undecorated() {
    return { ok: true };
  }

  @Get('event-without-param')
  @RequirePermission('event.view')
  eventWithoutParam() {
    return { ok: true };
  }

  @Get('public')
  @Public()
  open() {
    return { ok: true };
  }
}

describe('permissions and guards', () => {
  let app: NestExpressApplication;
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  const orgIds: string[] = [];
  const platformUserIds: string[] = [];
  const agents = new Map<SystemRoleKey | 'platform_admin', TestAgent>();
  const assignedUsers = new Set<string>();
  const eventAccess: EventAccess & { calls: { eventId: string; tx: Tx }[] } = {
    calls: [],
    eventExists(tx, eventId) {
      this.calls.push({ eventId, tx });
      return Promise.resolve(eventId === ASSIGNED_EVENT || eventId === UNASSIGNED_EVENT);
    },
    isAssigned(_tx, eventId, userId) {
      return Promise.resolve(eventId === ASSIGNED_EVENT && assignedUsers.has(userId));
    },
  };

  async function signIn(email: string): Promise<TestAgent> {
    const agent = request.agent(app.getHttpServer()).set('X-Forwarded-For', testIp());
    await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
    return agent;
  }

  beforeAll(async () => {
    ({ app } = await createTestHttpApp(
      [buildProbeController(), MiscProbeController],
      [{ provide: EVENT_ACCESS, useValue: eventAccess }],
    ));
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Ushirika');
    orgIds.push(orgId);
    await api.withContext(
      platformContext(),
      (tx) => tx.$executeRaw`SELECT app.create_default_roles(${orgId}::uuid)`,
    );

    for (const systemKey of systemRoleKeys) {
      const email = `${systemKey}-${uniqueSuffix()}@example.test`;
      const userId = await createUser(owner, orgId, {
        email,
        password: PASSWORD,
        isOrgSuperAdmin: systemKey === 'org_super_admin',
      });
      const role = await owner.role.findFirstOrThrow({
        where: { organizationId: orgId, systemKey },
      });
      await owner.userRole.create({ data: { userId, roleId: role.id, organizationId: orgId } });
      // Moderators and observers work on the events they are assigned to.
      if (systemKey === 'moderator' || systemKey === 'observer') assignedUsers.add(userId);
      agents.set(systemKey, await signIn(email));
    }
    const adminEmail = `platform-${uniqueSuffix()}@example.test`;
    platformUserIds.push(await createUser(owner, null, { email: adminEmail, password: PASSWORD }));
    agents.set('platform_admin', await signIn(adminEmail));
  });

  afterAll(async () => {
    await deleteOrganizations(owner, orgIds);
    await owner.user.deleteMany({ where: { id: { in: platformUserIds } } });
    await owner.$disconnect();
    await api.$disconnect();
    await app.close();
  });

  const agent = (role: SystemRoleKey | 'platform_admin') => {
    const found = agents.get(role);
    if (!found) throw new Error(role);
    return found;
  };
  const codeOf = (res: request.Response) => (res.body as { code?: string }).code;

  it('creates the default roles with exactly the permissions of Backend Schema 9.2', async () => {
    for (const systemKey of systemRoleKeys) {
      const role = await owner.role.findFirstOrThrow({
        where: { organizationId: orgId, systemKey },
        select: { rolePermissions: { select: { permissionKey: true } } },
      });
      expect(role.rolePermissions.map((p) => p.permissionKey).sort()).toEqual(
        [...EXPECTED[systemKey]].sort(),
      );
    }
  });

  describe.each(systemRoleKeys)('%s', (systemKey) => {
    const granted = new Set<string>(EXPECTED[systemKey]);
    const orgKeys = PERMISSION_CATALOGUE.filter((p) => p.scope === 'org').map((p) => p.key);
    const eventKeys = PERMISSION_CATALOGUE.filter((p) => p.scope === 'event').map((p) => p.key);
    const platformKeys = PERMISSION_CATALOGUE.filter((p) => p.scope === 'platform').map(
      (p) => p.key,
    );

    it.each(orgKeys)('org permission %s', async (key) => {
      const res = await agent(systemKey).get(`/api/${probePath(key)}`);
      expect(res.status).toBe(granted.has(key) ? 200 : 403);
    });

    it.each(eventKeys)('event permission %s', async (key) => {
      const get = (eventId: string) =>
        agent(systemKey).get(`/api/${eventProbePath(key).replace(':eventId', eventId)}`);
      if (!granted.has(key)) {
        // A missing permission is 403 before the event is looked up.
        for (const eventId of [ASSIGNED_EVENT, UNASSIGNED_EVENT, OTHER_ORG_EVENT]) {
          expect((await get(eventId)).status).toBe(403);
        }
        return;
      }
      const accessAll = granted.has('event.access_all');
      // Moderators and observers only on the event they are assigned to; Admins everywhere.
      expect((await get(ASSIGNED_EVENT)).status).toBe(200);
      expect((await get(UNASSIGNED_EVENT)).status).toBe(accessAll ? 200 : 404);
      // Other organizations' events and malformed ids are "not found" for everyone.
      const other = await get(OTHER_ORG_EVENT);
      expect(other.status).toBe(404);
      expect(codeOf(other)).toBe('NOT_FOUND');
      expect((await get('not-a-uuid')).status).toBe(404);
    });

    it.each(platformKeys)('platform permission %s is not found', async (key) => {
      const res = await agent(systemKey).get(`/api/${probePath(key)}`);
      expect(res.status).toBe(404);
      expect(codeOf(res)).toBe('NOT_FOUND');
    });
  });

  describe('platform administrator', () => {
    it.each(PERMISSION_CATALOGUE.map((p) => [p.key, p.scope] as const))(
      '%s (%s)',
      async (key, scope) => {
        const path =
          scope === 'event'
            ? `/api/${eventProbePath(key).replace(':eventId', ASSIGNED_EVENT)}`
            : `/api/${probePath(key)}`;
        const res = await agent('platform_admin').get(path);
        // Platform permissions only: organization data is not theirs to act on.
        expect(res.status).toBe(scope === 'platform' ? 200 : 403);
      },
    );
  });

  describe('guard rules', () => {
    it('looks events up inside the user transaction', async () => {
      eventAccess.calls.length = 0;
      await agent('moderator')
        .get(`/api/${eventProbePath('event.view').replace(':eventId', ASSIGNED_EVENT)}`)
        .expect(200);
      expect(eventAccess.calls).toHaveLength(1);
      expect(eventAccess.calls[0]?.eventId).toBe(ASSIGNED_EVENT);
    });

    it('lets every signed-in user call @SignedIn routes', async () => {
      for (const role of [...systemRoleKeys, 'platform_admin'] as const) {
        await agent(role).get('/api/probe/signed-in').expect(200);
      }
    });

    it('needs a session for protected routes', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${probePath('event.create')}`)
        .set('X-Forwarded-For', testIp())
        .expect(401);
      expect(codeOf(res)).toBe('UNAUTHENTICATED');
      await request(app.getHttpServer())
        .get('/api/probe/public')
        .set('X-Forwarded-For', testIp())
        .expect(200);
    });

    it('refuses routes without an access decorator, and event permissions without :eventId', async () => {
      const undecorated = await agent('org_super_admin').get('/api/probe/undecorated');
      expect(undecorated.status).toBe(500);
      expect(codeOf(undecorated)).toBe('INTERNAL');
      const noParam = await agent('org_super_admin').get('/api/probe/event-without-param');
      expect(noParam.status).toBe(500);
    });
  });

  describe('GET /permissions', () => {
    it('returns the catalogue to users who manage roles', async () => {
      // A key this build does not know (another test's, or one added ahead of a deployment) is
      // left out instead of failing the response.
      const unknownKey = `test.unknown.${uniqueSuffix()}`;
      await owner.permission.create({
        data: {
          key: unknownKey,
          module: 'Test',
          descriptionEn: 'x',
          descriptionSw: 'x',
          scope: 'org',
        },
      });
      let res: request.Response;
      try {
        res = await agent('org_super_admin').get('/api/v1/permissions');
      } finally {
        await owner.permission.delete({ where: { key: unknownKey } });
      }
      expect(res.status).toBe(200);
      const items = (res.body as { items: { key: string; descriptionSw: string }[] }).items;
      expect(items.map((p) => p.key).sort()).toEqual(PERMISSION_CATALOGUE.map((p) => p.key).sort());
      expect(items.every((p) => p.descriptionSw.length > 0)).toBe(true);
    });

    it('is forbidden without roles.manage', async () => {
      await agent('admin').get('/api/v1/permissions').expect(403);
      await agent('observer').get('/api/v1/permissions').expect(403);
    });
  });
});
