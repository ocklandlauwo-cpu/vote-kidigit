// Integration test of categories and contesters (Implementation Plan step 18, Backend Schema 12.6):
// rule validation, ordering, eligibility modes, the locks after publish, contesters with
// withdrawal and Yes/No, manual open/close, pictures and the bulk photo ZIP.
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  type Category,
  CategoryListResponseSchema,
  type Contester,
  type EligibilityResponse,
  type MeResponse,
  type PhotoZipResult,
  type SystemRoleKey,
  UPLOAD_FIELD,
} from '@vote-kidigit/shared';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
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
import { buildZip } from '../../testing/zip.js';

const PASSWORD = 'Uchaguzi2027';
const HOUR = 3_600_000;
const codeOf = (res: request.Response) => (res.body as { code?: string }).code;
const issuesOf = (res: request.Response) =>
  ((res.body as { details?: { issues?: { path: string }[] } }).details?.issues ?? []).map(
    (i) => i.path,
  );

interface Staff {
  id: string;
  agent: TestAgent;
  csrf: string;
}

const RULES = {
  selectionMode: 'exact',
  exactCount: 1,
  minCount: null,
  maxCount: null,
  seats: 1,
  allowSkip: false,
  winnerRule: 'plurality',
  thresholdPct: null,
  quorumPct: null,
} as const;

const jpeg = (width = 600, height = 600) =>
  sharp({ create: { width, height, channels: 3, background: { r: 90, g: 60, b: 30 } } })
    .jpeg()
    .toBuffer();

describe('categories API', () => {
  let app: NestExpressApplication;
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  const staff = {} as Record<'admin' | 'moderator' | 'observer', Staff>;

  const send = (
    who: Staff,
    method: 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: object,
  ) => who.agent[method](`/api/v1${path}`).set('X-CSRF-Token', who.csrf).send(body);
  const get = (who: Staff, path: string) => who.agent.get(`/api/v1${path}`);

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

  /** A Draft event (24 h from now, 24 h long) assigned to the moderator and observer. */
  async function seedEvent(): Promise<string> {
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: `AGM ${uniqueSuffix()}`,
        startAt: new Date(Date.now() + 24 * HOUR),
        endAt: new Date(Date.now() + 48 * HOUR),
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
    return event.id;
  }

  const setStatus = (eventId: string, status: EventStatus) =>
    owner.votingEvent.update({ where: { id: eventId }, data: { status } });

  async function addCategory(eventId: string, name = 'Mwenyekiti'): Promise<Category> {
    return (
      await send(staff.moderator, 'post', `/events/${eventId}/categories`, { name }).expect(201)
    ).body as Category;
  }

  async function addContester(eventId: string, categoryId: string, fullName: string) {
    return (
      await send(
        staff.moderator,
        'post',
        `/events/${eventId}/categories/${categoryId}/contesters`,
        { fullName },
      ).expect(201)
    ).body as Contester;
  }

  async function seedVoters(eventId: string, n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const voter = await owner.voter.create({
        data: {
          organizationId: orgId,
          eventId,
          fullName: `Mpiga kura ${i}`,
          membershipId: `M-${uniqueSuffix()}`,
          phone: `+2557120000${String(i).padStart(2, '0')}`,
          gender: i % 2 ? 'male' : 'female',
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
    orgId = await createOrganization(owner, 'Chama cha Nafasi');
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

  describe('categories', () => {
    it('creates categories in order with the default rules; observers only read', async () => {
      const eventId = await seedEvent();
      const first = await addCategory(eventId, 'Mwenyekiti');
      const second = await addCategory(eventId, 'Katibu');
      expect(first).toMatchObject({
        displayOrder: 0,
        status: 'not_open',
        rules: RULES,
        yesNo: false,
      });
      expect(second.displayOrder).toBe(1);
      const list = CategoryListResponseSchema.parse(
        (await get(staff.observer, `/events/${eventId}/categories`).expect(200)).body,
      );
      expect(list.items.map((c) => c.name)).toEqual(['Mwenyekiti', 'Katibu']);
      await send(staff.observer, 'post', `/events/${eventId}/categories`, { name: 'X' }).expect(
        403,
      );
      expect(await owner.auditLog.count({ where: { eventId, action: 'category.create' } })).toBe(2);
    });

    it('validates the rules: exact, range, threshold and quorum', async () => {
      const eventId = await seedEvent();
      const { id } = await addCategory(eventId);
      const patch = (rules: object) =>
        send(staff.moderator, 'patch', `/events/${eventId}/categories/${id}`, {
          rules: { ...RULES, ...rules },
        });

      expect(issuesOf(await patch({ exactCount: null }).expect(400))).toEqual(['rules.exactCount']);
      expect(issuesOf(await patch({ exactCount: 0 }).expect(400))).toEqual(['rules.exactCount']);
      expect(
        issuesOf(await patch({ selectionMode: 'range', minCount: 3, maxCount: 2 }).expect(400)),
      ).toEqual(['rules.maxCount']);
      expect(
        issuesOf(await patch({ selectionMode: 'range', minCount: null, maxCount: 2 }).expect(400)),
      ).toEqual(['rules.minCount']);
      expect(issuesOf(await patch({ winnerRule: 'threshold' }).expect(400))).toEqual([
        'rules.thresholdPct',
      ]);
      expect(
        issuesOf(await patch({ winnerRule: 'threshold', thresholdPct: 120 }).expect(400)),
      ).toEqual(['rules.thresholdPct']);
      expect(issuesOf(await patch({ quorumPct: 0 }).expect(400))).toEqual(['rules.quorumPct']);
      expect(issuesOf(await patch({ seats: 0 }).expect(400))).toEqual(['rules.seats']);

      const range = (
        await patch({
          selectionMode: 'range',
          exactCount: 4,
          minCount: 1,
          maxCount: 3,
          seats: 3,
          allowSkip: true,
          winnerRule: 'threshold',
          thresholdPct: 50.01,
          quorumPct: 60,
        }).expect(200)
      ).body as Category;
      // The count of the other mode is cleared, so the stored rules stay unambiguous.
      expect(range.rules).toEqual({
        selectionMode: 'range',
        exactCount: null,
        minCount: 1,
        maxCount: 3,
        seats: 3,
        allowSkip: true,
        winnerRule: 'threshold',
        thresholdPct: 50.01,
        quorumPct: 60,
      });
      const plurality = (await patch({ thresholdPct: 50 }).expect(200)).body as Category;
      expect(plurality.rules).toMatchObject({ winnerRule: 'plurality', thresholdPct: null });
    });

    it('keeps the voting window inside the event window', async () => {
      const eventId = await seedEvent();
      const { id } = await addCategory(eventId);
      const at = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();
      const outside = await send(staff.moderator, 'patch', `/events/${eventId}/categories/${id}`, {
        opensAt: at(12),
      });
      expect([outside.status, codeOf(outside)]).toEqual([422, 'CATEGORY_WINDOW_INVALID']);
      const backwards = await send(
        staff.moderator,
        'patch',
        `/events/${eventId}/categories/${id}`,
        { opensAt: at(30), closesAt: at(28) },
      ).expect(400);
      expect(issuesOf(backwards)).toEqual(['closesAt']);
      const ok = (
        await send(staff.moderator, 'patch', `/events/${eventId}/categories/${id}`, {
          opensAt: at(26),
          closesAt: at(30),
        }).expect(200)
      ).body as Category;
      expect(ok.opensAt).not.toBeNull();
    });

    it('reorders with every category exactly once', async () => {
      const eventId = await seedEvent();
      const [a, b, c] = [
        await addCategory(eventId, 'A'),
        await addCategory(eventId, 'B'),
        await addCategory(eventId, 'C'),
      ];
      const res = await send(staff.moderator, 'put', `/events/${eventId}/categories/order`, {
        categoryIds: [c.id, a.id, b.id],
      }).expect(200);
      const items = CategoryListResponseSchema.parse(res.body).items;
      expect(items.map((x) => [x.name, x.displayOrder])).toEqual([
        ['C', 0],
        ['A', 1],
        ['B', 2],
      ]);
      for (const categoryIds of [
        [a.id, b.id],
        [a.id, b.id, randomUUID()],
        [a.id, a.id, b.id],
      ]) {
        await send(staff.moderator, 'put', `/events/${eventId}/categories/order`, {
          categoryIds,
        }).expect(400);
      }
      const otherEvent = await seedEvent();
      const foreign = await addCategory(otherEvent);
      await send(staff.moderator, 'put', `/events/${eventId}/categories/order`, {
        categoryIds: [c.id, a.id, foreign.id],
      }).expect(400);
    });

    it('switches eligibility between all voters and selected voters', async () => {
      const eventId = await seedEvent();
      const voters = await seedVoters(eventId, 3);
      const { id } = await addCategory(eventId);
      const path = `/events/${eventId}/categories/${id}/eligibility`;
      const list = async () =>
        CategoryListResponseSchema.parse(
          (await get(staff.moderator, `/events/${eventId}/categories`)).body,
        ).items[0];
      expect((await list())?.eligibleVoters).toBe(3);

      const selected = (
        await send(staff.moderator, 'put', path, {
          mode: 'selected',
          voterIds: [voters[0], voters[1]],
        }).expect(200)
      ).body as EligibilityResponse;
      expect(selected.mode).toBe('selected');
      expect(selected.voterIds.sort()).toEqual([voters[0], voters[1]].sort());
      expect((await list())?.eligibleVoters).toBe(2);

      const changed = (
        await send(staff.moderator, 'patch', path, {
          add: [voters[2]],
          remove: [voters[0]],
        }).expect(200)
      ).body as EligibilityResponse;
      expect(changed.voterIds.sort()).toEqual([voters[1], voters[2]].sort());

      const otherEvent = await seedEvent();
      const [stranger] = await seedVoters(otherEvent, 1);
      expect(
        issuesOf(await send(staff.moderator, 'patch', path, { add: [stranger] }).expect(400)),
      ).toEqual(['add.0']);
      await send(staff.moderator, 'put', path, { mode: 'all', voterIds: [] }).expect(400);
      await send(staff.moderator, 'put', path, { mode: 'selected' }).expect(400);

      const all = (await send(staff.moderator, 'put', path, { mode: 'all' }).expect(200))
        .body as EligibilityResponse;
      expect(all).toEqual({ mode: 'all', voterIds: [] });
      expect((await list())?.eligibleVoters).toBe(3);
      const audit = await owner.auditLog.findFirstOrThrow({
        where: { eventId, action: 'category.eligibility.update' },
        orderBy: { createdAt: 'desc' },
      });
      // Counts, not voter ids.
      expect(audit.after).toEqual({ eligibility: 'all', selectedVoters: 0 });
    });

    it('locks the setup after publish', async () => {
      const eventId = await seedEvent();
      const category = await addCategory(eventId);
      const second = await addCategory(eventId, 'Katibu');
      const contester = await addContester(eventId, category.id, 'Asha Mollel');
      await setStatus(eventId, 'scheduled');
      const locked = async (res: request.Test) => {
        const r = await res;
        expect([r.status, codeOf(r)]).toEqual([409, 'EVENT_LOCKED']);
      };
      await locked(
        send(staff.moderator, 'post', `/events/${eventId}/categories`, { name: 'Mpya' }),
      );
      await locked(
        send(staff.moderator, 'patch', `/events/${eventId}/categories/${category.id}`, {
          name: 'Jina jipya',
        }),
      );
      await locked(send(staff.moderator, 'delete', `/events/${eventId}/categories/${category.id}`));
      await locked(
        send(staff.moderator, 'put', `/events/${eventId}/categories/order`, {
          categoryIds: [second.id, category.id],
        }),
      );
      await locked(
        send(staff.moderator, 'put', `/events/${eventId}/categories/${category.id}/eligibility`, {
          mode: 'selected',
          voterIds: [],
        }),
      );
      await locked(
        send(staff.moderator, 'post', `/events/${eventId}/categories/${category.id}/contesters`, {
          fullName: 'Mpya',
        }),
      );
      await locked(
        send(staff.moderator, 'patch', `/events/${eventId}/contesters/${contester.id}`, {
          party: 'CCK',
        }),
      );
      await locked(
        send(staff.moderator, 'delete', `/events/${eventId}/contesters/${contester.id}`),
      );
      await locked(
        staff.moderator.agent
          .post(`/api/v1/events/${eventId}/contesters/${contester.id}/photo`)
          .set('X-CSRF-Token', staff.moderator.csrf)
          .attach(UPLOAD_FIELD, await jpeg(), 'asha.jpg'),
      );
      // Withdrawal stays possible until voting starts.
      await send(
        staff.moderator,
        'post',
        `/events/${eventId}/contesters/${contester.id}/withdraw`,
      ).expect(200);
      expect(
        await owner.file.count({ where: { organizationId: orgId, kind: 'contester_photo' } }),
      ).toBe(0);
    });

    it('deletes a Draft category with its contesters', async () => {
      const eventId = await seedEvent();
      const category = await addCategory(eventId);
      await addContester(eventId, category.id, 'Juma');
      await send(staff.moderator, 'delete', `/events/${eventId}/categories/${category.id}`).expect(
        204,
      );
      expect(await owner.contester.count({ where: { categoryId: category.id } })).toBe(0);
      await send(staff.moderator, 'delete', `/events/${eventId}/categories/${category.id}`).expect(
        404,
      );
    });
  });

  describe('contesters', () => {
    it('adds, edits, withdraws and removes; one active contester is a Yes / No vote', async () => {
      const eventId = await seedEvent();
      const category = await addCategory(eventId);
      const asha = await addContester(eventId, category.id, 'Asha Mollel');
      const listed = async () =>
        CategoryListResponseSchema.parse(
          (await get(staff.moderator, `/events/${eventId}/categories`)).body,
        ).items[0];
      expect((await listed())?.yesNo).toBe(true);
      const juma = await addContester(eventId, category.id, 'Juma Ali');
      expect((await listed())?.yesNo).toBe(false);

      const edited = (
        await send(staff.moderator, 'patch', `/events/${eventId}/contesters/${juma.id}`, {
          party: '  Chama A  ',
        }).expect(200)
      ).body as Contester;
      expect(edited.party).toBe('Chama A');

      const withdrawn = (
        await send(
          staff.moderator,
          'post',
          `/events/${eventId}/contesters/${juma.id}/withdraw`,
        ).expect(200)
      ).body as Contester;
      expect(withdrawn).toMatchObject({ status: 'withdrawn' });
      expect(withdrawn.withdrawnAt).not.toBeNull();
      expect((await listed())?.yesNo).toBe(true);
      const again = await send(
        staff.moderator,
        'post',
        `/events/${eventId}/contesters/${juma.id}/withdraw`,
      );
      expect(codeOf(again)).toBe('INVALID_TRANSITION');

      await send(staff.moderator, 'delete', `/events/${eventId}/contesters/${asha.id}`).expect(204);
      const otherEvent = await seedEvent();
      await send(staff.moderator, 'patch', `/events/${otherEvent}/contesters/${juma.id}`, {
        party: 'X',
      }).expect(404);
      await send(staff.observer, 'patch', `/events/${eventId}/contesters/${juma.id}`, {
        party: 'X',
      }).expect(403);
    });

    it('refuses withdrawal once voting has started', async () => {
      const eventId = await seedEvent();
      const category = await addCategory(eventId);
      const contester = await addContester(eventId, category.id, 'Neema');
      await setStatus(eventId, 'open');
      const res = await send(
        staff.moderator,
        'post',
        `/events/${eventId}/contesters/${contester.id}/withdraw`,
      );
      expect(codeOf(res)).toBe('EVENT_LOCKED');
    });

    it('stores a contester photo at 350 × 490 and a category picture', async () => {
      const eventId = await seedEvent();
      const category = await addCategory(eventId);
      const contester = await addContester(eventId, category.id, 'Asha');
      const uploaded = (
        await staff.moderator.agent
          .post(`/api/v1/events/${eventId}/contesters/${contester.id}/photo`)
          .set('X-CSRF-Token', staff.moderator.csrf)
          .attach(UPLOAD_FIELD, await jpeg(1000, 800), 'asha.jpg')
          .expect(200)
      ).body as Contester;
      const served = await staff.observer.agent
        .get(uploaded.photoUrl ?? '')
        .buffer(true)
        .expect(200);
      const meta = await sharp(served.body as Buffer).metadata();
      expect([meta.width, meta.height]).toEqual([350, 490]);

      const pictured = (
        await staff.moderator.agent
          .post(`/api/v1/events/${eventId}/categories/${category.id}/picture`)
          .set('X-CSRF-Token', staff.moderator.csrf)
          .attach(UPLOAD_FIELD, await jpeg(), 'nafasi.jpg')
          .expect(200)
      ).body as Category;
      expect(pictured.pictureUrl).toMatch(/^\/api\/v1\/files\//);

      const removed = (
        await send(
          staff.moderator,
          'delete',
          `/events/${eventId}/contesters/${contester.id}/photo`,
        ).expect(200)
      ).body as Contester;
      expect(removed.photoUrl).toBeNull();
      await staff.observer.agent.get(uploaded.photoUrl ?? '').expect(404);
    });

    it('matches a ZIP of photos to contesters by file name', async () => {
      const eventId = await seedEvent();
      const chair = await addCategory(eventId, 'Mwenyekiti');
      const secretary = await addCategory(eventId, 'Katibu');
      const asha = await addContester(eventId, chair.id, 'Asha Mollel');
      const juma = await addContester(eventId, secretary.id, 'Juma Ali');
      await addContester(eventId, chair.id, 'Neema Joseph');
      await addContester(eventId, secretary.id, 'Neema Joseph');
      const zip = buildZip([
        { name: 'picha/ASHA_MOLLEL.JPG', data: await jpeg() },
        { name: 'Juma Ali.jpeg', data: await jpeg() },
        { name: 'Neema Joseph.jpg', data: await jpeg() },
        { name: 'Baraka.jpg', data: await jpeg() },
        { name: 'orodha.txt', data: Buffer.from('jina') },
      ]);
      const upload = (who: Staff) =>
        who.agent
          .post(`/api/v1/events/${eventId}/photos/zip`)
          .set('X-CSRF-Token', who.csrf)
          .field('target', 'contesters')
          .attach(UPLOAD_FIELD, zip, 'picha.zip');

      await upload(staff.observer).expect(403);
      const result = (await upload(staff.moderator).expect(200)).body as PhotoZipResult;
      expect(result.matched.map((m) => [m.fileName, m.id]).sort()).toEqual(
        [
          ['ASHA_MOLLEL.JPG', asha.id],
          ['Juma Ali.jpeg', juma.id],
        ].sort(),
      );
      expect(result.unmatched).toEqual(
        expect.arrayContaining([
          { fileName: 'Neema Joseph.jpg', problem: 'ambiguous' },
          { fileName: 'Baraka.jpg', problem: 'no_match' },
          { fileName: 'orodha.txt', problem: 'not_image' },
        ]),
      );
      const stored = await owner.contester.findUniqueOrThrow({ where: { id: asha.id } });
      expect(stored.photoFileId).not.toBeNull();

      const notZip = await staff.moderator.agent
        .post(`/api/v1/events/${eventId}/photos/zip`)
        .set('X-CSRF-Token', staff.moderator.csrf)
        .field('target', 'contesters')
        .attach(UPLOAD_FIELD, await jpeg(), 'picha.zip');
      expect(codeOf(notZip)).toBe('FILE_TYPE');
      await staff.moderator.agent
        .post(`/api/v1/events/${eventId}/photos/zip`)
        .set('X-CSRF-Token', staff.moderator.csrf)
        .field('target', 'members')
        .attach(UPLOAD_FIELD, zip, 'picha.zip')
        .expect(400);
    });
  });

  describe('manual open and close', () => {
    it('opens and closes a category of an Open event; a closed category stays closed', async () => {
      const eventId = await seedEvent();
      const category = await addCategory(eventId);
      await addContester(eventId, category.id, 'Asha');
      const path = (action: string) => `/events/${eventId}/categories/${category.id}/${action}`;
      const notOpen = await send(staff.moderator, 'post', path('open'));
      expect(codeOf(notOpen)).toBe('INVALID_TRANSITION');

      // Open now: the event window starts in the past for the votable check.
      await owner.votingEvent.update({
        where: { id: eventId },
        data: { startAt: new Date(Date.now() - HOUR), status: 'open' },
      });
      // Auto, no window: votable as soon as the event is open.
      const listed = CategoryListResponseSchema.parse(
        (await get(staff.observer, `/events/${eventId}/categories`)).body,
      ).items[0];
      expect(listed?.status).toBe('open');

      const closed = (await send(staff.moderator, 'post', path('close')).expect(200))
        .body as Category;
      expect(closed).toMatchObject({ status: 'closed', manualState: 'closed' });
      expect(closed.closedAt).not.toBeNull();
      expect(codeOf(await send(staff.moderator, 'post', path('open')))).toBe('INVALID_TRANSITION');
      await send(staff.observer, 'post', path('close')).expect(403);
      expect(await owner.auditLog.count({ where: { eventId, action: 'category.close' } })).toBe(1);
    });
  });
});
