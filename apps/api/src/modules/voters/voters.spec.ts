// Integration test of voters, codes and CSV imports (Implementation Plan step 19, Backend Schema
// 12.7): adding with a code, no plain code anywhere, filters, bulk actions, regeneration, the
// locks after publish, the import pipeline through the worker, and voter photos by ZIP.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  type BulkVotersResponse,
  type CreateImportResponse,
  type MeResponse,
  type PhotoZipResult,
  type SystemRoleKey,
  UPLOAD_FIELD,
  type VoterDetail,
  type VoterImport,
  VoterPageSchema,
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
import { WorkerModule } from '../../worker.module.js';
import { CodesService } from './codes.service.js';

const PASSWORD = 'Uchaguzi2027';
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

describe('voters API', () => {
  let app: NestExpressApplication;
  let logs: string[];
  let worker: TestingModule;
  let owner: PrismaClient;
  let api: PrismaService;
  let codes: CodesService;
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

  async function seedEvent(): Promise<string> {
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: `AGM ${uniqueSuffix()}`,
        startAt: new Date(Date.now() + 86_400_000),
        endAt: new Date(Date.now() + 2 * 86_400_000),
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

  let phoneCounter = 0;
  const nextPhone = () => `07${String(20_000_000 + (phoneCounter += 1)).slice(-8)}`;

  async function addVoter(eventId: string, change: object = {}): Promise<VoterDetail> {
    const res = await send(staff.moderator, 'post', `/events/${eventId}/voters`, {
      fullName: 'Asha Mollel',
      membershipId: `M-${uniqueSuffix()}`,
      phone: nextPhone(),
      gender: 'female',
      ...change,
    });
    expect(res.status).toBe(201);
    return res.body as VoterDetail;
  }

  function uploadCsv(eventId: string, csv: string, name = 'wapiga.csv') {
    return staff.moderator.agent
      .post(`/api/v1/events/${eventId}/imports`)
      .set('X-CSRF-Token', staff.moderator.csrf)
      .attach(UPLOAD_FIELD, Buffer.from(csv, 'utf8'), name);
  }

  async function waitFor(eventId: string, importId: string, statuses: string[]) {
    for (let i = 0; i < 100; i += 1) {
      const res = await get(staff.moderator, `/events/${eventId}/imports/${importId}`);
      const body = res.body as VoterImport;
      if (statuses.includes(body.status)) return body;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`import ${importId} did not reach ${statuses.join('/')}`);
  }

  beforeAll(async () => {
    ({ app, logs } = await createTestHttpApp());
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    codes = worker.get(CodesService);
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Wapiga Kura');
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
    await worker.close();
    await app.close();
  });

  describe('voters and codes', () => {
    it('adds a voter with a code that is stored only as fingerprint and ciphertext', async () => {
      const eventId = await seedEvent();
      logs.length = 0;
      const voter = await addVoter(eventId, { phone: '0712 999 001', email: 'Asha@Example.com' });
      expect(voter).toMatchObject({
        phone: '+255712999001',
        phoneMasked: '••••••••••001',
        email: 'asha@example.com',
        codeStatus: 'not_sent',
      });
      expect(voter.codeGeneratedAt).not.toBeNull();
      expect(JSON.stringify(voter)).not.toMatch(/code(Hmac|Ciphertext)|"code"/);

      const row = await owner.voter.findUniqueOrThrow({ where: { id: voter.id } });
      expect(row.codeHmac).toHaveLength(32);
      const code = codes.decrypt(row.codeCiphertext ?? new Uint8Array());
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
      // The code is nowhere in plain text: not in the row, the audit log or the logs.
      const plain = JSON.stringify(row, (_, v: unknown) =>
        v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v,
      );
      expect(plain).not.toContain(code);
      const audit = await owner.auditLog.findMany({ where: { eventId } });
      expect(JSON.stringify(audit)).not.toContain(code);
      expect(JSON.stringify(audit)).not.toMatch(/codeHmac|codeCiphertext/);
      expect(logs.join('\n')).not.toContain(code);
    });

    it('validates the voter and keeps membership IDs unique in the event', async () => {
      const eventId = await seedEvent();
      await addVoter(eventId, { membershipId: 'm-77' });
      const taken = await send(staff.moderator, 'post', `/events/${eventId}/voters`, {
        fullName: 'Juma',
        membershipId: ' M-77 ',
        phone: nextPhone(),
        gender: 'male',
      }).expect(400);
      expect(issuesOf(taken)).toEqual(['membershipId']);
      const bad = await send(staff.moderator, 'post', `/events/${eventId}/voters`, {
        fullName: 'Juma',
        membershipId: 'M-78',
        phone: '12345',
        gender: 'other',
      }).expect(400);
      expect(issuesOf(bad).sort()).toEqual(['gender', 'phone']);
      // Another event may use the same membership ID.
      await addVoter(await seedEvent(), { membershipId: 'M-77' });
      await send(staff.observer, 'post', `/events/${eventId}/voters`, {}).expect(403);
    });

    it('lists with search, filters, totals and masked phones', async () => {
      const eventId = await seedEvent();
      const chair = await owner.category.create({
        data: {
          organizationId: orgId,
          eventId,
          name: 'Mwenyekiti',
          displayOrder: 0,
          eligibility: 'selected',
        },
      });
      const asha = await addVoter(eventId, { fullName: 'Asha Mollel', categoryIds: [chair.id] });
      await addVoter(eventId, { fullName: 'Juma Ali', gender: 'male' });
      await addVoter(eventId, { fullName: 'Neema Joseph', membershipId: 'KK-501' });
      const page = (query: string) =>
        get(staff.observer, `/events/${eventId}/voters?${query}`).then((r) =>
          VoterPageSchema.parse(r.body),
        );
      const all = await page('');
      expect(all.totals).toEqual({ registered: 3, male: 1, female: 2 });
      expect(all.items.map((v) => v.fullName)).toEqual(['Asha Mollel', 'Juma Ali', 'Neema Joseph']);
      expect(all.items.every((v) => v.phoneMasked.startsWith('••••'))).toBe(true);
      expect(JSON.stringify(all)).not.toContain('+2557');
      expect((await page('q=juma')).items.map((v) => v.fullName)).toEqual(['Juma Ali']);
      expect((await page('q=kk-501')).items.map((v) => v.fullName)).toEqual(['Neema Joseph']);
      expect((await page('gender=male')).total).toBe(1);
      expect((await page(`categoryId=${chair.id}`)).items.map((v) => v.id)).toEqual([asha.id]);
      expect((await page('codeStatus=sent')).total).toBe(0);
    });

    it('edits and deletes in Draft, and regenerates a code that replaces the old one', async () => {
      const eventId = await seedEvent();
      const voter = await addVoter(eventId);
      const edited = (
        await send(staff.moderator, 'patch', `/events/${eventId}/voters/${voter.id}`, {
          fullName: 'Asha M. Mollel',
          phone: '0622 000 222',
        }).expect(200)
      ).body as VoterDetail;
      expect(edited).toMatchObject({ fullName: 'Asha M. Mollel', phone: '+255622000222' });

      const before = await owner.voter.findUniqueOrThrow({ where: { id: voter.id } });
      const oldCode = codes.decrypt(before.codeCiphertext ?? new Uint8Array());
      await send(
        staff.observer,
        'post',
        `/events/${eventId}/voters/${voter.id}/regenerate-code`,
      ).expect(403);
      await setStatus(eventId, 'scheduled');
      // Regeneration stays possible after publish (COD-06).
      await send(
        staff.moderator,
        'post',
        `/events/${eventId}/voters/${voter.id}/regenerate-code`,
      ).expect(200);
      const after = await owner.voter.findUniqueOrThrow({ where: { id: voter.id } });
      expect(Buffer.from(after.codeHmac ?? []).equals(Buffer.from(before.codeHmac ?? []))).toBe(
        false,
      );
      const oldPrint = Buffer.from(codes.fingerprint(oldCode));
      expect(
        await owner.voter.count({ where: { eventId, codeHmac: new Uint8Array(oldPrint) } }),
      ).toBe(0);
      expect(
        await owner.auditLog.count({ where: { eventId, action: 'voter.code.regenerate' } }),
      ).toBe(1);

      await setStatus(eventId, 'draft');
      await send(staff.moderator, 'delete', `/events/${eventId}/voters/${voter.id}`).expect(204);
      await get(staff.moderator, `/events/${eventId}/voters/${voter.id}`).expect(404);
    });

    it('assigns, removes and deletes in bulk', async () => {
      const eventId = await seedEvent();
      const selected = await owner.category.create({
        data: {
          organizationId: orgId,
          eventId,
          name: 'Katibu',
          displayOrder: 0,
          eligibility: 'selected',
        },
      });
      const everyone = await owner.category.create({
        data: { organizationId: orgId, eventId, name: 'Mjumbe', displayOrder: 1 },
      });
      const ids = [(await addVoter(eventId)).id, (await addVoter(eventId)).id];
      const bulk = (body: object) =>
        send(staff.moderator, 'post', `/events/${eventId}/voters/bulk`, body);
      expect(
        (
          (await bulk({ action: 'assign', voterIds: ids, categoryId: selected.id }).expect(200))
            .body as BulkVotersResponse
        ).affected,
      ).toBe(2);
      expect(await owner.categoryVoter.count({ where: { categoryId: selected.id } })).toBe(2);
      expect(
        issuesOf(
          await bulk({ action: 'assign', voterIds: ids, categoryId: everyone.id }).expect(400),
        ),
      ).toEqual(['categoryId']);
      await bulk({ action: 'unassign', voterIds: [ids[0]], categoryId: selected.id }).expect(200);
      expect(await owner.categoryVoter.count({ where: { categoryId: selected.id } })).toBe(1);
      expect(
        issuesOf(await bulk({ action: 'delete', voterIds: [randomUUID()] }).expect(400)),
      ).toEqual(['voterIds.0']);
      await bulk({ action: 'delete', voterIds: ids }).expect(200);
      expect(await owner.voter.count({ where: { eventId, deletedAt: null } })).toBe(0);
      expect(await owner.categoryVoter.count({ where: { categoryId: selected.id } })).toBe(0);
    });

    it('locks voters after publish', async () => {
      const eventId = await seedEvent();
      const voter = await addVoter(eventId);
      await setStatus(eventId, 'scheduled');
      const locked = async (res: request.Test) => {
        const r = await res;
        expect([r.status, codeOf(r)]).toEqual([409, 'EVENT_LOCKED']);
      };
      await locked(
        send(staff.moderator, 'post', `/events/${eventId}/voters`, {
          fullName: 'Mpya',
          membershipId: 'M-NEW',
          phone: nextPhone(),
          gender: 'male',
        }),
      );
      await locked(
        send(staff.moderator, 'patch', `/events/${eventId}/voters/${voter.id}`, { fullName: 'X' }),
      );
      await locked(send(staff.moderator, 'delete', `/events/${eventId}/voters/${voter.id}`));
      await locked(
        send(staff.moderator, 'post', `/events/${eventId}/voters/bulk`, {
          action: 'delete',
          voterIds: [voter.id],
        }),
      );
      await locked(
        uploadCsv(eventId, 'full_name,membership_id,phone,gender\nA,M-1,0712345678,F\n'),
      );
    });
  });

  describe('CSV import', () => {
    it('validates through the worker, previews, imports with codes and maps categories', async () => {
      const eventId = await seedEvent();
      await owner.category.create({
        data: {
          organizationId: orgId,
          eventId,
          name: 'Mwenyekiti',
          displayOrder: 0,
          eligibility: 'selected',
        },
      });
      await addVoter(eventId, { membershipId: 'M-EXISTS', phone: '0711000000' });
      const csv = [
        'full_name,membership_id,phone,gender,email,photo_file,categories',
        'Asha Mollel,M-101,0712 100 101,Female,,,Mwenyekiti',
        'Juma Ali,M-102,0711000000,Male,,,',
        'Neema Joseph,M-EXISTS,0712100103,Female,,,',
        'Baraka,M-104,simu,Male,,,',
      ].join('\n');
      const created = (await uploadCsv(eventId, csv).expect(201)).body as CreateImportResponse;
      const validated = await waitFor(eventId, created.id, ['validated', 'failed']);
      expect(validated).toMatchObject({
        status: 'validated',
        fileName: 'wapiga.csv',
        totalRows: 4,
        validRows: 1,
        warningRows: 1,
        errorRows: 2,
      });
      expect(validated.problems.items.map((p) => [p.row, p.code])).toEqual([
        [3, 'duplicate_phone'],
        [4, 'membership_exists'],
        [5, 'invalid_phone'],
      ]);
      const errorsOnly = (
        await get(staff.moderator, `/events/${eventId}/imports/${created.id}?severity=error`)
      ).body as VoterImport;
      expect(errorsOnly.problems.total).toBe(2);

      const file = await get(
        staff.moderator,
        `/events/${eventId}/imports/${created.id}/errors.csv`,
      ).expect(200);
      expect(file.headers['content-type']).toContain('text/csv');
      expect(file.text).toContain('Baraka,M-104,simu');
      expect(file.text).not.toContain('Asha Mollel');

      await send(
        staff.moderator,
        'post',
        `/events/${eventId}/imports/${created.id}/confirm`,
      ).expect(200);
      const done = await waitFor(eventId, created.id, ['completed', 'failed']);
      expect(done).toMatchObject({ status: 'completed', importedRows: 2 });
      const imported = await owner.voter.findMany({
        where: { eventId, membershipId: { in: ['M-101', 'M-102'] } },
        include: { categories: true },
        orderBy: { membershipId: 'asc' },
      });
      expect(
        imported.map((v) => [v.phone, v.codeStatus, v.codeHmac?.length, v.categories.length]),
      ).toEqual([
        ['+255712100101', 'not_sent', 32, 1],
        ['+255711000000', 'not_sent', 32, 0],
      ]);
      const again = await send(
        staff.moderator,
        'post',
        `/events/${eventId}/imports/${created.id}/confirm`,
      );
      expect(codeOf(again)).toBe('INVALID_TRANSITION');
      expect(
        await owner.auditLog.count({ where: { eventId, action: 'voter.import.complete' } }),
      ).toBe(1);
    });

    it('refuses files that are not CSV and reports missing columns', async () => {
      const eventId = await seedEvent();
      const xlsx = await uploadCsv(eventId, 'PK\u0003\u0004\u0000\u0000binary', 'wapiga.xlsx');
      expect([xlsx.status, codeOf(xlsx)]).toEqual([415, 'FILE_TYPE']);
      const created = (await uploadCsv(eventId, 'name,phone\nAsha,0712345678\n').expect(201))
        .body as CreateImportResponse;
      const failed = await waitFor(eventId, created.id, ['validated', 'failed']);
      expect(failed).toMatchObject({
        status: 'failed',
        failureReason: 'missing_columns',
        missingColumns: ['full_name', 'membership_id', 'gender'],
      });
      await send(
        staff.moderator,
        'post',
        `/events/${eventId}/imports/${created.id}/confirm`,
      ).expect(409);
      await get(staff.observer, `/events/${eventId}/imports/${created.id}`).expect(403);
    });

    it('serves the template', async () => {
      const eventId = await seedEvent();
      const res = await get(staff.observer, `/events/${eventId}/voters/template.csv`).expect(200);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.text.replace(/^\uFEFF/, '').split(/\r?\n/)[0]).toBe(
        'full_name,membership_id,phone,gender,email,photo_file,categories',
      );
    });
  });

  describe('voter photos by ZIP', () => {
    it('matches photos to voters by membership ID', async () => {
      const eventId = await seedEvent();
      const voter = await addVoter(eventId, { membershipId: 'M-1029' });
      const photo = await sharp({
        create: { width: 400, height: 400, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .jpeg()
        .toBuffer();
      const zip = buildZip([
        { name: 'picha/m-1029.JPG', data: photo },
        { name: 'M-9999.jpg', data: photo },
      ]);
      const upload = (who: Staff) =>
        who.agent
          .post(`/api/v1/events/${eventId}/photos/zip`)
          .set('X-CSRF-Token', who.csrf)
          .field('target', 'voters')
          .attach(UPLOAD_FIELD, zip, 'picha.zip');
      await upload(staff.observer).expect(403);
      const result = (await upload(staff.moderator).expect(200)).body as PhotoZipResult;
      expect(result.matched).toEqual([
        { fileName: 'm-1029.JPG', id: voter.id, name: 'Asha Mollel' },
      ]);
      expect(result.unmatched).toEqual([{ fileName: 'M-9999.jpg', problem: 'no_match' }]);
      const detail = (await get(staff.moderator, `/events/${eventId}/voters/${voter.id}`))
        .body as VoterDetail;
      expect(detail.photoUrl).toMatch(/^\/api\/v1\/files\//);
    });
  });
});
