// Control room (Implementation Plan step 26): turnout matches participation, nothing per
// contester before close, a manual category close is permanent, alerts, the "not voted" audience
// and the rule that an Open event keeps a moderator.
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { BatchEstimate, Live, MeResponse, SystemRoleKey } from '@vote-kidigit/shared';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  apiClient,
  createOrganization,
  createUser,
  deleteOrganizations,
  orgContext,
  ownerClient,
  platformContext,
  uniqueSuffix,
} from '../../testing/db.js';
import { createTestHttpApp, testIp } from '../../testing/http.js';

const PASSWORD = 'Uchaguzi2027';
const codeOf = (res: request.Response) => (res.body as { code?: string }).code;

interface Staff {
  id: string;
  agent: TestAgent;
  csrf: string;
}

describe('control room', () => {
  let app: NestExpressApplication;
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  const staff = {} as Record<'admin' | 'moderator' | 'observer', Staff>;
  let order = 0;

  const get = (who: Staff, path: string) => who.agent.get(`/api/v1${path}`);
  const post = (who: Staff, path: string, body?: object) =>
    who.agent.post(`/api/v1${path}`).set('X-CSRF-Token', who.csrf).send(body);

  async function newStaff(role: SystemRoleKey): Promise<Staff> {
    const email = `${role}-${uniqueSuffix()}@example.test`;
    const id = await createUser(owner, orgId, { email, password: PASSWORD });
    const roleRow = await owner.role.findFirstOrThrow({
      where: { organizationId: orgId, systemKey: role },
    });
    await owner.userRole.create({
      data: { userId: id, roleId: roleRow.id, organizationId: orgId },
    });
    const agent = request.agent(app.getHttpServer()).set('X-Forwarded-For', testIp());
    const res = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    return { id, agent, csrf: (res.body as MeResponse).csrfToken };
  }

  async function seedOpenEvent(voters: number) {
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: `Live ${uniqueSuffix()}`,
        startAt: new Date(Date.now() - 3_600_000),
        endAt: new Date(Date.now() + 8 * 3_600_000),
        status: 'open',
      },
    });
    for (const [who, type] of [
      [staff.moderator, 'moderator'],
      [staff.observer, 'observer'],
    ] as const) {
      await owner.eventAssignment.create({
        data: { organizationId: orgId, eventId: event.id, userId: who.id, type },
      });
    }
    const categories = [];
    for (const name of ['Mwenyekiti', 'Katibu']) {
      order += 1;
      const category = await owner.category.create({
        data: {
          organizationId: orgId,
          eventId: event.id,
          name: `${name} ${order}`,
          displayOrder: order,
        },
      });
      const contesters = [];
      for (const fullName of ['Asha Mollel', 'Juma Ali']) {
        contesters.push(
          await owner.contester.create({
            data: { organizationId: orgId, eventId: event.id, categoryId: category.id, fullName },
          }),
        );
      }
      categories.push({ id: category.id, contesterIds: contesters.map((c) => c.id) });
    }
    const tag = uniqueSuffix();
    await owner.voter.createMany({
      data: Array.from({ length: voters }, (_, i) => ({
        organizationId: orgId,
        eventId: event.id,
        fullName: `Mpiga kura ${i}`,
        membershipId: `${tag}-${i}`,
        phone: '+255712000001',
        gender: 'female' as const,
      })),
    });
    const voterIds = (
      await owner.voter.findMany({ where: { eventId: event.id }, orderBy: { membershipId: 'asc' } })
    ).map((v) => v.id);
    return { id: event.id, categories, voterIds };
  }

  async function cast(eventId: string, voterId: string, selections: object[], channel: string) {
    await api.withContext(orgContext(orgId), (tx) =>
      tx.$queryRawUnsafe(
        `SELECT app.cast_ballot($1::uuid, $2::uuid, $3::jsonb, $4::vote_channel)`,
        voterId,
        eventId,
        JSON.stringify(selections),
        channel,
      ),
    );
  }

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Udhibiti');
    await api.withContext(
      platformContext(),
      (tx) => tx.$executeRaw`SELECT app.create_default_roles(${orgId}::uuid)`,
    );
    staff.admin = await newStaff('admin');
    staff.moderator = await newStaff('moderator');
    staff.observer = await newStaff('observer');
  });

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId]);
    await owner.$disconnect();
    await api.$disconnect();
    await app.close();
  });

  it('counts turnout from participation, per category and channel, with nothing per contester', async () => {
    const event = await seedOpenEvent(5);
    const [chair, secretary] = event.categories;
    const pick = (c: typeof chair, i: number) => ({
      categoryId: c?.id,
      choice: 'contester',
      contesterIds: [c?.contesterIds[i]],
    });
    await cast(event.id, event.voterIds[0] ?? '', [pick(chair, 0), pick(secretary, 1)], 'web');
    await cast(event.id, event.voterIds[1] ?? '', [pick(chair, 1)], 'kiosk');
    await cast(event.id, event.voterIds[2] ?? '', [pick(secretary, 0)], 'web');

    const live = (await get(staff.moderator, `/events/${event.id}/live`).expect(200)).body as Live;
    expect(live.turnout).toEqual({ voted: 3, registered: 5, percent: 60 });
    expect(live.notVoted).toBe(2);
    expect(live.channels).toEqual({ web: 2, ussd: 0, kiosk: 1 });
    expect(live.categories.map((c) => [c.id, c.voted, c.eligible])).toEqual([
      [chair?.id, 2, 5],
      [secretary?.id, 2, 5],
    ]);
    // The same numbers as the participation table itself.
    expect(
      await owner.voterParticipation.groupBy({ by: ['voterId'], where: { eventId: event.id } }),
    ).toHaveLength(live.turnout.voted);
    // Nothing per contester anywhere in the response.
    const text = JSON.stringify(live);
    for (const id of [...(chair?.contesterIds ?? []), ...(secretary?.contesterIds ?? [])]) {
      expect(text).not.toContain(id);
    }
    expect(text).not.toMatch(/contester/i);

    // Kiosks are listed only for kiosk.operate (the observer has turnout.view only).
    expect(live.kiosks).toEqual([]);
    const observed = (await get(staff.observer, `/events/${event.id}/live`).expect(200))
      .body as Live;
    expect(observed.kiosks).toBeNull();

    // "Not voted" reaches exactly the two who have not voted.
    const estimate = (
      await get(
        staff.moderator,
        `/events/${event.id}/batches/estimate?type=reminder_before_close&audience=not_voted`,
      ).expect(200)
    ).body as BatchEstimate;
    expect(estimate.recipients).toBe(2);
  });

  it('closes a category for good', async () => {
    const event = await seedOpenEvent(1);
    const categoryId = event.categories[0]?.id ?? '';
    await post(staff.moderator, `/events/${event.id}/categories/${categoryId}/close`).expect(200);
    const reopen = await post(staff.moderator, `/events/${event.id}/categories/${categoryId}/open`);
    expect(reopen.status).toBeGreaterThanOrEqual(400);
    const live = (await get(staff.moderator, `/events/${event.id}/live`).expect(200)).body as Live;
    expect(live.categories.find((c) => c.id === categoryId)?.status).toBe('closed');
    // Voting in it is refused from now on.
    const voterId = event.voterIds[0] ?? '';
    await cast(
      event.id,
      voterId,
      [{ categoryId, choice: 'contester', contesterIds: [event.categories[0]?.contesterIds[0]] }],
      'web',
    );
    expect(await owner.voterParticipation.count({ where: { voterId } })).toBe(0);
  });

  it('raises alerts for lockouts, SMS failures and closings in 5 minutes', async () => {
    const event = await seedOpenEvent(1);
    await owner.category.update({
      where: { id: event.categories[0]?.id },
      data: { closesAt: new Date(Date.now() + 3 * 60_000) },
    });
    for (let i = 0; i < 3; i += 1) {
      await owner.auditLog.create({
        data: {
          organizationId: orgId,
          eventId: event.id,
          actorType: 'voter',
          actorLabel: 'Voter',
          action: 'voter.locked',
          entityType: 'voters',
          entityId: event.voterIds[0],
        },
      });
    }
    const batch = await owner.smsBatch.create({
      data: {
        organizationId: orgId,
        eventId: event.id,
        type: 'code_delivery',
        channel: 'sms',
        audience: 'all',
        status: 'paused',
        totalCount: 10,
        sentCount: 6,
        failedCount: 4,
        pausedReason: 'failure_rate',
      },
    });
    const live = (await get(staff.moderator, `/events/${event.id}/live`).expect(200)).body as Live;
    expect(live.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'lockouts', count: 3 }),
        expect.objectContaining({ kind: 'sms_failures', count: 4 }),
        expect.objectContaining({ kind: 'closing_soon', categoryId: event.categories[0]?.id }),
      ]),
    );
    expect(live.lastBatch?.id).toBe(batch.id);
  });

  it('keeps a moderator on an Open event', async () => {
    const event = await seedOpenEvent(1);
    const res = await post(staff.admin, `/users/${staff.moderator.id}/deactivate`);
    expect(codeOf(res)).toBe('INVALID_TRANSITION');
    expect((res.body as { details?: { events?: string[] } }).details?.events).toContain(
      (await owner.votingEvent.findUniqueOrThrow({ where: { id: event.id } })).name,
    );
    // With a second moderator it is allowed.
    const second = await newStaff('moderator');
    const events = await owner.votingEvent.findMany({
      where: { organizationId: orgId, status: 'open' },
      select: { id: true },
    });
    for (const e of events) {
      await owner.eventAssignment.create({
        data: { organizationId: orgId, eventId: e.id, userId: second.id, type: 'moderator' },
      });
    }
    await post(staff.admin, `/users/${staff.moderator.id}/deactivate`).expect(200);
  });
});
