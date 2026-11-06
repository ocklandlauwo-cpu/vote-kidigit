// Integration test of the events API (Implementation Plan step 16, Backend Schema 12.5): each
// endpoint and its permission, the assignment rule (moderators and observers see only their
// events), deactivation, the setup lock as the API reports it, and the audit entries.
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  type AuditPage,
  ChecklistResponseSchema,
  type EventAssignmentsResponse,
  type EventDetail,
  EventPageSchema,
  type MeResponse,
  type SystemRoleKey,
  type UserAssignmentsResponse,
} from '@vote-kidigit/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { EventStatus } from '../../generated/prisma/enums.js';
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
const HOUR = 3_600_000;
const codeOf = (res: request.Response) => (res.body as { code?: string }).code;

interface Staff {
  id: string;
  email: string;
  agent: TestAgent;
  csrf: string;
}

describe('events API', () => {
  let app: NestExpressApplication;
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  let otherOrgId: string;
  const roleIds = {} as Record<SystemRoleKey, string>;
  const staff = {} as Record<'admin' | 'moderator' | 'otherModerator' | 'observer', Staff>;

  const server = () => app.getHttpServer();
  const send = (
    who: Staff,
    method: 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: object,
  ) => who.agent[method](`/api/v1${path}`).set('X-CSRF-Token', who.csrf).send(body);
  const get = (who: Staff, path: string) => who.agent.get(`/api/v1${path}`);

  async function newStaff(role: SystemRoleKey, org = orgId): Promise<Staff> {
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
    const agent = request.agent(server()).set('X-Forwarded-For', testIp());
    const res = await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { id, email, agent, csrf: (res.body as MeResponse).csrfToken };
  }

  /** An event seeded as the owner, optionally in another status and assigned to users. */
  async function seedEvent(
    options: {
      status?: EventStatus;
      assign?: Staff[];
      name?: string;
      startInHours?: number;
      isActive?: boolean;
    } = {},
  ): Promise<string> {
    const start = options.startInHours ?? 24;
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: options.name ?? `AGM ${uniqueSuffix()}`,
        startAt: new Date(Date.now() + start * HOUR),
        endAt: new Date(Date.now() + (start + 24) * HOUR),
        status: options.status ?? 'draft',
        isActive: options.isActive ?? true,
        ...(options.status === 'cancelled' && { cancelReason: 'Seeded for a test' }),
      },
    });
    for (const user of options.assign ?? []) {
      await owner.eventAssignment.create({
        data: {
          organizationId: orgId,
          eventId: event.id,
          userId: user.id,
          type: user === staff.observer ? 'observer' : 'moderator',
        },
      });
    }
    return event.id;
  }

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Uchaguzi');
    otherOrgId = await createOrganization(owner, 'Shirika Jingine');
    for (const id of [orgId, otherOrgId]) {
      await api.withContext(
        platformContext(),
        (tx) => tx.$executeRaw`SELECT app.create_default_roles(${id}::uuid)`,
      );
    }
    for (const role of await owner.role.findMany({ where: { organizationId: orgId } })) {
      roleIds[role.systemKey as SystemRoleKey] = role.id;
    }
    staff.admin = await newStaff('admin');
    staff.moderator = await newStaff('moderator');
    staff.otherModerator = await newStaff('moderator');
    staff.observer = await newStaff('observer');
  });

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId, otherOrgId]);
    await owner.$disconnect();
    await api.$disconnect();
    await app.close();
  });

  describe('list', () => {
    it('shows Admins every active event and moderators only their own', async () => {
      const tag = uniqueSuffix();
      const mine = await seedEvent({ name: `Mine ${tag}`, assign: [staff.moderator] });
      const notMine = await seedEvent({ name: `Other ${tag}` });
      const hidden = await seedEvent({
        name: `Hidden ${tag}`,
        assign: [staff.moderator],
        isActive: false,
      });

      const asAdmin = EventPageSchema.parse(
        (await get(staff.admin, `/events?q=${tag}`).expect(200)).body,
      );
      expect(asAdmin.items.map((e) => e.id).sort()).toEqual([mine, notMine].sort());
      const withInactive = EventPageSchema.parse(
        (await get(staff.admin, `/events?q=${tag}&includeInactive=true`).expect(200)).body,
      );
      expect(withInactive.items.map((e) => e.id)).toContain(hidden);

      const asModerator = EventPageSchema.parse(
        (await get(staff.moderator, `/events?q=${tag}&includeInactive=true`).expect(200)).body,
      );
      expect(asModerator.items.map((e) => e.id)).toEqual([mine]);
      expect(
        EventPageSchema.parse(
          (await get(staff.otherModerator, `/events?q=${tag}`).expect(200)).body,
        ).total,
      ).toBe(0);
    });

    it('sorts Open first, then Scheduled by start, then the rest; filters by status', async () => {
      const tag = uniqueSuffix();
      const draft = await seedEvent({ name: `D ${tag}` });
      const later = await seedEvent({ name: `S2 ${tag}`, status: 'scheduled', startInHours: 48 });
      const sooner = await seedEvent({ name: `S1 ${tag}`, status: 'scheduled', startInHours: 12 });
      const open = await seedEvent({ name: `O ${tag}`, status: 'open', startInHours: -1 });
      const page = EventPageSchema.parse(
        (await get(staff.admin, `/events?q=${tag}`).expect(200)).body,
      );
      expect(page.items.map((e) => e.id)).toEqual([open, sooner, later, draft]);
      const scheduled = EventPageSchema.parse(
        (await get(staff.admin, `/events?q=${tag}&status=scheduled`).expect(200)).body,
      );
      expect(scheduled.items.map((e) => e.id)).toEqual([sooner, later]);
    });

    it('lists moderator names and counts', async () => {
      const id = await seedEvent({ assign: [staff.moderator, staff.observer] });
      const category = await owner.category.create({
        data: { organizationId: orgId, eventId: id, name: 'Mwenyekiti', displayOrder: 1 },
      });
      await owner.category.create({
        data: {
          organizationId: orgId,
          eventId: id,
          name: 'Zamani',
          displayOrder: 2,
          isActive: false,
        },
      });
      void category;
      const detail = (await get(staff.admin, `/events/${id}`).expect(200)).body as EventDetail;
      expect(detail).toMatchObject({
        activeCategories: 1,
        categories: 2,
        voters: 0,
        moderators: ['Test User'],
      });
    });
  });

  describe('create', () => {
    it('creates a Draft and assigns a moderator creator to it', async () => {
      const res = await send(staff.moderator, 'post', '/events', {
        name: 'AGM 2027',
        startAt: new Date(Date.now() + 24 * HOUR).toISOString(),
        endAt: new Date(Date.now() + 30 * HOUR).toISOString(),
      }).expect(201);
      const event = res.body as EventDetail;
      expect(event).toMatchObject({ name: 'AGM 2027', status: 'draft', isActive: true });
      const me = (await get(staff.moderator, '/me').expect(200)).body as MeResponse;
      expect(me.mappedEventIds).toContain(event.id);
      await get(staff.moderator, `/events/${event.id}`).expect(200);
      expect(
        await owner.auditLog.count({ where: { action: 'event.create', eventId: event.id } }),
      ).toBe(1);
    });

    it('does not assign Admins, who see every event anyway', async () => {
      const res = await send(staff.admin, 'post', '/events', {
        name: 'Uchaguzi wa Bodi',
        startAt: new Date(Date.now() + 24 * HOUR).toISOString(),
        endAt: new Date(Date.now() + 30 * HOUR).toISOString(),
      }).expect(201);
      expect(
        await owner.eventAssignment.count({ where: { eventId: (res.body as EventDetail).id } }),
      ).toBe(0);
    });

    it('accepts a start in the past (Open now) but not an end before the start', async () => {
      await send(staff.admin, 'post', '/events', {
        name: 'Leo',
        startAt: new Date(Date.now() - HOUR).toISOString(),
        endAt: new Date(Date.now() + HOUR).toISOString(),
      }).expect(201);
      const res = await send(staff.admin, 'post', '/events', {
        name: 'Kinyume',
        startAt: new Date(Date.now() + 2 * HOUR).toISOString(),
        endAt: new Date(Date.now() + HOUR).toISOString(),
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain('"path":"endAt"');
      await send(staff.admin, 'post', '/events', {
        name: 'X',
        startAt: 'kesho',
        endAt: 'kesho',
      }).expect(400);
    });

    it('is not open to observers', async () => {
      await send(staff.observer, 'post', '/events', {
        name: 'Hapana',
        startAt: new Date(Date.now() + HOUR).toISOString(),
        endAt: new Date(Date.now() + 2 * HOUR).toISOString(),
      }).expect(403);
    });
  });

  describe('detail, edit and delete', () => {
    it('answers 404 for unassigned, other-organization and unknown events', async () => {
      const id = await seedEvent({ assign: [staff.moderator] });
      await get(staff.moderator, `/events/${id}`).expect(200);
      await get(staff.otherModerator, `/events/${id}`).expect(404);
      await get(staff.observer, `/events/${id}`).expect(404);
      await get(staff.admin, `/events/${randomUUID()}`).expect(404);
      const other = await newStaff('admin', otherOrgId);
      expect(codeOf(await get(other, `/events/${id}`).expect(404))).toBe('NOT_FOUND');
    });

    it('edits a Draft; after publish only results and reminder settings', async () => {
      const id = await seedEvent({ assign: [staff.moderator] });
      const res = await send(staff.moderator, 'patch', `/events/${id}`, {
        name: 'Jina Jipya',
        showParty: true,
      }).expect(200);
      expect(res.body as EventDetail).toMatchObject({ name: 'Jina Jipya', showParty: true });
      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'event.update', eventId: id },
      });
      expect(audit.after).toMatchObject({ name: 'Jina Jipya', showParty: true });

      await owner.votingEvent.update({ where: { id }, data: { status: 'scheduled' } });
      expect(
        codeOf(await send(staff.moderator, 'patch', `/events/${id}`, { name: 'Tena' }).expect(409)),
      ).toBe('EVENT_LOCKED');
      await send(staff.moderator, 'patch', `/events/${id}`, {
        resultsVisibility: 'winners_only',
      }).expect(200);
    });

    it('validates edits and keeps observers out', async () => {
      const id = await seedEvent({ assign: [staff.moderator, staff.observer] });
      await send(staff.moderator, 'patch', `/events/${id}`, {}).expect(400);
      await send(staff.moderator, 'patch', `/events/${id}`, {
        startAt: new Date(Date.now() + 10 * HOUR).toISOString(),
        endAt: new Date(Date.now() + 5 * HOUR).toISOString(),
      }).expect(400);
      await send(staff.observer, 'patch', `/events/${id}`, { name: 'Hapana' }).expect(403);
    });

    it('deletes Draft and Cancelled events only', async () => {
      const draft = await seedEvent({ assign: [staff.moderator] });
      await send(staff.moderator, 'delete', `/events/${draft}`).expect(204);
      await get(staff.moderator, `/events/${draft}`).expect(404);
      expect(
        await owner.auditLog.count({ where: { action: 'event.delete', eventId: draft } }),
      ).toBe(1);
      const open = await seedEvent({ status: 'open', startInHours: -1, assign: [staff.moderator] });
      expect(codeOf(await send(staff.moderator, 'delete', `/events/${open}`).expect(409))).toBe(
        'EVENT_LOCKED',
      );
      const cancelled = await seedEvent({ status: 'cancelled' });
      await send(staff.admin, 'delete', `/events/${cancelled}`).expect(204);
    });
  });

  describe('checklist', () => {
    it('returns the six items for anyone who may view the event', async () => {
      const id = await seedEvent({ assign: [staff.observer] });
      const res = await get(staff.observer, `/events/${id}/checklist`).expect(200);
      const { items } = ChecklistResponseSchema.parse(res.body);
      expect(items.map((i) => i.item)).toEqual([
        'details',
        'categories',
        'contesters',
        'rules',
        'voters',
        'eligibility',
      ]);
      expect(items[0]?.ok).toBe(true);
      expect(items[1]?.ok).toBe(false);
    });
  });

  describe('assignments', () => {
    it('lets Admins replace an event’s staff; the change applies at once', async () => {
      const id = await seedEvent({ assign: [staff.moderator] });
      const res = await send(staff.admin, 'put', `/events/${id}/assignments`, {
        assignments: [
          { userId: staff.otherModerator.id, type: 'moderator' },
          { userId: staff.observer.id, type: 'observer' },
        ],
      }).expect(200);
      expect(
        (res.body as EventAssignmentsResponse).items.map((a) => [a.userId, a.type]).sort(),
      ).toEqual(
        [
          [staff.otherModerator.id, 'moderator'],
          [staff.observer.id, 'observer'],
        ].sort(),
      );
      await get(staff.moderator, `/events/${id}`).expect(404);
      await get(staff.otherModerator, `/events/${id}`).expect(200);
      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'event.assignments.update', eventId: id },
      });
      expect(audit.after).toMatchObject({ assignments: expect.any(Array) as unknown });
      const list = (await get(staff.observer, `/events/${id}/assignments`).expect(200))
        .body as EventAssignmentsResponse;
      expect(list.items).toHaveLength(2);
    });

    it('refuses unknown users, users of other organizations and duplicates; moderators may not edit', async () => {
      const id = await seedEvent({ assign: [staff.moderator] });
      const foreign = await createUser(owner, otherOrgId);
      for (const userId of [randomUUID(), foreign]) {
        await send(staff.admin, 'put', `/events/${id}/assignments`, {
          assignments: [{ userId, type: 'observer' }],
        }).expect(400);
      }
      await send(staff.admin, 'put', `/events/${id}/assignments`, {
        assignments: [
          { userId: staff.observer.id, type: 'observer' },
          { userId: staff.observer.id, type: 'moderator' },
        ],
      }).expect(400);
      await send(staff.moderator, 'put', `/events/${id}/assignments`, { assignments: [] }).expect(
        403,
      );
      await send(staff.admin, 'put', `/events/${randomUUID()}/assignments`, {
        assignments: [],
      }).expect(404);
    });

    it('edits the same mapping from the person', async () => {
      const a = await seedEvent();
      const b = await seedEvent();
      const user = await newStaff('moderator');
      const res = await send(staff.admin, 'put', `/users/${user.id}/assignments`, {
        assignments: [
          { eventId: a, type: 'moderator' },
          { eventId: b, type: 'observer' },
        ],
      }).expect(200);
      expect((res.body as UserAssignmentsResponse).items.map((x) => x.eventId).sort()).toEqual(
        [a, b].sort(),
      );
      const me = (await get(user, '/me').expect(200)).body as MeResponse;
      expect(me.mappedEventIds.sort()).toEqual([a, b].sort());
      const event = (await get(staff.admin, `/events/${b}/assignments`).expect(200))
        .body as EventAssignmentsResponse;
      expect(event.items).toEqual([expect.objectContaining({ userId: user.id, type: 'observer' })]);
      await send(staff.admin, 'put', `/users/${user.id}/assignments`, {
        assignments: [{ eventId: randomUUID(), type: 'moderator' }],
      }).expect(400);
      expect(
        await owner.auditLog.count({
          where: { action: 'user.assignments.update', entityId: user.id },
        }),
      ).toBe(1);
      await get(staff.moderator, `/users/${user.id}/assignments`).expect(403);
    });
  });

  describe('activate and deactivate', () => {
    it('hides a deactivated event from its moderators until reactivated', async () => {
      const id = await seedEvent({ assign: [staff.moderator] });
      const res = await send(staff.admin, 'post', `/events/${id}/deactivate`).expect(200);
      expect((res.body as EventDetail).isActive).toBe(false);
      await get(staff.moderator, `/events/${id}`).expect(404);
      await get(staff.admin, `/events/${id}`).expect(200);
      await send(staff.admin, 'post', `/events/${id}/deactivate`).expect(409);
      await send(staff.admin, 'post', `/events/${id}/activate`).expect(200);
      await get(staff.moderator, `/events/${id}`).expect(200);
      expect(
        await owner.auditLog.count({ where: { action: 'event.deactivate', eventId: id } }),
      ).toBe(1);
    });

    it('never deactivates an open event, and moderators may not toggle', async () => {
      const open = await seedEvent({ status: 'open', startInHours: -1, assign: [staff.moderator] });
      const res = await send(staff.admin, 'post', `/events/${open}/deactivate`).expect(409);
      expect(res.body).toMatchObject({
        code: 'INVALID_TRANSITION',
        details: { reason: 'EVENT_OPEN' },
      });
      await send(staff.moderator, 'post', `/events/${open}/deactivate`).expect(403);
    });
  });

  describe('activity', () => {
    it('shows only this event’s entries to its staff', async () => {
      const id = await seedEvent({ assign: [staff.moderator, staff.observer] });
      await send(staff.moderator, 'patch', `/events/${id}`, { name: 'Imebadilishwa' }).expect(200);
      const other = await seedEvent({ assign: [staff.moderator] });
      await send(staff.moderator, 'patch', `/events/${other}`, { name: 'Nyingine' }).expect(200);
      const page = (await get(staff.observer, `/events/${id}/audit`).expect(200)).body as AuditPage;
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.every((e) => e.eventId === id)).toBe(true);
      await get(staff.otherModerator, `/events/${id}/audit`).expect(404);
    });
  });

  it('gives platform administrators no events of their own', async () => {
    const email = `platform-${uniqueSuffix()}@example.test`;
    const userId = await createUser(owner, null, { email, password: PASSWORD });
    try {
      const agent = request.agent(server()).set('X-Forwarded-For', testIp());
      await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
      await agent.get('/api/v1/events').expect(404);
    } finally {
      await owner.user.delete({ where: { id: userId } });
    }
  });
});
