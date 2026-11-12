// Reports over HTTP with the worker running (Implementation Plan step 28): the results PDF only
// after close, rendered by Chromium and downloaded as an attachment; the voters report as Excel
// with voted / not voted and masked phones and never a choice or a code; audit exports for the
// organization and for one event; who may read a report file; recent downloads; and a
// 5,000-voter results PDF in under 10 seconds.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import type { MeResponse, ReportJob, SystemRoleKey } from '@vote-kidigit/shared';
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
import { CodesService } from '../voters/codes.service.js';
import { sheetRows } from '../../testing/xlsx.js';

const PASSWORD = 'Uchaguzi2027';
const codeOf = (res: request.Response) => (res.body as { code?: string }).code;

interface Staff {
  id: string;
  agent: TestAgent;
  csrf: string;
}

/** supertest collects a binary response body as a Buffer. */
const binary = (res: request.Response, done: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('reports', () => {
  let app: NestExpressApplication;
  let worker: TestingModule;
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  let otherOrgId: string;
  const staff = {} as Record<'admin' | 'observer' | 'stranger', Staff>;
  let order = 0;

  const get = (who: Staff, path: string) => who.agent.get(`/api/v1${path}`);
  const post = (who: Staff, path: string, body?: object) =>
    who.agent.post(`/api/v1${path}`).set('X-CSRF-Token', who.csrf).send(body);
  const download = (who: Staff, url: string) => who.agent.get(url).buffer(true).parse(binary);

  async function newStaff(org: string, role: SystemRoleKey): Promise<Staff> {
    const email = `${role}-${uniqueSuffix()}@example.test`;
    const id = await createUser(owner, org, { email, password: PASSWORD });
    const roleRow = await owner.role.findFirstOrThrow({
      where: { organizationId: org, systemKey: role },
    });
    await owner.userRole.create({ data: { userId: id, roleId: roleRow.id, organizationId: org } });
    const agent = request.agent(app.getHttpServer()).set('X-Forwarded-For', testIp());
    const res = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    return { id, agent, csrf: (res.body as MeResponse).csrfToken };
  }

  /**
   * An Open event with one category; the first `votes` voters vote for Asha, the rest do not.
   * Voter rows are inserted in one statement so 5,000 of them take a moment, not a minute.
   */
  async function election(voters: number, votes: number) {
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: `Ripoti ${uniqueSuffix()}`,
        startAt: new Date(Date.now() - 3_600_000),
        endAt: new Date(Date.now() + 8 * 3_600_000),
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
      data: { organizationId: orgId, eventId: event.id, name: 'Mwenyekiti', displayOrder: order },
    });
    const asha = await owner.contester.create({
      data: {
        organizationId: orgId,
        eventId: event.id,
        categoryId: category.id,
        fullName: 'Asha Mollel',
      },
    });
    // Two contesters: a category with one contester is a Yes/No vote.
    await owner.contester.create({
      data: {
        organizationId: orgId,
        eventId: event.id,
        categoryId: category.id,
        fullName: 'Juma Ali',
      },
    });
    const prefix = uniqueSuffix();
    await owner.$executeRaw`
      INSERT INTO public.voters (organization_id, event_id, full_name, membership_id, phone, gender)
      SELECT ${orgId}::uuid, ${event.id}::uuid, 'Mpiga ' || lpad(n::text, 5, '0'),
             ${prefix} || '-' || n, '+2557120' || lpad(n::text, 5, '0'), 'female'
      FROM generate_series(1, ${voters}) AS n`;
    const ballot = JSON.stringify([
      { categoryId: category.id, choice: 'contester', contesterIds: [asha.id] },
    ]);
    // Short transactions of 500 ballots: tests running in parallel lock the ballot tables too.
    for (let offset = 0; offset < votes; offset += 500) {
      const take = Math.min(500, votes - offset);
      await api.withContext(
        orgContext(orgId),
        (tx) => tx.$queryRaw`
          SELECT app.cast_ballot(v.id, ${event.id}::uuid, ${ballot}::jsonb, 'web'::vote_channel)
          FROM (SELECT id FROM public.voters WHERE event_id = ${event.id}::uuid
                ORDER BY full_name OFFSET ${offset} LIMIT ${take}) v`,
        { timeout: 60_000 },
      );
    }
    return { eventId: event.id, name: event.name, categoryId: category.id };
  }

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Ripoti');
    otherOrgId = await createOrganization(owner, 'Chama Kingine');
    for (const org of [orgId, otherOrgId]) {
      await api.withContext(
        platformContext(),
        (tx) => tx.$executeRaw`SELECT app.create_default_roles(${org}::uuid)`,
      );
    }
    staff.admin = await newStaff(orgId, 'admin');
    staff.observer = await newStaff(orgId, 'observer');
    staff.stranger = await newStaff(otherOrgId, 'org_super_admin');
  }, 60_000);

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId, otherOrgId]);
    await owner.$disconnect();
    await api.$disconnect();
    await worker.close();
    await app.close();
  });

  it('makes the results PDF only after close, and serves it as an attachment', async () => {
    const e = await election(5, 3);
    const early = await post(staff.admin, `/events/${e.eventId}/reports`, { type: 'results_pdf' });
    expect(early.status).toBe(409);
    expect(codeOf(early)).toBe('INVALID_TRANSITION');
    expect((early.body as { details?: unknown }).details).toEqual({ reason: 'RESULTS_NOT_READY' });

    await post(staff.admin, `/events/${e.eventId}/close`).expect(200);
    const res = await post(staff.observer, `/events/${e.eventId}/reports`, {
      type: 'results_pdf',
    }).expect(200);
    const job = res.body as ReportJob;
    expect(job).toMatchObject({ type: 'results_pdf', status: 'completed', progress: 100 });
    expect(job.fileName).toMatch(/^matokeo-ripoti-.*\.pdf$/);
    expect(job.requestedBy).toBeTruthy();

    const file = await download(staff.admin, job.downloadUrl ?? '').expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toBe(`attachment; filename="${job.fileName}"`);
    expect((file.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // Another organization never sees it.
    await get(staff.stranger, job.downloadUrl?.replace('/api/v1', '') ?? '').expect(404);

    const recent = (await get(staff.admin, `/events/${e.eventId}/reports`).expect(200))
      .body as ReportJob[];
    expect(recent.map((r) => r.id)).toEqual([job.id]);
    await get(staff.admin, `/events/${e.eventId}/reports/${job.id}`).expect(200);
    // The job is not an audit export, and audit routes do not show it.
    await get(staff.admin, `/events/${e.eventId}/audit/exports/${job.id}`).expect(404);

    const audit = await owner.auditLog.findFirst({
      where: { entityId: job.id, action: 'reports.download' },
    });
    expect(audit?.after).toEqual({ type: 'results_pdf' });
  });

  it('writes the voters report with voted / not voted and masked phones, never choices or codes', async () => {
    const e = await election(4, 2);
    // Give one voter a real code: the report must not carry it in any form.
    const codes = worker.get(CodesService);
    const issued = codes.issue();
    const first = await owner.voter.findFirstOrThrow({
      where: { eventId: e.eventId },
      orderBy: { fullName: 'asc' },
    });
    await owner.voter.update({
      where: { id: first.id },
      data: {
        codeHmac: issued.codeHmac,
        codeCiphertext: issued.codeCiphertext,
        codeStatus: 'delivered',
      },
    });

    const job = (
      await post(staff.admin, `/events/${e.eventId}/reports`, { type: 'voters_xlsx' }).expect(200)
    ).body as ReportJob;
    expect(job.fileName).toMatch(/^wapiga-kura-.*\.xlsx$/);
    const file = await download(staff.admin, job.downloadUrl ?? '').expect(200);
    const rows = await sheetRows(file.body as Buffer);
    expect(rows[0]).toEqual([
      'Jina',
      'Namba ya uanachama',
      'Jinsia',
      'Simu',
      'Nafasi',
      'Hali',
      'SMS ya namba',
    ]);
    expect(rows.slice(1).map((row) => [row[0], row[3], row[5], row[6]])).toEqual([
      ['Mpiga 00001', '••••••••••001', 'Amepiga kura', 'Imefika'],
      ['Mpiga 00002', '••••••••••002', 'Amepiga kura', 'Haijatumwa'],
      ['Mpiga 00003', '••••••••••003', 'Hajapiga kura', 'Haijatumwa'],
      ['Mpiga 00004', '••••••••••004', 'Hajapiga kura', 'Haijatumwa'],
    ]);
    const text = rows.flat().join('\n');
    expect(text).not.toContain('Asha');
    expect(text).not.toContain('Juma');
    expect(text).not.toContain('+2557');
    for (const stored of [issued.codeHmac, issued.codeCiphertext]) {
      expect(text).not.toContain(Buffer.from(stored).toString('hex'));
      expect(text).not.toContain(Buffer.from(stored).toString('base64'));
    }

    const pdf = (
      await post(staff.admin, `/events/${e.eventId}/reports`, { type: 'voters_pdf' }).expect(200)
    ).body as ReportJob;
    expect(pdf.status).toBe('completed');
    const pdfFile = await download(staff.admin, pdf.downloadUrl ?? '').expect(200);
    expect((pdfFile.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('exports the audit log for the organization and for one event, to the right people', async () => {
    const e = await election(2, 0);
    // Organization export: Admins only (audit.view.org).
    await post(staff.observer, '/audit/exports', { filters: {} }).expect(403);
    const org = (
      await post(staff.admin, '/audit/exports', { filters: { action: 'reports.' } }).expect(200)
    ).body as ReportJob;
    expect(org).toMatchObject({ type: 'audit_xlsx', status: 'completed' });
    expect(org.fileName).toMatch(/^kumbukumbu-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const rows = await sheetRows(
      (await download(staff.admin, org.downloadUrl ?? '').expect(200)).body as Buffer,
    );
    expect(rows[0]?.slice(0, 3)).toEqual(['Muda', 'Mtumiaji', 'Kitendo']);
    expect(rows.slice(1).every((row) => row[2]?.startsWith('reports.'))).toBe(true);
    // The observer may not read the organization export's file either.
    await get(staff.observer, org.downloadUrl?.replace('/api/v1', '') ?? '').expect(404);
    await get(staff.admin, `/audit/exports/${org.id}`).expect(200);

    // Event export: anyone mapped with audit.view.event.
    const event = (
      await post(staff.observer, `/events/${e.eventId}/audit/exports`, { filters: {} }).expect(200)
    ).body as ReportJob;
    expect(event.fileName).toMatch(/^kumbukumbu-ripoti-.*\.xlsx$/);
    await download(staff.observer, event.downloadUrl ?? '').expect(200);
    await get(staff.stranger, `/events/${e.eventId}/audit/exports/${event.id}`).expect(404);
    // Audit exports stay out of the event's recent downloads.
    const recent = (await get(staff.admin, `/events/${e.eventId}/reports`).expect(200))
      .body as ReportJob[];
    expect(recent).toEqual([]);
  });

  it('refuses report requests with unknown types and an event of another organization', async () => {
    const e = await election(1, 0);
    const bad = await post(staff.admin, `/events/${e.eventId}/reports`, { type: 'audit_xlsx' });
    expect(codeOf(bad)).toBe('VALIDATION_FAILED');
    await post(staff.stranger, `/events/${e.eventId}/reports`, { type: 'voters_pdf' }).expect(404);
  });

  it('renders the results PDF of a 5,000-voter event in under 10 seconds', async () => {
    const e = await election(5000, 3500);
    await post(staff.admin, `/events/${e.eventId}/close`).expect(200);
    const started = Date.now();
    const job = (
      await post(staff.admin, `/events/${e.eventId}/reports`, { type: 'results_pdf' }).expect(200)
    ).body as ReportJob;
    const took = Date.now() - started;
    const counted = await owner.voterParticipation.count({ where: { eventId: e.eventId } });
    expect(counted).toBe(3500);
    expect(job.status).toBe('completed');
    expect(took).toBeLessThan(10_000);
    const row = await owner.reportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect((row.completedAt?.getTime() ?? 0) - row.createdAt.getTime()).toBeLessThan(10_000);
  }, 180_000);
});
