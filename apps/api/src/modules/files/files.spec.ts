// Integration test of uploads and file serving (Implementation Plan step 17): the logo upload of
// SYS-03, type and size checks, the stored format, the permission per file kind, and that no
// organization reads another organization's files.
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  type MeResponse,
  type OrganizationSettings,
  type SystemRoleKey,
  UPLOAD_FIELD,
} from '@vote-kidigit/shared';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { FileKind } from '../../generated/prisma/enums.js';
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
const storageDir = () => process.env.STORAGE_DIR ?? '';
const codeOf = (res: request.Response) => (res.body as { code?: string }).code;

interface Staff {
  id: string;
  agent: TestAgent;
  csrf: string;
}

function picture(width: number, height: number, format: 'png' | 'jpeg') {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 90, b: 160 } },
  });
  return (format === 'png' ? base.png() : base.jpeg()).toBuffer();
}

describe('files API', () => {
  let app: NestExpressApplication;
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  let otherOrgId: string;
  const staff = {} as Record<'superAdmin' | 'moderator' | 'observer' | 'stranger', Staff>;

  async function newStaff(role: SystemRoleKey, org: string): Promise<Staff> {
    const email = `${role}-${uniqueSuffix()}@example.test`;
    const id = await createUser(owner, org, {
      email,
      password: PASSWORD,
      isOrgSuperAdmin: role === 'org_super_admin',
    });
    const roleRow = await owner.role.findFirstOrThrow({
      where: { organizationId: org, systemKey: role },
    });
    await owner.userRole.create({ data: { userId: id, roleId: roleRow.id, organizationId: org } });
    const agent = request.agent(app.getHttpServer()).set('X-Forwarded-For', testIp());
    const res = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    return { id, agent, csrf: (res.body as MeResponse).csrfToken };
  }

  const upload = (who: Staff, data: Buffer, filename = 'logo.png') =>
    who.agent
      .post('/api/v1/organization/logo')
      .set('X-CSRF-Token', who.csrf)
      .attach(UPLOAD_FIELD, data, filename);

  /** A stored file seeded as the owner (photos have no upload endpoint before step 18). */
  async function seedFile(org: string, kind: FileKind): Promise<string> {
    const storagePath = `org/${org}/${kind}/${randomUUID()}.jpg`;
    const absolute = path.join(storageDir(), storagePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, await picture(350, 490, 'jpeg'));
    const file = await owner.file.create({
      data: {
        organizationId: org,
        kind,
        storagePath,
        mimeType: 'image/jpeg',
        sizeBytes: 1,
        sha256: '0'.repeat(64),
      },
    });
    return file.id;
  }

  async function seedEvent(): Promise<{ eventId: string; categoryId: string }> {
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: `AGM ${uniqueSuffix()}`,
        startAt: new Date(Date.now() + 86_400_000),
        endAt: new Date(Date.now() + 2 * 86_400_000),
      },
    });
    const category = await owner.category.create({
      data: { organizationId: orgId, eventId: event.id, name: 'Mwenyekiti', displayOrder: 1 },
    });
    return { eventId: event.id, categoryId: category.id };
  }

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Picha');
    otherOrgId = await createOrganization(owner, 'Shirika Jingine');
    for (const id of [orgId, otherOrgId]) {
      await api.withContext(
        platformContext(),
        (tx) => tx.$executeRaw`SELECT app.create_default_roles(${id}::uuid)`,
      );
    }
    staff.superAdmin = await newStaff('org_super_admin', orgId);
    staff.moderator = await newStaff('moderator', orgId);
    staff.observer = await newStaff('observer', orgId);
    staff.stranger = await newStaff('org_super_admin', otherOrgId);
  });

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId, otherOrgId]);
    await owner.$disconnect();
    await api.$disconnect();
    await app.close();
  });

  describe('organization logo (SYS-03)', () => {
    it('stores the logo, serves it to the organization and replaces it', async () => {
      const res = await upload(staff.superAdmin, await picture(1600, 400, 'png')).expect(201);
      const first = res.body as OrganizationSettings;
      expect(first.logoUrl).toMatch(/^\/api\/v1\/files\/[0-9a-f-]{36}$/);

      const served = await staff.moderator.agent
        .get(first.logoUrl ?? '')
        .buffer(true)
        .expect(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['cache-control']).toBe('private, max-age=86400, immutable');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      const meta = await sharp(served.body as Buffer).metadata();
      expect([meta.width, meta.height]).toEqual([512, 128]);

      const firstId = first.logoUrl?.split('/').at(-1) ?? '';
      const firstRow = await owner.file.findUniqueOrThrow({ where: { id: firstId } });
      expect(firstRow).toMatchObject({ kind: 'org_logo', organizationId: orgId, width: 512 });
      expect(firstRow.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(existsSync(path.join(storageDir(), firstRow.storagePath))).toBe(true);

      const second = (
        await upload(staff.superAdmin, await picture(300, 300, 'jpeg'), 'nembo.jpg').expect(201)
      ).body as OrganizationSettings;
      expect(second.logoUrl).not.toBe(first.logoUrl);
      expect(await owner.file.count({ where: { id: firstId } })).toBe(0);
      expect(existsSync(path.join(storageDir(), firstRow.storagePath))).toBe(false);
      await staff.moderator.agent.get(first.logoUrl ?? '').expect(404);
      expect(
        await owner.auditLog.count({
          where: { organizationId: orgId, action: 'org.logo.update' },
        }),
      ).toBe(2);

      const removed = (
        await staff.superAdmin.agent
          .delete('/api/v1/organization/logo')
          .set('X-CSRF-Token', staff.superAdmin.csrf)
          .expect(200)
      ).body as OrganizationSettings;
      expect(removed.logoUrl).toBeNull();
      await staff.moderator.agent.get(second.logoUrl ?? '').expect(404);
    });

    it('refuses wrong types, files over 2 MB and a missing file, storing nothing', async () => {
      const before = await owner.file.count({ where: { organizationId: orgId } });
      const csv = await upload(staff.superAdmin, Buffer.from('name,phone\nJuma,0712'), 'logo.png');
      expect([csv.status, codeOf(csv)]).toEqual([415, 'FILE_TYPE']);
      const gif = await upload(staff.superAdmin, Buffer.from('GIF89a\x01\x00\x01\x00'), 'a.gif');
      expect([gif.status, codeOf(gif)]).toEqual([415, 'FILE_TYPE']);

      const big = Buffer.concat([await picture(64, 64, 'png'), Buffer.alloc(2 * 1024 * 1024)]);
      const tooLarge = await upload(staff.superAdmin, big);
      expect([tooLarge.status, codeOf(tooLarge)]).toEqual([413, 'FILE_TOO_LARGE']);

      const none = await staff.superAdmin.agent
        .post('/api/v1/organization/logo')
        .set('X-CSRF-Token', staff.superAdmin.csrf)
        .field('note', 'no file');
      expect([none.status, codeOf(none)]).toEqual([400, 'VALIDATION_FAILED']);
      expect(await owner.file.count({ where: { organizationId: orgId } })).toBe(before);
    });

    it('needs org.settings.manage', async () => {
      const res = await upload(staff.moderator, await picture(100, 100, 'png'));
      expect(res.status).toBe(403);
    });
  });

  describe('serving', () => {
    it("never serves another organization's file", async () => {
      const res = await upload(staff.superAdmin, await picture(200, 200, 'png')).expect(201);
      const url = (res.body as OrganizationSettings).logoUrl ?? '';
      await staff.stranger.agent.get(url).expect(404);
      const theirs = await seedFile(otherOrgId, 'contester_photo');
      await staff.superAdmin.agent.get(`/api/v1/files/${theirs}`).expect(404);
      await staff.superAdmin.agent.get('/api/v1/files/not-a-uuid').expect(404);
      await request(app.getHttpServer()).get(url).expect(401);
    });

    it('serves event photos to staff who may see the event', async () => {
      const { eventId, categoryId } = await seedEvent();
      const photo = await seedFile(orgId, 'contester_photo');
      await owner.contester.create({
        data: { organizationId: orgId, eventId, categoryId, fullName: 'Asha', photoFileId: photo },
      });
      const url = `/api/v1/files/${photo}`;
      await staff.superAdmin.agent.get(url).expect(200);
      await staff.moderator.agent.get(url).expect(404);
      await owner.eventAssignment.create({
        data: { organizationId: orgId, eventId, userId: staff.moderator.id, type: 'moderator' },
      });
      await staff.moderator.agent.get(url).expect(200);
      await owner.votingEvent.update({ where: { id: eventId }, data: { isActive: false } });
      await staff.moderator.agent.get(url).expect(404);
      await staff.superAdmin.agent.get(url).expect(200);

      // A photo that belongs to nothing yet: only staff who see every event.
      const loose = await seedFile(orgId, 'voter_photo');
      await staff.superAdmin.agent.get(`/api/v1/files/${loose}`).expect(200);
      await staff.observer.agent.get(`/api/v1/files/${loose}`).expect(404);
    });

    it('answers 404 when the bytes are missing', async () => {
      const file = await owner.file.create({
        data: {
          organizationId: orgId,
          kind: 'org_logo',
          storagePath: `org/${orgId}/org_logo/${randomUUID()}.png`,
          mimeType: 'image/png',
          sizeBytes: 1,
          sha256: '0'.repeat(64),
        },
      });
      await staff.moderator.agent.get(`/api/v1/files/${file.id}`).expect(404);
    });
  });

  describe('database rules (migration 013)', () => {
    it('links a record only to a file of its organization and kind', async () => {
      const { eventId, categoryId } = await seedEvent();
      const foreign = await seedFile(otherOrgId, 'contester_photo');
      const logo = await seedFile(orgId, 'org_logo');
      const photo = await seedFile(orgId, 'contester_photo');
      const insert = (photoFileId: string) =>
        api.withContext(orgContext(orgId), (tx) =>
          tx.contester.create({
            data: { organizationId: orgId, eventId, categoryId, fullName: 'Juma', photoFileId },
          }),
        );
      await expect(insert(foreign)).rejects.toThrow(/NOT_FOUND/);
      await expect(insert(logo)).rejects.toThrow(/NOT_FOUND/);
      await expect(insert(photo)).resolves.toMatchObject({ photoFileId: photo });
      await expect(
        api.withContext(
          orgContext(orgId),
          (tx) =>
            tx.$executeRaw`UPDATE public.files SET mime_type = 'text/html' WHERE id = ${photo}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
