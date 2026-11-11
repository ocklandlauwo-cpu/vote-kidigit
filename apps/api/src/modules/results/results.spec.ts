// Results over HTTP (Implementation Plan step 27): close, the staff results view (nothing before
// close), tie resolution and the publication block, publish with the typed name and the results
// SMS, the public page (full or winners only, link on or off), the voter's results, reopen, and
// the scheduled close.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import type {
  EventResults,
  MeResponse,
  PublicResults,
  SystemRoleKey,
  VoterResults,
} from '@vote-kidigit/shared';
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
import { WorkerModule } from '../../worker.module.js';
import { SchedulerRunner } from '../events/scheduler.js';
import { VoteSessions } from '../vote/vote-session.js';

const PASSWORD = 'Uchaguzi2027';
const codeOf = (res: request.Response) => (res.body as { code?: string }).code;

interface Staff {
  id: string;
  agent: TestAgent;
  csrf: string;
}

describe('results', () => {
  let app: NestExpressApplication;
  let worker: TestingModule;
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  const staff = {} as Record<'admin' | 'observer', Staff>;
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

  /** An Open event; `votes` lists, per voter, the contester names chosen in the one category. */
  async function election(contesters: string[], votes: string[], change: { endAt?: Date } = {}) {
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: `Matokeo ${uniqueSuffix()}`,
        startAt: change.endAt
          ? new Date(change.endAt.getTime() - 3_600_000)
          : new Date(Date.now() - 3_600_000),
        endAt: change.endAt ?? new Date(Date.now() + 8 * 3_600_000),
        status: 'open',
      },
    });
    for (const who of [staff.admin, staff.observer]) {
      await owner.eventAssignment.create({
        data: { organizationId: orgId, eventId: event.id, userId: who.id, type: 'moderator' },
      });
    }
    order += 1;
    const category = await owner.category.create({
      data: {
        organizationId: orgId,
        eventId: event.id,
        name: `Mwenyekiti ${order}`,
        displayOrder: order,
      },
    });
    const ids: Record<string, string> = {};
    for (const fullName of contesters) {
      ids[fullName] = (
        await owner.contester.create({
          data: { organizationId: orgId, eventId: event.id, categoryId: category.id, fullName },
        })
      ).id;
    }
    const voterIds: string[] = [];
    for (const [i, choice] of votes.entries()) {
      const voter = await owner.voter.create({
        data: {
          organizationId: orgId,
          eventId: event.id,
          fullName: `Mpiga ${i}`,
          membershipId: `${uniqueSuffix()}-${i}`,
          phone: '+255712000001',
          gender: 'female',
        },
      });
      voterIds.push(voter.id);
      if (change.endAt) continue; // past end: no voting
      await api.withContext(orgContext(orgId), (tx) =>
        tx.$queryRawUnsafe(
          `SELECT app.cast_ballot($1::uuid, $2::uuid, $3::jsonb, 'web'::vote_channel)`,
          voter.id,
          event.id,
          JSON.stringify([
            { categoryId: category.id, choice: 'contester', contesterIds: [ids[choice]] },
          ]),
        ),
      );
    }
    return { eventId: event.id, name: event.name, categoryId: category.id, ids, voterIds };
  }

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Matokeo');
    await api.withContext(
      platformContext(),
      (tx) => tx.$executeRaw`SELECT app.create_default_roles(${orgId}::uuid)`,
    );
    staff.admin = await newStaff('admin');
    staff.observer = await newStaff('observer');
  });

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId]);
    await owner.$disconnect();
    await api.$disconnect();
    await worker.close();
    await app.close();
  });

  it('shows nothing before close, then resolves a tie and publishes', async () => {
    const e = await election(['Asha', 'Juma', 'Neema'], ['Asha', 'Juma', 'Neema', 'Asha', 'Juma']);
    const before = (await get(staff.admin, `/events/${e.eventId}/results`).expect(200))
      .body as EventResults;
    expect(before).toMatchObject({ state: 'not_closed', snapshot: null });

    await post(staff.observer, `/events/${e.eventId}/close`).expect(403);
    await post(staff.admin, `/events/${e.eventId}/close`).expect(200);
    const closed = (await get(staff.admin, `/events/${e.eventId}/results`).expect(200))
      .body as EventResults;
    expect(closed).toMatchObject({ state: 'closed', unresolvedTies: 1 });
    const category = closed.snapshot?.categories[0];
    expect(category?.hasTie).toBe(true);
    expect(category?.rows.map((r) => [r.name, r.votes, r.isWinner])).toEqual([
      ['Asha', 2, false],
      ['Juma', 2, false],
      ['Neema', 1, false],
    ]);

    const blocked = await post(staff.admin, `/events/${e.eventId}/results/publish`, {
      confirmName: e.name,
    });
    expect(codeOf(blocked)).toBe('UNRESOLVED_TIES');
    await post(staff.observer, `/events/${e.eventId}/results/ties`, {
      categoryId: e.categoryId,
      outcome: 'contester',
      winnerIds: [e.ids.Juma],
      reason: 'Kura ya bahati mbele ya wagombea wote',
    }).expect(403);
    const resolved = (
      await post(staff.admin, `/events/${e.eventId}/results/ties`, {
        categoryId: e.categoryId,
        outcome: 'contester',
        winnerIds: [e.ids.Juma],
        reason: 'Kura ya bahati mbele ya wagombea wote',
      }).expect(200)
    ).body as EventResults;
    expect(resolved.unresolvedTies).toBe(0);
    expect(resolved.snapshot?.categories[0]?.tie).toMatchObject({
      outcome: 'contester',
      winnerIds: [e.ids.Juma],
    });

    const wrongName = await post(staff.admin, `/events/${e.eventId}/results/publish`, {
      confirmName: 'Nope',
    });
    expect(codeOf(wrongName)).toBe('VALIDATION_FAILED');
    const published = (
      await post(staff.admin, `/events/${e.eventId}/results/publish`, {
        confirmName: e.name,
      }).expect(200)
    ).body as EventResults;
    expect(published.state).toBe('published');
    expect(published.publicUrl).toMatch(/\/results\/[A-Za-z0-9_-]{32}$/);
    expect(
      await owner.smsBatch.count({ where: { eventId: e.eventId, type: 'results_published' } }),
    ).toBe(1);

    // RES-04: full counts by default.
    const token = published.publicUrl?.split('/').at(-1) ?? '';
    const full = (await request(app.getHttpServer()).get(`/api/v1/results/${token}`).expect(200))
      .body as PublicResults;
    expect(full.turnout).toEqual({ registered: 5, voted: 5 });
    expect(full.contentHash).toBe(published.snapshot?.contentHash);
    expect(full.categories[0]?.rows.map((r) => [r.name, r.votes, r.isWinner])).toEqual([
      ['Asha', 2, false],
      ['Juma', 2, true],
      ['Neema', 1, false],
    ]);
    expect(full.categories[0]?.tieNote).toBe('Kura ya bahati mbele ya wagombea wote');

    // Winners only: no counts, no other contesters.
    await owner.votingEvent.update({
      where: { id: e.eventId },
      data: { resultsVisibility: 'winners_only' },
    });
    const winners = (await request(app.getHttpServer()).get(`/api/v1/results/${token}`).expect(200))
      .body as PublicResults;
    expect(winners.turnout).toBeNull();
    expect(winners.categories[0]?.rows).toEqual([
      expect.objectContaining({ name: 'Juma', votes: null, percent: null, isWinner: true }),
    ]);
    expect(JSON.stringify(winners)).not.toContain('Asha');

    // The link can be switched off.
    await post(staff.admin, `/events/${e.eventId}/results/public-link`, { enabled: false }).expect(
      200,
    );
    await request(app.getHttpServer()).get(`/api/v1/results/${token}`).expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/results/not-a-real-token-at-all-0000')
      .expect(404);

    // VTR-WEB-08: the voter's results with their own voting time.
    const sessions = app.get(VoteSessions);
    const ballotToken = await sessions.create({
      voterId: e.voterIds[0] ?? '',
      eventId: e.eventId,
      orgId,
      channel: 'web',
      codeCheck: '',
    });
    const voter = await owner.voter.findUniqueOrThrow({ where: { id: e.voterIds[0] } });
    expect(voter.codeHmac).toBeNull();
    const mine = (
      await request(app.getHttpServer())
        .get('/api/v1/vote/results')
        .set('Authorization', `Bearer ${ballotToken}`)
        .expect(200)
    ).body as VoterResults;
    expect(mine.votedAt).not.toBeNull();
    expect(mine.categories[0]?.rows[0]?.name).toBe('Juma');
  });

  it('reopens with a later end and a reason, then closes again as version 2', async () => {
    const e = await election(['Asha', 'Juma'], ['Asha']);
    await post(staff.admin, `/events/${e.eventId}/close`).expect(200);
    const badReason = await post(staff.admin, `/events/${e.eventId}/reopen`, {
      newEndAt: new Date(Date.now() + 3_600_000).toISOString(),
      reason: 'fupi',
    });
    expect(codeOf(badReason)).toBe('VALIDATION_FAILED');
    await post(staff.admin, `/events/${e.eventId}/reopen`, {
      newEndAt: new Date(Date.now() + 3_600_000).toISOString(),
      reason: 'Wapiga kura walichelewa kwa sababu ya mvua',
    }).expect(200);
    expect((await get(staff.admin, `/events/${e.eventId}/results`).expect(200)).body).toMatchObject(
      {
        state: 'not_closed',
      },
    );
    await post(staff.admin, `/events/${e.eventId}/close`).expect(200);
    const again = (await get(staff.admin, `/events/${e.eventId}/results`).expect(200))
      .body as EventResults;
    expect(again.snapshot?.version).toBe(2);
    expect(again.snapshot?.categories[0]?.rows.find((r) => r.name === 'Asha')?.votes).toBe(1);
  });

  it('closes an event by itself at its end time', async () => {
    // A fixed moment long ago, so no other test's event is due.
    const e = await election(['Asha', 'Juma'], ['Asha'], {
      endAt: new Date('2000-01-01T10:00:00Z'),
    });
    const runner = worker.get(SchedulerRunner);
    const result = await runner.sweep(new Date('2000-01-01T10:01:00Z'));
    expect(result.closed).toBeGreaterThanOrEqual(1);
    const event = await owner.votingEvent.findUniqueOrThrow({ where: { id: e.eventId } });
    expect(event.status).toBe('closed');
    expect(
      await owner.resultSnapshot.count({ where: { eventId: e.eventId, isCurrent: true } }),
    ).toBe(1);
  });
});
