// Integration test of publishing and the scheduler (Implementation Plan step 20, Backend Schema
// 11.9, 12.5): the checklist blocks publishing with the right items, schedule / open now,
// unpublish refused after the first code SMS, cancel and archive, and the 1-minute sweep that
// opens a scheduled event at its start time and closes categories at their own closing time.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { EventDetail, MeResponse, SystemRoleKey } from '@vote-kidigit/shared';
import type { Queue } from 'bullmq';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { SCHEDULE_QUEUE } from '../../queue/queue.module.js';
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
import { WorkerModule } from '../../worker.module.js';
import { ScheduleProcessor, SWEEP_JOB } from './schedule.processor.js';
import { SchedulerRunner, SWEEP_EVERY_MS } from './scheduler.js';

const PASSWORD = 'Uchaguzi2027';
const HOUR = 3_600_000;
const codeOf = (res: request.Response) => (res.body as { code?: string }).code;
const reasonOf = (res: request.Response) =>
  (res.body as { details?: { reason?: string } }).details?.reason;

interface Staff {
  id: string;
  agent: TestAgent;
  csrf: string;
}

describe('event lifecycle and scheduler', () => {
  let app: NestExpressApplication;
  let worker: TestingModule;
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  const staff = {} as Record<'admin' | 'moderator' | 'observer', Staff>;

  const send = (who: Staff, path: string, body?: object) =>
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

  /** A Draft event; `complete` adds a category, a contester and a voter (checklist all green). */
  async function seedEvent(
    options: {
      complete?: boolean;
      startAt?: Date;
      endAt?: Date;
      status?: 'draft' | 'scheduled' | 'open';
    } = {},
  ) {
    const startAt = options.startAt ?? new Date(Date.now() + 24 * HOUR);
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: `AGM ${uniqueSuffix()}`,
        startAt,
        endAt: options.endAt ?? new Date(startAt.getTime() + 24 * HOUR),
        status: options.status ?? 'draft',
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
    let categoryId: string | null = null;
    if (options.complete) {
      const category = await owner.category.create({
        data: { organizationId: orgId, eventId: event.id, name: 'Mwenyekiti', displayOrder: 0 },
      });
      categoryId = category.id;
      await owner.contester.create({
        data: { organizationId: orgId, eventId: event.id, categoryId, fullName: 'Asha' },
      });
      await owner.voter.create({
        data: {
          organizationId: orgId,
          eventId: event.id,
          fullName: 'Juma',
          membershipId: `M-${uniqueSuffix()}`,
          phone: '+255712000001',
          gender: 'male',
        },
      });
    }
    return { id: event.id, name: event.name, categoryId };
  }

  const status = async (id: string) =>
    (await owner.votingEvent.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Ratiba');
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

  describe('publish', () => {
    it('is blocked by the checklist, naming the failing items', async () => {
      const event = await seedEvent();
      const res = await send(staff.moderator, `/events/${event.id}/publish`, { mode: 'schedule' });
      expect([res.status, codeOf(res)]).toEqual([422, 'CHECKLIST_FAILED']);
      const items = (res.body as { details: { items: { item: string }[] } }).details.items;
      expect(items.map((i) => i.item)).toEqual([
        'categories',
        'contesters',
        'rules',
        'voters',
        'eligibility',
      ]);
      expect(await status(event.id)).toBe('draft');
    });

    it('schedules a ready event, audited, and unpublishes it until codes are sent', async () => {
      const event = await seedEvent({ complete: true });
      await send(staff.observer, `/events/${event.id}/publish`, { mode: 'schedule' }).expect(403);
      const published = (
        await send(staff.moderator, `/events/${event.id}/publish`, {
          mode: 'schedule',
        }).expect(200)
      ).body as EventDetail;
      expect(published.status).toBe('scheduled');
      expect(
        await owner.auditLog.count({ where: { eventId: event.id, action: 'event.publish' } }),
      ).toBe(1);

      await send(staff.moderator, `/events/${event.id}/unpublish`).expect(200);
      expect(await status(event.id)).toBe('draft');

      await send(staff.moderator, `/events/${event.id}/publish`, { mode: 'schedule' }).expect(200);
      await owner.votingEvent.update({
        where: { id: event.id },
        data: { firstCodeSentAt: new Date() },
      });
      const refused = await send(staff.moderator, `/events/${event.id}/unpublish`);
      expect([refused.status, codeOf(refused), reasonOf(refused)]).toEqual([
        409,
        'INVALID_TRANSITION',
        'CODES_SENT',
      ]);
      expect(await status(event.id)).toBe('scheduled');
    });

    it('opens now from Draft or Scheduled; cannot schedule once the start has passed', async () => {
      const late = await seedEvent({
        complete: true,
        startAt: new Date(Date.now() - HOUR),
        endAt: new Date(Date.now() + HOUR),
      });
      const tooLate = await send(staff.moderator, `/events/${late.id}/publish`, {
        mode: 'schedule',
      });
      expect([codeOf(tooLate), reasonOf(tooLate)]).toEqual(['INVALID_TRANSITION', 'START_PASSED']);
      const opened = (
        await send(staff.moderator, `/events/${late.id}/publish`, {
          mode: 'open_now',
        }).expect(200)
      ).body as EventDetail;
      expect(opened.status).toBe('open');
      expect(opened.openedAt).not.toBeNull();

      const scheduled = await seedEvent({ complete: true });
      await send(staff.moderator, `/events/${scheduled.id}/publish`, { mode: 'schedule' }).expect(
        200,
      );
      await send(staff.moderator, `/events/${scheduled.id}/publish`, { mode: 'open_now' }).expect(
        200,
      );
      expect(await status(scheduled.id)).toBe('open');
    });
  });

  describe('cancel and archive', () => {
    it('cancels with the typed name and a reason, then archives', async () => {
      const event = await seedEvent({ complete: true });
      const wrong = await send(staff.moderator, `/events/${event.id}/cancel`, {
        confirmName: 'Jina jingine',
        reason: 'Mkutano umeahirishwa',
      });
      expect([wrong.status, codeOf(wrong)]).toEqual([400, 'VALIDATION_FAILED']);
      await send(staff.moderator, `/events/${event.id}/cancel`, {
        confirmName: event.name,
        reason: 'fupi',
      }).expect(400);
      // Only Results Published or Cancelled events are archived.
      await send(staff.admin, `/events/${event.id}/archive`).expect(409);

      const cancelled = (
        await send(staff.moderator, `/events/${event.id}/cancel`, {
          confirmName: ` ${event.name} `,
          reason: 'Mkutano umeahirishwa hadi mwezi ujao',
        }).expect(200)
      ).body as EventDetail;
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        cancelReason: 'Mkutano umeahirishwa hadi mwezi ujao',
      });
      expect(cancelled.cancelledBy).toContain('@example.test');

      await send(staff.moderator, `/events/${event.id}/archive`).expect(403);
      const archived = (await send(staff.admin, `/events/${event.id}/archive`).expect(200))
        .body as EventDetail;
      expect(archived.status).toBe('archived');
    });
  });

  describe('scheduler', () => {
    // A fixed moment long ago: the shared test database holds no other event due then.
    const T0 = new Date('2000-01-01T00:00:00Z');

    it('opens a scheduled event at its start time and closes categories at their own time', async () => {
      const runner = worker.get(SchedulerRunner);
      const due = await seedEvent({
        complete: true,
        status: 'scheduled',
        startAt: T0,
        endAt: new Date(Date.now() + HOUR),
      });
      const hidden = await seedEvent({
        complete: true,
        status: 'scheduled',
        startAt: T0,
        endAt: new Date(Date.now() + HOUR),
      });
      await owner.votingEvent.update({ where: { id: hidden.id }, data: { isActive: false } });
      const running = await seedEvent({
        complete: true,
        status: 'open',
        startAt: new Date(T0.getTime() - HOUR),
        endAt: new Date(Date.now() + HOUR),
      });
      await owner.category.update({
        where: { id: running.categoryId ?? '' },
        data: { closesAt: new Date(T0.getTime() + 30_000) },
      });

      // Not yet due a minute before.
      await runner.sweep(new Date(T0.getTime() - 60_000));
      expect(await status(due.id)).toBe('scheduled');

      const result = await runner.sweep(new Date(T0.getTime() + SWEEP_EVERY_MS));
      expect(result).toMatchObject({ opened: 1, closedCategories: 1, failed: 0 });
      expect(await status(due.id)).toBe('open');
      expect(await status(hidden.id)).toBe('scheduled');
      const category = await owner.category.findUniqueOrThrow({
        where: { id: running.categoryId ?? '' },
      });
      expect(category.closedAt).not.toBeNull();
      const opened = await owner.auditLog.findFirstOrThrow({
        where: { eventId: due.id, action: 'event.open' },
      });
      expect(opened).toMatchObject({ actorType: 'system', actorLabel: 'System' });

      // A second sweep finds nothing left to do.
      expect(await runner.sweep(new Date(T0.getTime() + SWEEP_EVERY_MS))).toMatchObject({
        opened: 0,
        closedCategories: 0,
      });
    });

    it('repeats the sweep every minute through a BullMQ job scheduler', async () => {
      await worker.get(ScheduleProcessor).registerSweep();
      const queue = worker.get<Queue>(getQueueToken(SCHEDULE_QUEUE));
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers).toEqual([
        expect.objectContaining({ key: SWEEP_JOB, every: SWEEP_EVERY_MS }),
      ]);
      await queue.removeJobScheduler(SWEEP_JOB);
    });
  });
});
