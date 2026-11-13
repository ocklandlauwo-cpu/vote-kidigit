// Dashboards and global search over HTTP (Implementation Plan step 29): each role gets the right
// cards in the right scope (platform, organization, mapped events), turnout matches participation,
// open ties are listed until resolved, and search finds only what the user may see.
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  AuditEntry,
  DashboardEvents,
  DashboardEventStaff,
  DashboardMyEvents,
  DashboardOrganizations,
  DashboardTies,
  DashboardTurnout,
  MeResponse,
  SearchResults,
  SystemRoleKey,
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

const PASSWORD = 'Uchaguzi2027';
const HOUR = 3_600_000;

interface Staff {
  id: string;
  agent: TestAgent;
}

describe('dashboard and search', () => {
  let app: NestExpressApplication;
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  let otherOrgId: string;
  const staff = {} as Record<'admin' | 'moderator' | 'observer' | 'platform' | 'other', Staff>;
  const ev = {} as Record<
    'draft' | 'scheduled' | 'open' | 'closed' | 'unmapped' | 'inactive' | 'other',
    { id: string; name: string }
  >;
  let tieCategoryId: string;
  let tag: string;

  const get = (who: Staff, path: string) => who.agent.get(`/api/v1${path}`);

  async function signIn(id: string, email: string): Promise<Staff> {
    const agent = request.agent(app.getHttpServer()).set('X-Forwarded-For', testIp());
    const res = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect((res.body as MeResponse).id).toBe(id);
    return { id, agent };
  }

  async function newStaff(org: string, role: SystemRoleKey, name: string): Promise<Staff> {
    const email = `${role}-${uniqueSuffix()}@example.test`;
    const id = await createUser(owner, org, { email, password: PASSWORD });
    await owner.user.update({ where: { id }, data: { fullName: name } });
    const roleRow = await owner.role.findFirstOrThrow({
      where: { organizationId: org, systemKey: role },
    });
    await owner.userRole.create({ data: { userId: id, roleId: roleRow.id, organizationId: org } });
    return signIn(id, email);
  }

  async function event(
    org: string,
    name: string,
    status: 'draft' | 'scheduled' | 'open' | 'closed',
    change: { isActive?: boolean; startAt?: Date } = {},
  ) {
    const startAt = change.startAt ?? new Date(Date.now() - HOUR);
    const row = await owner.votingEvent.create({
      data: {
        organizationId: org,
        name: `${name} ${tag}`,
        startAt,
        endAt: new Date(startAt.getTime() + 8 * HOUR),
        status,
        isActive: change.isActive ?? true,
      },
    });
    return { id: row.id, name: row.name };
  }

  async function assign(eventId: string, who: Staff, type: 'moderator' | 'observer', org = orgId) {
    await owner.eventAssignment.create({
      data: { organizationId: org, eventId, userId: who.id, type },
    });
  }

  async function voters(org: string, eventId: string, n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const voter = await owner.voter.create({
        data: {
          organizationId: org,
          eventId,
          fullName: i === 0 ? `Zuhura Kiongozi ${tag}` : `Mpiga ${i}`,
          membershipId: `D${tag}-${i}`,
          phone: '+255712000001',
          gender: 'female',
        },
      });
      ids.push(voter.id);
    }
    return ids;
  }

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
    owner = ownerClient();
    api = apiClient();
    tag = uniqueSuffix();
    orgId = await createOrganization(owner, `Chama cha Dashibodi ${tag}`);
    otherOrgId = await createOrganization(owner, `Chama Kingine ${tag}`);
    for (const org of [orgId, otherOrgId]) {
      await api.withContext(
        platformContext(),
        (tx) => tx.$executeRaw`SELECT app.create_default_roles(${org}::uuid)`,
      );
    }
    staff.admin = await newStaff(orgId, 'admin', `Asha Admin ${tag}`);
    staff.moderator = await newStaff(orgId, 'moderator', `Musa Msimamizi ${tag}`);
    staff.observer = await newStaff(orgId, 'observer', `Olivia Mtazamaji ${tag}`);
    staff.other = await newStaff(otherOrgId, 'admin', `Omari Mgeni ${tag}`);
    const platformEmail = `platform-${uniqueSuffix()}@example.test`;
    const platformId = await createUser(owner, null, { email: platformEmail, password: PASSWORD });
    staff.platform = await signIn(platformId, platformEmail);

    ev.draft = await event(orgId, 'Rasimu', 'draft');
    ev.scheduled = await event(orgId, 'Ijayo', 'scheduled', {
      startAt: new Date(Date.now() + HOUR),
    });
    ev.open = await event(orgId, 'Wazi', 'open');
    ev.closed = await event(orgId, 'Imefungwa', 'closed');
    ev.unmapped = await event(orgId, 'Siri', 'draft');
    ev.inactive = await event(orgId, 'Zimwa', 'draft', { isActive: false });
    ev.other = await event(otherOrgId, 'Kingine', 'open');
    for (const id of [ev.draft.id, ev.open.id, ev.closed.id]) {
      await assign(id, staff.moderator, 'moderator');
      await assign(id, staff.observer, 'observer');
    }

    // The Open event: 4 voters, 3 of them voted.
    const category = await owner.category.create({
      data: { organizationId: orgId, eventId: ev.open.id, name: 'Mwenyekiti', displayOrder: 1 },
    });
    const contesters: { id: string }[] = [];
    for (const fullName of ['Asha', 'Juma']) {
      contesters.push(
        await owner.contester.create({
          data: { organizationId: orgId, eventId: ev.open.id, categoryId: category.id, fullName },
        }),
      );
    }
    const openVoters = await voters(orgId, ev.open.id, 4);
    for (const voterId of openVoters.slice(0, 3)) {
      await api.withContext(orgContext(orgId), (tx) =>
        tx.$queryRawUnsafe(
          `SELECT app.cast_ballot($1::uuid, $2::uuid, $3::jsonb, 'web'::vote_channel)`,
          voterId,
          ev.open.id,
          JSON.stringify([
            { categoryId: category.id, choice: 'contester', contesterIds: [contesters[0]?.id] },
          ]),
        ),
      );
    }
    await voters(orgId, ev.unmapped.id, 1);
    await voters(otherOrgId, ev.other.id, 2);

    // The Closed event: a frozen snapshot with one tie still open.
    const tied = await owner.category.create({
      data: { organizationId: orgId, eventId: ev.closed.id, name: 'Katibu', displayOrder: 1 },
    });
    tieCategoryId = tied.id;
    const snapshot = await owner.resultSnapshot.create({
      data: {
        organizationId: orgId,
        eventId: ev.closed.id,
        version: 1,
        registeredVoters: 2,
        votersVoted: 2,
        contentHash: 'c'.repeat(64),
        isCurrent: true,
      },
    });
    await owner.resultCategoryStat.create({
      data: {
        organizationId: orgId,
        snapshotId: snapshot.id,
        categoryId: tied.id,
        eligibleVoters: 2,
        votersVoted: 2,
        validVotes: 2,
        skipped: 0,
        hasTie: true,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId, otherOrgId]);
    await owner.$disconnect();
    await api.$disconnect();
    await app.close();
  });

  it('counts events by status in each scope, without deactivated events', async () => {
    const admin = (await get(staff.admin, '/dashboard/events').expect(200)).body as DashboardEvents;
    expect(admin.byStatus).toEqual({
      draft: 2,
      scheduled: 1,
      open: 1,
      closed: 1,
      results_published: 0,
    });
    expect(admin.nextToOpen).toMatchObject({ eventId: ev.scheduled.id, organizationName: null });

    const moderator = (await get(staff.moderator, '/dashboard/events').expect(200))
      .body as DashboardEvents;
    expect(moderator.byStatus).toEqual({
      draft: 1,
      scheduled: 0,
      open: 1,
      closed: 1,
      results_published: 0,
    });
    expect(moderator.nextToOpen).toBeNull();
  });

  it('shows live turnout from participation, across organizations for the platform', async () => {
    const admin = (await get(staff.admin, '/dashboard/turnout').expect(200))
      .body as DashboardTurnout;
    expect(admin).toEqual([
      {
        eventId: ev.open.id,
        eventName: ev.open.name,
        organizationName: null,
        registered: 4,
        voted: 3,
      },
    ]);
    const platform = (await get(staff.platform, '/dashboard/turnout').expect(200))
      .body as DashboardTurnout;
    const ours = platform.filter((row) => [ev.open.id, ev.other.id].includes(row.eventId));
    expect(ours).toHaveLength(2);
    expect(ours.find((row) => row.eventId === ev.other.id)).toMatchObject({
      organizationName: `Chama Kingine ${tag}`,
      registered: 2,
      voted: 0,
    });
    // The other organization never sees ours.
    const other = (await get(staff.other, '/dashboard/turnout').expect(200))
      .body as DashboardTurnout;
    expect(other.map((row) => row.eventId)).toEqual([ev.other.id]);
  });

  it('lists ties until they are resolved', async () => {
    for (const who of [staff.admin, staff.moderator, staff.observer]) {
      const ties = (await get(who, '/dashboard/ties').expect(200)).body as DashboardTies;
      expect(ties).toEqual([
        {
          eventId: ev.closed.id,
          eventName: ev.closed.name,
          organizationName: null,
          categoryId: tieCategoryId,
          categoryName: 'Katibu',
        },
      ]);
    }
    const snapshot = await owner.resultSnapshot.findFirstOrThrow({
      where: { eventId: ev.closed.id },
    });
    await owner.tieResolution.create({
      data: {
        organizationId: orgId,
        snapshotId: snapshot.id,
        categoryId: tieCategoryId,
        outcome: 'no_winner',
        winnerContesterIds: [],
        reason: 'Uchaguzi utarudiwa kwa nafasi hii',
        resolvedBy: staff.admin.id,
      },
    });
    expect((await get(staff.admin, '/dashboard/ties').expect(200)).body).toEqual([]);
  });

  it('shows recent activity of the organization, or of the mapped events only', async () => {
    const at = new Date();
    for (const [eventId, action] of [
      [ev.open.id, 'event.close'],
      [ev.unmapped.id, 'event.edit'],
      [null, 'org.settings.update'],
    ] as const) {
      await owner.auditLog.create({
        data: {
          organizationId: orgId,
          actorType: 'user',
          actorLabel: 'Asha',
          eventId,
          action,
          entityType: 'voting_events',
          createdAt: at,
        },
      });
    }
    const admin = (await get(staff.admin, '/dashboard/activity').expect(200)).body as AuditEntry[];
    expect(admin.map((e) => e.action)).toEqual(
      expect.arrayContaining(['event.close', 'event.edit', 'org.settings.update']),
    );
    const moderator = (await get(staff.moderator, '/dashboard/activity').expect(200))
      .body as AuditEntry[];
    expect(moderator.map((e) => e.action)).toEqual(['event.close']);
    const other = (await get(staff.other, '/dashboard/activity').expect(200)).body as AuditEntry[];
    expect(other.every((e) => e.organizationId === otherOrgId)).toBe(true);
  });

  it('gives event staff to the organization dashboard and my events to the others', async () => {
    const rows = (await get(staff.admin, '/dashboard/event-staff').expect(200))
      .body as DashboardEventStaff;
    expect(rows.find((r) => r.eventId === ev.open.id)).toMatchObject({
      moderators: [`Musa Msimamizi ${tag}`],
      categories: 1,
    });
    expect(rows.some((r) => r.eventId === ev.inactive.id)).toBe(false);
    await get(staff.moderator, '/dashboard/event-staff').expect(403);

    const mine = (await get(staff.moderator, '/dashboard/my-events').expect(200))
      .body as DashboardMyEvents;
    expect(mine.map((e) => [e.eventId, e.role]).sort()).toEqual(
      [
        [ev.draft.id, 'moderator'],
        [ev.open.id, 'moderator'],
        [ev.closed.id, 'moderator'],
      ].sort(),
    );
    const observed = (await get(staff.observer, '/dashboard/my-events').expect(200))
      .body as DashboardMyEvents;
    expect(observed.every((e) => e.role === 'observer')).toBe(true);
    await get(staff.platform, '/dashboard/my-events').expect(403);
  });

  it('lists organizations with their events for the platform only', async () => {
    const rows = (await get(staff.platform, '/dashboard/organizations').expect(200))
      .body as DashboardOrganizations;
    const ours = rows.find((row) => row.id === orgId);
    expect(ours).toMatchObject({
      events: 5,
      moderators: 1,
      categories: 2,
      voters: 5,
      status: 'active',
    });
    expect(ours?.eventRows.map((r) => r.eventId)).not.toContain(ev.inactive.id);
    await get(staff.admin, '/dashboard/organizations').expect(403);
  });

  it('searches events, voters and staff within what the user may see', async () => {
    const admin = (await get(staff.admin, `/search?q=${tag}`).expect(200)).body as SearchResults;
    expect(admin.events.length).toBe(5);
    expect(admin.events.some((e) => e.id === ev.other.id || e.id === ev.inactive.id)).toBe(false);
    expect(admin.voters.map((v) => v.fullName)).toEqual(
      expect.arrayContaining([`Zuhura Kiongozi ${tag}`]),
    );
    expect(admin.staff.map((s) => s.id).sort()).toEqual(
      [staff.admin.id, staff.moderator.id, staff.observer.id].sort(),
    );
    expect(JSON.stringify(admin)).not.toContain('+2557');

    // A moderator finds mapped events and their voters only, and no staff.
    const moderator = (await get(staff.moderator, `/search?q=${tag}`).expect(200))
      .body as SearchResults;
    expect(moderator.events.map((e) => e.id).sort()).toEqual(
      [ev.draft.id, ev.open.id, ev.closed.id].sort(),
    );
    expect(moderator.voters.length).toBeGreaterThan(0);
    expect(moderator.voters.every((v) => v.eventId === ev.open.id)).toBe(true);
    expect(moderator.staff).toEqual([]);

    // By membership ID, whatever the spacing and case.
    const byId = (await get(staff.admin, `/search?q=d${tag}-0`).expect(200)).body as SearchResults;
    expect(byId.voters.map((v) => v.membershipId)).toEqual(expect.arrayContaining([`D${tag}-0`]));

    // The platform finds events of every organization, never voters or staff.
    const platform = (await get(staff.platform, `/search?q=${tag}`).expect(200))
      .body as SearchResults;
    expect(platform.events.map((e) => e.id)).toEqual(expect.arrayContaining([ev.other.id]));
    expect(platform.voters).toEqual([]);
    expect(platform.staff).toEqual([]);

    const short = await get(staff.admin, '/search?q=a');
    expect((short.body as { code?: string }).code).toBe('VALIDATION_FAILED');
  });
});
