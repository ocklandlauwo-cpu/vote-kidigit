// IDOR (Implementation Plan step 32, PRD NFR-16): every staff route with an :id, called by an
// Org Super Admin of organization A (every permission, every event) with the IDs of real records
// of organization B, answers 404, and never touches B's data. A second pass keeps A's own event
// in the path and puts B's IDs in the other parameters, so a record cannot be reached through an
// event the caller may open. Routes come from the controllers' metadata, so a new route is
// covered without editing this test.
import { Module, RequestMethod } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { MeResponse } from '@vote-kidigit/shared';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { ApiModule } from '../api.module.js';
import { IS_PUBLIC } from '../auth/decorators.js';
import type { PrismaService } from '../database/prisma.service.js';
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

const PASSWORD = 'Uchaguzi2027';

/**
 * Valid bodies for routes that check the body before the record: with an empty body they answer
 * 400, which would hide whether B's record is reachable. With these, only the lookup decides.
 */
const VALID_BODIES: Record<string, object> = {
  'PATCH /api/v1/users/:userId': { fullName: 'Jina Jipya' },
  'PUT /api/v1/users/:userId/assignments': { assignments: [] },
  'PUT /api/v1/events/:eventId/assignments': { assignments: [] },
  'PATCH /api/v1/roles/:roleId': { name: 'Jukumu Jipya' },
  'PUT /api/v1/events/:eventId/categories/:categoryId/eligibility': { mode: 'all' },
  'POST /api/v1/events/:eventId/categories/:categoryId/contesters': { fullName: 'Mgombea' },
};

interface Route {
  name: string;
  method: string;
  path: string;
}

const METHODS: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
};

/** Every non-public route with a path parameter, from the controllers' metadata. */
async function routesWithIds(): Promise<Route[]> {
  @Module({ imports: [ApiModule, DiscoveryModule] })
  class ScanModule {}
  const moduleRef = await Test.createTestingModule({ imports: [ScanModule] }).compile();
  const reflector = moduleRef.get(Reflector);
  const scanner = new MetadataScanner();
  const routes: Route[] = [];
  for (const wrapper of moduleRef.get(DiscoveryService).getControllers()) {
    const instance = wrapper.instance as Record<string, unknown> | undefined;
    const type = wrapper.metatype;
    if (!instance || !type || typeof type !== 'function') continue;
    const proto = Object.getPrototypeOf(instance) as object;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = (proto as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      const handlerPath: unknown = Reflect.getMetadata('path', handler);
      if (handlerPath === undefined) continue;
      if (reflector.getAllAndOverride<boolean>(IS_PUBLIC, [handler, type])) continue;
      const method = METHODS[Reflect.getMetadata('method', handler) as RequestMethod];
      const path = `/api/${[Reflect.getMetadata('path', type), handlerPath].map(String).join('/')}`
        .replace(/\/+/g, '/')
        .replace(/\/$/, '');
      if (method && path.includes('/:'))
        routes.push({ name: `${type.name}.${name}`, method, path });
    }
  }
  await moduleRef.close();
  return routes;
}

describe('IDOR: another organization’s IDs are always 404', () => {
  let app: NestExpressApplication;
  let owner: PrismaClient;
  let api: PrismaService;
  let orgA: string;
  let orgB: string;
  let agent: TestAgent;
  let csrf: string;
  let routes: Route[];
  const idsB: Record<string, string> = {};
  let eventA: string;

  beforeAll(async () => {
    routes = await routesWithIds();
    ({ app } = await createTestHttpApp());
    owner = ownerClient();
    api = apiClient();
    orgA = await createOrganization(owner, 'Chama A IDOR');
    orgB = await createOrganization(owner, 'Chama B IDOR');
    for (const org of [orgA, orgB]) {
      await api.withContext(
        platformContext(),
        (tx) => tx.$executeRaw`SELECT app.create_default_roles(${org}::uuid)`,
      );
    }

    // The caller: Org Super Admin of A (every organization permission).
    const email = `idor-${uniqueSuffix()}@example.test`;
    const adminA = await createUser(owner, orgA, {
      email,
      password: PASSWORD,
      isOrgSuperAdmin: true,
    });
    const superRole = await owner.role.findFirstOrThrow({
      where: { organizationId: orgA, systemKey: 'org_super_admin' },
    });
    await owner.userRole.create({
      data: { userId: adminA, roleId: superRole.id, organizationId: orgA },
    });
    agent = request.agent(app.getHttpServer()).set('X-Forwarded-For', testIp());
    const login = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    csrf = (login.body as MeResponse).csrfToken;
    eventA = (
      await owner.votingEvent.create({
        data: {
          organizationId: orgA,
          name: `A ${uniqueSuffix()}`,
          startAt: new Date(Date.now() + 86_400_000),
          endAt: new Date(Date.now() + 2 * 86_400_000),
        },
      })
    ).id;

    // Real records of B for every kind of path parameter.
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgB,
        name: `B ${uniqueSuffix()}`,
        startAt: new Date(Date.now() + 86_400_000),
        endAt: new Date(Date.now() + 2 * 86_400_000),
      },
    });
    const category = await owner.category.create({
      data: { organizationId: orgB, eventId: event.id, name: 'Mwenyekiti', displayOrder: 1 },
    });
    const contester = await owner.contester.create({
      data: { organizationId: orgB, eventId: event.id, categoryId: category.id, fullName: 'Asha' },
    });
    const voter = await owner.voter.create({
      data: {
        organizationId: orgB,
        eventId: event.id,
        fullName: 'Juma',
        membershipId: `B-${uniqueSuffix()}`,
        phone: '+255712000001',
        gender: 'male',
      },
    });
    const userB = await createUser(owner, orgB);
    const roleB = await owner.role.findFirstOrThrow({
      where: { organizationId: orgB, systemKey: 'moderator' },
    });
    await owner.userRole.create({
      data: { userId: userB, roleId: roleB.id, organizationId: orgB },
    });
    const batch = await owner.smsBatch.create({
      data: {
        organizationId: orgB,
        eventId: event.id,
        type: 'code_delivery',
        channel: 'sms',
        audience: 'all',
      },
    });
    const voterImport = await owner.voterImport.create({
      data: { organizationId: orgB, eventId: event.id },
    });
    const file = await owner.file.create({
      data: {
        organizationId: orgB,
        kind: 'report',
        storagePath: `org/${orgB}/report/${uniqueSuffix()}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
      },
    });
    const job = await owner.reportJob.create({
      data: { organizationId: orgB, eventId: event.id, type: 'voters_pdf' },
    });
    const kiosk = await owner.kioskSession.create({
      data: {
        organizationId: orgB,
        eventId: event.id,
        deviceLabel: 'B tablet',
        tokenHash: new Uint8Array(createHash('sha256').update(randomBytes(32)).digest()),
        pinHash: 'not-used',
        launchedBy: userB,
      },
    });
    Object.assign(idsB, {
      eventId: event.id,
      categoryId: category.id,
      contesterId: contester.id,
      voterId: voter.id,
      userId: userB,
      roleId: roleB.id,
      batchId: batch.id,
      importId: voterImport.id,
      fileId: file.id,
      jobId: job.id,
      sessionId: kiosk.id,
      orgId: orgB,
    });
  }, 120_000);

  afterAll(async () => {
    await deleteOrganizations(owner, [orgA, orgB]);
    await owner.$disconnect();
    await api.$disconnect();
    await app.close();
  });

  function fill(path: string, ids: Record<string, string>): string {
    return path.replace(/:(\w+)/g, (_, name: string) => {
      const id = ids[name];
      if (!id) throw new Error(`no fixture for :${name} in ${path}`);
      return id;
    });
  }

  async function statusOf(route: Route, ids: Record<string, string>): Promise<number> {
    const url = fill(route.path, ids);
    const call = agent[route.method as 'get'](url).set('X-CSRF-Token', csrf);
    const body = VALID_BODIES[`${route.method.toUpperCase()} ${route.path}`] ?? {};
    const res =
      route.method === 'get' || route.method === 'delete' ? await call : await call.send(body);
    return res.status;
  }

  it('covers the routes it should', () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes.map((r) => r.name)).toEqual(
      expect.arrayContaining(['UsersController.detail', 'FilesController.get']),
    );
  });

  it('answers 404 to every route with B’s IDs', async () => {
    const leaks: string[] = [];
    for (const route of routes) {
      const status = await statusOf(route, idsB);
      if (status !== 404) leaks.push(`${route.method.toUpperCase()} ${route.path} → ${status}`);
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it('answers 404 to B’s records reached through A’s own event', async () => {
    const leaks: string[] = [];
    for (const route of routes.filter(
      (r) => r.path.includes(':eventId/') && /:\w+.*:\w+/.test(r.path),
    )) {
      const status = await statusOf(route, { ...idsB, eventId: eventA });
      if (status !== 404) leaks.push(`${route.method.toUpperCase()} ${route.path} → ${status}`);
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it('left B’s records untouched', async () => {
    expect(await owner.votingEvent.count({ where: { id: idsB.eventId, deletedAt: null } })).toBe(1);
    expect(await owner.voter.count({ where: { id: idsB.voterId, deletedAt: null } })).toBe(1);
    expect(await owner.category.count({ where: { id: idsB.categoryId } })).toBe(1);
    expect(await owner.user.findUniqueOrThrow({ where: { id: idsB.userId } })).toMatchObject({
      status: 'active',
      deletedAt: null,
      fullName: 'Test User',
    });
    expect((await owner.role.findUniqueOrThrow({ where: { id: idsB.roleId } })).name).not.toBe(
      'Jukumu Jipya',
    );
    expect(await owner.contester.count({ where: { eventId: idsB.eventId } })).toBe(1);
    expect(
      (await owner.category.findUniqueOrThrow({ where: { id: idsB.categoryId } })).eligibility,
    ).toBe('all');
  });
});
