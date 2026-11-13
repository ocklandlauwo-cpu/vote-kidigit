// Integration test of messaging (Implementation Plan step 21, Backend Schema 7.1–7.3, 12.8,
// 12.12): sending to 5,000 voters, redaction, retries, auto-pause and resume, delivery reports,
// resending the same code and regenerating, templates, publish with codes, cancellation and
// reminders. The worker runs with the fake SMS gateway.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  type Batch,
  type BatchEstimate,
  formatVotingCode,
  type MeResponse,
  type PreviewTemplateResponse,
  REDACTED_CODE,
  type SystemRoleKey,
  type TemplatesResponse,
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
import { RequestContextService, systemContext } from '../../context/request-context.js';
import { WorkerModule } from '../../worker.module.js';
import { SchedulerRunner } from '../events/scheduler.js';
import { CodesService } from '../voters/codes.service.js';
import { MessageSender, RetryLater } from './message-sender.js';
import { FakeSmsAdapter, SmsSendError } from './sms-gateway.js';

const PASSWORD = 'Uchaguzi2027';
const codeOf = (res: request.Response) => (res.body as { code?: string }).code;

interface Staff {
  id: string;
  agent: TestAgent;
  csrf: string;
}

describe('messages', () => {
  let app: NestExpressApplication;
  let logs: string[];
  let worker: TestingModule;
  let owner: PrismaClient;
  let api: PrismaService;
  let codes: CodesService;
  let fake: FakeSmsAdapter;
  let orgId: string;
  let dlrSecret: string;
  const staff = {} as Record<'moderator' | 'observer', Staff>;

  const send = (who: Staff, path: string, body?: object) =>
    who.agent.post(`/api/v1${path}`).set('X-CSRF-Token', who.csrf).send(body);
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

  async function seedEvent(
    status: EventStatus = 'scheduled',
    voters = 3,
    change: { startAt?: Date; endAt?: Date; reminderBeforeOpenHours?: number | null } = {},
  ) {
    const startAt = change.startAt ?? new Date(Date.now() + 2 * 86_400_000);
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: `AGM ${uniqueSuffix()}`,
        startAt,
        endAt: change.endAt ?? new Date(startAt.getTime() + 8 * 3_600_000),
        status,
        reminderBeforeOpenHours: change.reminderBeforeOpenHours ?? null,
        reminderBeforeCloseMinutes: null,
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
    const tag = uniqueSuffix();
    await owner.voter.createMany({
      data: Array.from({ length: voters }, (_, i) => ({
        organizationId: orgId,
        eventId: event.id,
        fullName: `Mpiga kura ${i}`,
        membershipId: `${tag}-${i}`,
        phone: `+2557${String(10_000_000 + i).padStart(8, '0')}`,
        email: i === 0 ? `mpiga-${tag}@example.test` : null,
        gender: i % 2 ? ('male' as const) : ('female' as const),
        ...codes.issue(),
        codeGeneratedAt: new Date(),
      })),
    });
    return event;
  }

  async function waitForBatch(batchId: string, statuses: string[], seconds = 60) {
    for (let i = 0; i < seconds * 5; i += 1) {
      const batch = await owner.smsBatch.findUniqueOrThrow({ where: { id: batchId } });
      if (statuses.includes(batch.status)) return batch;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`batch ${batchId} did not reach ${statuses.join('/')}`);
  }

  const codeOfVoter = async (voterId: string) =>
    formatVotingCode(
      codes.decrypt(
        (await owner.voter.findUniqueOrThrow({ where: { id: voterId } })).codeCiphertext ??
          new Uint8Array(),
      ),
    );

  beforeAll(async () => {
    ({ app, logs } = await createTestHttpApp());
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    codes = worker.get(CodesService);
    fake = worker.get(FakeSmsAdapter);
    dlrSecret = process.env.BEEM_DLR_SECRET ?? '';
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Ujumbe');
    await owner.organization.update({ where: { id: orgId }, data: { smsSenderId: 'CHAMA' } });
    await api.withContext(
      platformContext(),
      (tx) => tx.$executeRaw`SELECT app.create_default_roles(${orgId}::uuid)`,
    );
    staff.moderator = await newStaff('moderator');
    staff.observer = await newStaff('observer');
  });

  afterEach(() => {
    fake.failWith = null;
  });

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId]);
    await owner.$disconnect();
    await api.$disconnect();
    await worker.close();
    await app.close();
  });

  it('sends codes to 5,000 voters, each with its own code, and stores none', async () => {
    const event = await seedEvent('scheduled', 5000);
    const estimate = (
      await get(
        staff.moderator,
        `/events/${event.id}/batches/estimate?type=code_delivery&audience=all`,
      ).expect(200)
    ).body as BatchEstimate;
    // The full voting link (event UUID) makes the default code SMS two segments.
    expect(estimate).toMatchObject({ recipients: 5000, smsCount: 5000 * estimate.segments });
    expect(estimate.segments).toBeLessThanOrEqual(2);

    const before = fake.outbox.length;
    const started = Date.now();
    logs.length = 0;
    const batch = (
      await send(staff.moderator, `/events/${event.id}/batches`, {
        type: 'code_delivery',
        audience: 'all',
      }).expect(201)
    ).body as Batch;
    // NFR-06: 5,000 messages queued in under a minute.
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(batch.totalCount).toBe(5000);

    const done = await waitForBatch(batch.id, ['completed'], 150);
    expect(done).toMatchObject({ sentCount: 5000, failedCount: 0 });
    const sent = fake.outbox.slice(before).filter((m) => m.text.includes(event.name));
    expect(sent).toHaveLength(5000);
    expect(new Set(sent.map((m) => m.senderId))).toEqual(new Set(['CHAMA']));

    // Spot checks: the SMS carries the voter's own code; the database has only the mask.
    const sample = await owner.voter.findMany({ where: { eventId: event.id }, take: 3 });
    for (const voter of sample) {
      const code = await codeOfVoter(voter.id);
      const sms = sent.find((m) => m.to === voter.phone);
      expect(sms?.text).toContain(code);
      const row = await owner.smsMessage.findFirstOrThrow({ where: { voterId: voter.id } });
      expect(row.bodyRedacted).toContain(REDACTED_CODE);
      expect(row.bodyRedacted).not.toContain(code);
      expect(row).toMatchObject({ status: 'sent', attempts: 1 });
      expect(voter.codeStatus).toBe('sent');
    }
    // Every voter's own code, decrypted here: none appears in a stored message, the audit log
    // or the logs. (A pattern match would also hit digit runs in UUIDs.)
    const allCodes = await Promise.all(
      (await owner.voter.findMany({ where: { eventId: event.id }, select: { id: true } })).map(
        (v) => codeOfVoter(v.id),
      ),
    );
    const bodies = (
      await owner.smsMessage.findMany({
        where: { eventId: event.id },
        select: { bodyRedacted: true },
      })
    ).map((m) => m.bodyRedacted);
    expect(bodies.every((body) => body.includes(REDACTED_CODE))).toBe(true);
    const stored = [
      bodies.join(' '),
      JSON.stringify(await owner.auditLog.findMany({ where: { eventId: event.id } })),
      logs.join(' '),
    ].join(' ');
    expect(allCodes.filter((code) => stored.includes(code))).toEqual([]);
    const updated = await owner.votingEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.firstCodeSentAt).not.toBeNull();
  }, 240_000);

  it('retries a temporary failure and records the attempts', async () => {
    const event = await seedEvent('scheduled', 1);
    let failures = 0;
    fake.failWith = () => (failures++ < 2 ? new SmsSendError('timeout', true) : null);
    const batch = (
      await send(staff.moderator, `/events/${event.id}/batches`, {
        type: 'code_delivery',
        audience: 'all',
      }).expect(201)
    ).body as Batch;
    await waitForBatch(batch.id, ['completed'], 60);
    const message = await owner.smsMessage.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(message).toMatchObject({ status: 'sent', attempts: 3, lastError: null });
  }, 90_000);

  it('pauses a batch when more than 20% fail, and resumes it', async () => {
    const event = await seedEvent('scheduled', 30);
    // Every third voter's number is refused (about a third: above 20%).
    fake.failWith = (sms) =>
      Number(sms.to.slice(-1)) % 3 === 0 ? new SmsSendError('400 invalid number', false) : null;
    const batch = (
      await send(staff.moderator, `/events/${event.id}/batches`, {
        type: 'code_delivery',
        audience: 'all',
      }).expect(201)
    ).body as Batch;
    const paused = await waitForBatch(batch.id, ['paused'], 30);
    expect(paused.pausedReason).toBe('failure_rate');
    const failedVoter = await owner.smsMessage.findFirstOrThrow({
      where: { batchId: batch.id, status: 'failed' },
      select: { voterId: true, lastError: true },
    });
    expect(failedVoter.lastError).toBe('400 invalid number');
    expect(
      (await owner.voter.findUniqueOrThrow({ where: { id: failedVoter.voterId ?? '' } }))
        .codeStatus,
    ).toBe('failed');

    fake.failWith = null;
    await send(staff.moderator, `/events/${event.id}/batches/${batch.id}/resume`).expect(200);
    const done = await waitForBatch(batch.id, ['completed'], 30);
    expect(done.sentCount + done.failedCount).toBe(30);
    expect(await owner.smsMessage.count({ where: { batchId: batch.id, status: 'queued' } })).toBe(
      0,
    );

    // Resend failed: a new batch for exactly the failed voters, with their same codes.
    const resent = (
      await send(staff.moderator, `/events/${event.id}/batches/${batch.id}/resend-failed`).expect(
        200,
      )
    ).body as Batch;
    expect(resent.totalCount).toBe(done.failedCount);
    await waitForBatch(resent.id, ['completed'], 30);
  }, 120_000);

  it('updates message, batch and voter from delivery reports', async () => {
    const event = await seedEvent('scheduled', 2);
    const batch = (
      await send(staff.moderator, `/events/${event.id}/batches`, {
        type: 'code_delivery',
        audience: 'all',
      }).expect(201)
    ).body as Batch;
    await waitForBatch(batch.id, ['completed'], 30);
    const [first, second] = await owner.smsMessage.findMany({
      where: { batchId: batch.id },
      orderBy: { createdAt: 'asc' },
    });
    const report = (secret: string, body: object) =>
      request(app.getHttpServer()).post(`/api/webhooks/beem/dlr?secret=${secret}`).send(body);

    await report('wrong-secret', {
      request_id: first?.providerMessageId,
      status: 'DELIVERED',
    }).expect(401);
    await report(dlrSecret, { request_id: first?.providerMessageId, status: 'DELIVERED' }).expect(
      200,
    );
    await report(dlrSecret, {
      requestId: second?.providerMessageId,
      dlr_status: 'undelivered',
    }).expect(200);
    await report(dlrSecret, { request_id: 'unknown-id', status: 'DELIVERED' }).expect(200);
    // A repeated report changes nothing.
    await report(dlrSecret, { request_id: first?.providerMessageId, status: 'UNDELIVERED' }).expect(
      200,
    );

    const delivered = await owner.smsMessage.findUniqueOrThrow({ where: { id: first?.id ?? '' } });
    expect(delivered.status).toBe('delivered');
    expect(
      (await owner.voter.findUniqueOrThrow({ where: { id: delivered.voterId ?? '' } })).codeStatus,
    ).toBe('delivered');
    const failed = await owner.smsMessage.findUniqueOrThrow({ where: { id: second?.id ?? '' } });
    expect(failed.status).toBe('failed');
    expect(await owner.smsBatch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({
      deliveredCount: 1,
      failedCount: 1,
    });
  }, 60_000);

  it('resends the same code, and regenerating sends a new one', async () => {
    const event = await seedEvent('scheduled', 1);
    const voter = await owner.voter.findFirstOrThrow({ where: { eventId: event.id } });
    const oldCode = await codeOfVoter(voter.id);
    const smsTo = () => fake.outbox.filter((m) => m.to === voter.phone);
    const count = smsTo().length;

    await send(staff.observer, `/events/${event.id}/voters/${voter.id}/resend-code`).expect(403);
    await send(staff.moderator, `/events/${event.id}/voters/${voter.id}/resend-code`).expect(200);
    await waitFor(() => smsTo().length === count + 1);
    expect(smsTo().at(-1)?.text).toContain(oldCode);

    await send(staff.moderator, `/events/${event.id}/voters/${voter.id}/regenerate-code`).expect(
      200,
    );
    await waitFor(() => smsTo().length === count + 2);
    const newCode = await codeOfVoter(voter.id);
    expect(newCode).not.toBe(oldCode);
    expect(smsTo().at(-1)?.text).toContain(newCode);

    const draft = await seedEvent('draft', 1);
    const draftVoter = await owner.voter.findFirstOrThrow({ where: { eventId: draft.id } });
    const refused = await send(
      staff.moderator,
      `/events/${draft.id}/voters/${draftVoter.id}/resend-code`,
    );
    expect(codeOf(refused)).toBe('INVALID_TRANSITION');
    const detail = (await get(staff.moderator, `/events/${event.id}/voters/${voter.id}`)).body as {
      messages: { bodyRedacted: string }[];
    };
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages.every((m) => m.bodyRedacted.includes(REDACTED_CODE))).toBe(true);
  }, 60_000);

  it('edits, previews and resets templates; only known placeholders', async () => {
    const event = await seedEvent('scheduled', 1);
    const put = (body: string | null) =>
      staff.moderator.agent
        .put(`/api/v1/events/${event.id}/templates`)
        .set('X-CSRF-Token', staff.moderator.csrf)
        .send({ templates: [{ type: 'code_delivery', channel: 'sms', body }] });
    await put('Msimbo: {code}').expect(400);
    const saved = (await put('{org_name} {event_name}: msimbo {voting_code}').expect(200))
      .body as TemplatesResponse;
    expect(
      saved.items.find((t) => t.type === 'code_delivery' && t.channel === 'sms'),
    ).toMatchObject({
      source: 'event',
    });
    const preview = (
      await send(staff.moderator, `/events/${event.id}/templates/preview`, {
        type: 'code_delivery',
        channel: 'sms',
        body: '{event_name}: {voting_code} '.repeat(8),
      }).expect(200)
    ).body as PreviewTemplateResponse;
    expect(preview.text).toContain('K7M4-Q9XR');
    expect(preview.segments).toBeGreaterThan(1);

    const batch = (
      await send(staff.moderator, `/events/${event.id}/batches`, {
        type: 'code_delivery',
        audience: 'all',
      }).expect(201)
    ).body as Batch;
    const message = await owner.smsMessage.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(message.bodyRedacted).toBe(`Chama cha Ujumbe ${event.name}: msimbo ${REDACTED_CODE}`);

    const reset = (await put(null).expect(200)).body as TemplatesResponse;
    expect(reset.items.find((t) => t.type === 'code_delivery' && t.channel === 'sms')?.source).toBe(
      'default',
    );
    await waitForBatch(batch.id, ['completed'], 30);
  }, 60_000);

  it('sends codes when publishing with "Send codes now", and tells voters of a cancellation', async () => {
    const event = await seedEvent('draft', 2);
    const category = await owner.category.create({
      data: { organizationId: orgId, eventId: event.id, name: 'Mwenyekiti', displayOrder: 0 },
    });
    await owner.contester.create({
      data: { organizationId: orgId, eventId: event.id, categoryId: category.id, fullName: 'Asha' },
    });
    await send(staff.moderator, `/events/${event.id}/publish`, {
      mode: 'schedule',
      sendCodes: true,
    }).expect(200);
    const codesBatch = await owner.smsBatch.findFirstOrThrow({
      where: { eventId: event.id, type: 'code_delivery' },
    });
    expect(codesBatch).toMatchObject({ audience: 'not_sent', totalCount: 2 });
    await waitForBatch(codesBatch.id, ['completed'], 30);
    // Unpublishing is refused once codes went out.
    await send(staff.moderator, `/events/${event.id}/unpublish`).expect(409);

    await send(staff.moderator, `/events/${event.id}/cancel`, {
      confirmName: event.name,
      reason: 'Mkutano umeahirishwa',
    }).expect(200);
    const cancelled = await owner.smsBatch.findFirstOrThrow({
      where: { eventId: event.id, type: 'event_cancelled' },
    });
    expect(cancelled.totalCount).toBe(2);
  }, 60_000);

  it('sends the reminder before opening once, from the scheduler', async () => {
    // A fixed moment long ago: no other test's event is due then.
    const start = new Date('2000-01-02T08:00:00Z');
    const event = await seedEvent('scheduled', 2, {
      startAt: start,
      endAt: new Date(Date.now() + 86_400_000),
      reminderBeforeOpenHours: 24,
    });
    const runner = worker.get(SchedulerRunner);
    expect((await runner.sweep(new Date('2000-01-01T07:00:00Z'))).reminders).toBe(0);
    expect((await runner.sweep(new Date('2000-01-01T08:30:00Z'))).reminders).toBe(1);
    expect((await runner.sweep(new Date('2000-01-01T09:30:00Z'))).reminders).toBe(0);
    const reminder = await owner.smsBatch.findFirstOrThrow({
      where: { eventId: event.id, type: 'reminder_before_open' },
    });
    expect(reminder).toMatchObject({ audience: 'not_voted', totalCount: 2, createdBy: null });
  }, 60_000);

  it('stops a batch when the event is cancelled while it sends', async () => {
    const event = await seedEvent('scheduled', 12);
    // Every send fails for now and waits for a retry, so the batch is still going.
    fake.failWith = () => new SmsSendError('timeout', true);
    const batch = (
      await send(staff.moderator, `/events/${event.id}/batches`, {
        type: 'code_delivery',
        audience: 'all',
      }).expect(201)
    ).body as Batch;
    await send(staff.moderator, `/events/${event.id}/cancel`, {
      confirmName: event.name,
      reason: 'Mkutano umeahirishwa',
    }).expect(200);
    expect((await owner.smsBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe(
      'cancelled',
    );
    // A send already handed to the gateway when the event was cancelled may still finish;
    // let those settle (still failing), then let the retries through.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    fake.failWith = null;
    // The retries come and go (backoff 5 s) without sending any code.
    await new Promise((resolve) => setTimeout(resolve, 8000));
    expect(fake.outbox.filter((m) => m.text.includes(event.name))).toHaveLength(0);
    expect(await owner.smsMessage.count({ where: { batchId: batch.id, status: 'sent' } })).toBe(0);
    // No event_cancelled batch: no code had reached anyone.
    expect(
      await owner.smsBatch.count({ where: { eventId: event.id, type: 'event_cancelled' } }),
    ).toBe(0);

    const resume = await send(staff.moderator, `/events/${event.id}/batches/${batch.id}/resume`);
    expect(codeOf(resume)).toBe('INVALID_TRANSITION');
    await owner.smsMessage.updateMany({ where: { batchId: batch.id }, data: { status: 'failed' } });
    const resend = await send(
      staff.moderator,
      `/events/${event.id}/batches/${batch.id}/resend-failed`,
    );
    expect(codeOf(resend)).toBe('INVALID_TRANSITION');
  }, 60_000);

  it('publishes with "Send codes now" only for holders of messages.send', async () => {
    const role = await owner.role.create({
      data: { organizationId: orgId, name: `Publisher ${uniqueSuffix()}` },
    });
    await owner.rolePermission.createMany({
      data: ['event.view', 'event.publish'].map((permissionKey) => ({
        roleId: role.id,
        permissionKey,
        organizationId: orgId,
      })),
    });
    const email = `publisher-${uniqueSuffix()}@example.test`;
    const id = await createUser(owner, orgId, { email, password: PASSWORD });
    await owner.userRole.create({ data: { userId: id, roleId: role.id, organizationId: orgId } });
    const agent = request.agent(app.getHttpServer()).set('X-Forwarded-For', testIp());
    const login = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    const publisher: Staff = { id, agent, csrf: (login.body as MeResponse).csrfToken };

    const event = await seedEvent('draft', 2);
    await owner.eventAssignment.create({
      data: { organizationId: orgId, eventId: event.id, userId: id, type: 'moderator' },
    });
    const category = await owner.category.create({
      data: { organizationId: orgId, eventId: event.id, name: 'Mwenyekiti', displayOrder: 0 },
    });
    await owner.contester.create({
      data: { organizationId: orgId, eventId: event.id, categoryId: category.id, fullName: 'Asha' },
    });
    const refused = await send(publisher, `/events/${event.id}/publish`, {
      mode: 'schedule',
      sendCodes: true,
    }).expect(403);
    expect(codeOf(refused)).toBe('FORBIDDEN');
    // Nothing changed: still Draft, no batch.
    expect((await owner.votingEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(
      'draft',
    );
    expect(await owner.smsBatch.count({ where: { eventId: event.id } })).toBe(0);
    await send(publisher, `/events/${event.id}/publish`, {
      mode: 'schedule',
      sendCodes: false,
    }).expect(200);
  });

  it('sends a message once even when two runs of its job overlap', async () => {
    const event = await seedEvent('scheduled', 1);
    const voter = await owner.voter.findFirstOrThrow({ where: { eventId: event.id } });
    const message = await owner.smsMessage.create({
      data: {
        organizationId: orgId,
        eventId: event.id,
        voterId: voter.id,
        channel: 'sms',
        type: 'code_delivery',
        toAddress: voter.phone,
        bodyRedacted: `Msimbo: ${REDACTED_CODE}`,
      },
    });
    const sender = worker.get(MessageSender);
    const requestContext = worker.get(RequestContextService);
    const run = () =>
      requestContext.run(systemContext(randomUUID(), orgId), () => sender.send(message.id, false));
    const before = fake.outbox.length;
    const outcomes = await Promise.allSettled([run(), run()]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find((o) => o.status === 'rejected');
    expect(refused?.status === 'rejected' && refused.reason).toBeInstanceOf(RetryLater);
    // The retry finds it sent and does nothing.
    expect(await run()).toBe('skipped');
    expect(fake.outbox.length - before).toBe(1);
  });

  it('does not send again when recording the send fails (busy database)', async () => {
    const event = await seedEvent('scheduled', 1);
    const voter = await owner.voter.findFirstOrThrow({ where: { eventId: event.id } });
    const message = await owner.smsMessage.create({
      data: {
        organizationId: orgId,
        eventId: event.id,
        voterId: voter.id,
        channel: 'sms',
        type: 'code_delivery',
        toAddress: voter.phone,
        bodyRedacted: `Msimbo: ${REDACTED_CODE}`,
      },
    });
    const sender = worker.get(MessageSender);
    const requestContext = worker.get(RequestContextService);
    const run = () =>
      requestContext.run(systemContext(randomUUID(), orgId), () => sender.send(message.id, false));
    // The gateway accepts the SMS, then the transaction recording it cannot start in time.
    const record = jest
      .spyOn(sender as unknown as { recordSent: () => Promise<unknown> }, 'recordSent')
      .mockRejectedValueOnce(new Error('Unable to start a transaction in the given time'));
    const before = fake.outbox.length;
    await expect(run()).rejects.toThrow('Unable to start a transaction');
    // The job's retry records the earlier send instead of sending again.
    expect(await run()).toBe('sent');
    record.mockRestore();
    expect(fake.outbox.length - before).toBe(1);
    expect(await owner.smsMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
      status: 'sent',
      providerMessageId: fake.outbox.at(-1)?.providerMessageId,
    });
  });

  it('refuses codes before publish and needs messages.send', async () => {
    const draft = await seedEvent('draft', 1);
    const res = await send(staff.moderator, `/events/${draft.id}/batches`, {
      type: 'code_delivery',
      audience: 'all',
    });
    expect(codeOf(res)).toBe('INVALID_TRANSITION');
    const scheduled = await seedEvent('scheduled', 1);
    await send(staff.observer, `/events/${scheduled.id}/batches`, {
      type: 'code_delivery',
      audience: 'all',
    }).expect(403);
    await get(staff.observer, `/events/${scheduled.id}/batches`).expect(200);
    await get(staff.moderator, `/events/${randomUUID()}/batches`).expect(404);
  });
});

async function waitFor(check: () => boolean, seconds = 30): Promise<void> {
  for (let i = 0; i < seconds * 5; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('condition not met in time');
}
