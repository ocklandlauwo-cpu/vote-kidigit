// Kiosk mode (Implementation Plan step 25, Backend Schema 7.4, 7.5, 11.8, 12.9; App Flow 10):
// launch and end, the device's PIN (3 wrong lock it), re-sending the existing code (twice, 60 s
// apart), the other phone with staff approval and its 3-voters limit, the already-voted
// short-circuit, unknown membership IDs, and the kiosk channel on participation.
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  KioskSendCodeResponse,
  LaunchKioskResponse,
  MeResponse,
  SystemRoleKey,
  VoterSignInResponse,
} from '@vote-kidigit/shared';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { EventStatus } from '../../generated/prisma/enums.js';
import { RedisService } from '../../redis/redis.service.js';
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
import { CodesService } from '../voters/codes.service.js';

const PASSWORD = 'Uchaguzi2027';
const PIN = '4821';
const codeOf = (res: request.Response) => (res.body as { code?: string }).code;
const details = (res: request.Response) =>
  (res.body as { details?: Record<string, unknown> }).details ?? {};

interface Staff {
  id: string;
  email: string;
  agent: TestAgent;
  csrf: string;
}

describe('kiosk', () => {
  let app: NestExpressApplication;
  let owner: PrismaClient;
  let codes: CodesService;
  let redis: RedisService;
  let orgId: string;
  const staff = {} as Record<'moderator' | 'observer', Staff>;
  let order = 0;

  const server = () => app.getHttpServer();
  const device = (token: string) => ({
    get: (path: string) =>
      request(server()).get(`/api/v1/vote/kiosk${path}`).set('X-Kiosk-Token', token),
    post: (path: string, body?: object) =>
      request(server())
        .post(`/api/v1/vote/kiosk${path}`)
        .set('X-Kiosk-Token', token)
        .set('X-Forwarded-For', testIp())
        .send(body),
  });

  async function newStaff(role: SystemRoleKey): Promise<Staff> {
    const email = `${role}-${uniqueSuffix()}@example.test`;
    const id = await createUser(owner, orgId, { email, password: PASSWORD });
    const roleRow = await owner.role.findFirstOrThrow({
      where: { organizationId: orgId, systemKey: role },
    });
    await owner.userRole.create({
      data: { userId: id, roleId: roleRow.id, organizationId: orgId },
    });
    const agent = request.agent(server()).set('X-Forwarded-For', testIp());
    const res = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    return { id, email, agent, csrf: (res.body as MeResponse).csrfToken };
  }

  async function seedEvent(status: EventStatus = 'open') {
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: `Kiosk ${uniqueSuffix()}`,
        startAt: new Date(Date.now() - 3_600_000),
        endAt: new Date(Date.now() + 8 * 3_600_000),
        status,
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
    order += 1;
    const category = await owner.category.create({
      data: {
        organizationId: orgId,
        eventId: event.id,
        name: `Nafasi ${order}`,
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
    return { id: event.id, categoryId: category.id, contesterIds: contesters.map((c) => c.id) };
  }

  async function seedVoter(eventId: string, phone = '+255712000041') {
    const code = 'K7M4Q9XR'
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('');
    const membershipId = `K-${uniqueSuffix()}`;
    const voter = await owner.voter.create({
      data: {
        organizationId: orgId,
        eventId,
        fullName: 'Amina Hassan',
        membershipId,
        phone,
        gender: 'female',
        ...{ codeHmac: codes.fingerprint(code), codeCiphertext: codes.encrypt(code) },
        codeGeneratedAt: new Date(),
      },
    });
    return { id: voter.id, membershipId, code, codeHmac: voter.codeHmac };
  }

  /** Launching ends the staff session (the device becomes a kiosk): sign in afresh each time. */
  async function launch(eventId: string, who: Staff = staff.moderator) {
    const agent = request.agent(server()).set('X-Forwarded-For', testIp());
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: who.email, password: PASSWORD });
    const as = { ...who, agent, csrf: (login.body as MeResponse).csrfToken };
    const res = await as.agent
      .post(`/api/v1/events/${eventId}/kiosk-sessions`)
      .set('X-CSRF-Token', as.csrf)
      .send({ deviceLabel: 'Ukumbi A – Tablet 2', pin: PIN });
    return res;
  }

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
    codes = app.get(CodesService);
    redis = app.get(RedisService);
    owner = ownerClient();
    const api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Kiosk');
    await api.withContext(
      platformContext(),
      (tx) => tx.$executeRaw`SELECT app.create_default_roles(${orgId}::uuid)`,
    );
    await api.$disconnect();
    staff.moderator = await newStaff('moderator');
    staff.observer = await newStaff('observer');
  });

  afterAll(async () => {
    await owner.kioskCodeSend.deleteMany({ where: { organizationId: orgId } });
    await owner.kioskSession.deleteMany({ where: { organizationId: orgId } });
    await deleteOrganizations(owner, [orgId]);
    await owner.$disconnect();
    await app.close();
  });

  it('launches only for a published event with kiosk.operate, lists and ends', async () => {
    const draft = await seedEvent('draft');
    expect(codeOf(await launch(draft.id))).toBe('INVALID_TRANSITION');
    const event = await seedEvent('scheduled');
    expect((await launch(event.id, staff.observer)).status).toBe(403);
    const res = await launch(event.id);
    expect(res.status).toBe(201);
    const launched = res.body as LaunchKioskResponse;
    expect(launched.url).toMatch(new RegExp(`/vote/kiosk/${launched.token}$`));
    // The launching staff session ended with the launch.
    expect(String(res.headers['set-cookie'] ?? '')).toMatch(/vk\.sid=;/);
    // Only the hash of the token and of the PIN are stored.
    const row = await owner.kioskSession.findUniqueOrThrow({ where: { id: launched.id } });
    expect(row.pinHash).toMatch(/^\$argon2id\$/);
    expect(Buffer.from(row.tokenHash).toString('base64url')).not.toBe(launched.token);

    const list = await staff.moderator.agent
      .get(`/api/v1/events/${event.id}/kiosk-sessions`)
      .expect(200);
    expect(list.body).toMatchObject({
      items: [{ id: launched.id, deviceLabel: 'Ukumbi A – Tablet 2' }],
    });
    const card = await device(launched.token).get('/session').expect(200);
    expect(card.body).toMatchObject({
      deviceLabel: 'Ukumbi A – Tablet 2',
      event: { id: event.id },
    });
    await device(launched.token).post('/heartbeat').expect(204);
    expect(
      (await owner.kioskSession.findUniqueOrThrow({ where: { id: launched.id } })).lastSeenAt,
    ).not.toBeNull();

    await staff.moderator.agent
      .post(`/api/v1/events/${event.id}/kiosk-sessions/${launched.id}/end`)
      .set('X-CSRF-Token', staff.moderator.csrf)
      .expect(204);
    await device(launched.token).get('/session').expect(401);
  });

  it('exits only with the staff PIN; three wrong lock it for 5 minutes', async () => {
    const event = await seedEvent();
    const { token } = (await launch(event.id)).body as LaunchKioskResponse;
    for (const left of [2, 1]) {
      const res = await device(token).post('/exit', { pin: '0000' }).expect(401);
      expect(details(res)).toEqual({ attemptsLeft: left });
    }
    await device(token).post('/exit', { pin: '0000' }).expect(401);
    const locked = await device(token).post('/exit', { pin: PIN }).expect(401);
    expect(details(locked).lockedUntil).toBeDefined();

    const second = (await launch(event.id)).body as LaunchKioskResponse;
    await device(second.token).post('/exit', { pin: PIN }).expect(204);
    await device(second.token).get('/session').expect(401);
  });

  it('re-sends the existing code: twice, 60 seconds apart, then "see the officer"', async () => {
    const event = await seedEvent();
    const voter = await seedVoter(event.id, '+255712000123');
    const launched = (await launch(event.id)).body as LaunchKioskResponse;
    const kiosk = device(launched.token);
    const first = await kiosk.post('/send-code', { membershipId: voter.membershipId }).expect(200);
    expect(first.body as KioskSendCodeResponse).toEqual({
      state: 'sent',
      phoneLast3: '123',
      sendsLeft: 1,
    });
    const message = await owner.smsMessage.findFirstOrThrow({ where: { voterId: voter.id } });
    expect(message).toMatchObject({ type: 'code_delivery', toAddress: '+255712000123' });
    // The same code: nothing was regenerated.
    expect((await owner.voter.findUniqueOrThrow({ where: { id: voter.id } })).codeHmac).toEqual(
      voter.codeHmac,
    );
    const sends = await owner.kioskCodeSend.findMany({ where: { voterId: voter.id } });
    expect(sends).toEqual([
      expect.objectContaining({
        usedAlternatePhone: false,
        smsMessageId: message.id,
        alternatePhoneHmac: null,
      }),
    ]);

    const tooSoon = await kiosk
      .post('/send-code', { membershipId: voter.membershipId })
      .expect(429);
    expect(details(tooSoon)).toMatchObject({ reason: 'WAIT' });
    // 60 seconds later (moved back here).
    await redis.hset(`kiosksend:${launched.id}:${voter.id}`, 'last', String(Date.now() - 61_000));
    const second = await kiosk.post('/send-code', { membershipId: voter.membershipId }).expect(200);
    expect((second.body as KioskSendCodeResponse & { sendsLeft: number }).sendsLeft).toBe(0);
    await redis.hset(`kiosksend:${launched.id}:${voter.id}`, 'last', String(Date.now() - 61_000));
    const third = await kiosk.post('/send-code', { membershipId: voter.membershipId }).expect(429);
    expect(details(third)).toMatchObject({ reason: 'SEE_OFFICER' });
  });

  it('counts unknown membership IDs against the device', async () => {
    const event = await seedEvent();
    const { token } = (await launch(event.id)).body as LaunchKioskResponse;
    const res = await device(token).post('/send-code', { membershipId: 'NOBODY-1' }).expect(404);
    expect(details(res)).toEqual({ attemptsLeft: 4 });
  });

  it("sends to someone else's phone only with the staff PIN, for at most 3 voters", async () => {
    const event = await seedEvent();
    const { token } = (await launch(event.id)).body as LaunchKioskResponse;
    const kiosk = device(token);
    const other = '0754 999 888';
    const voters = [];
    for (let i = 0; i < 4; i += 1) voters.push(await seedVoter(event.id));

    const noPin = await kiosk.post('/send-code', {
      membershipId: voters[0]?.membershipId,
      alternatePhone: other,
    });
    expect(noPin.status).toBe(400);
    const wrongPin = await kiosk.post('/send-code', {
      membershipId: voters[0]?.membershipId,
      alternatePhone: other,
      staffPin: '9999',
    });
    expect(codeOf(wrongPin)).toBe('KIOSK_PIN_INVALID');

    for (const voter of voters.slice(0, 3)) {
      const res = await kiosk
        .post('/send-code', {
          membershipId: voter.membershipId,
          alternatePhone: other,
          staffPin: PIN,
        })
        .expect(200);
      expect(res.body).toEqual({ state: 'sent', phoneLast3: '888', sendsLeft: 0 });
      expect(
        await owner.smsMessage.findFirstOrThrow({ where: { voterId: voter.id } }),
      ).toMatchObject({ toAddress: '+255754999888' });
      // The number is not saved on the voter.
      expect((await owner.voter.findUniqueOrThrow({ where: { id: voter.id } })).phone).toBe(
        '+255712000041',
      );
    }
    const send = await owner.kioskCodeSend.findFirstOrThrow({ where: { voterId: voters[0]?.id } });
    expect(send).toMatchObject({ usedAlternatePhone: true, alternatePhoneLast3: '888' });
    expect(Buffer.from(send.alternatePhoneHmac ?? []).toString()).not.toContain('754999888');
    expect(
      await owner.auditLog.count({
        where: { action: 'kiosk.code_sent_other_phone', entityId: voters[0]?.id },
      }),
    ).toBe(1);

    const fourth = await kiosk.post('/send-code', {
      membershipId: voters[3]?.membershipId,
      alternatePhone: other,
      staffPin: PIN,
    });
    expect(codeOf(fourth)).toBe('ALT_PHONE_LIMIT');
    expect(await owner.smsMessage.count({ where: { voterId: voters[3]?.id } })).toBe(0);
    expect(await owner.kioskCodeSend.count({ where: { voterId: voters[3]?.id } })).toBe(0);
  });

  it('records the kiosk channel, and sends no code to a voter who already voted', async () => {
    const event = await seedEvent();
    const voter = await seedVoter(event.id);
    const { token } = (await launch(event.id)).body as LaunchKioskResponse;
    await device(token).post('/send-code', { membershipId: voter.membershipId }).expect(200);

    // Sign in on the kiosk (any eventId in the body is replaced by the kiosk's event).
    const signIn = await request(server())
      .post('/api/v1/vote/sign-in')
      .set('X-Kiosk-Token', token)
      .set('X-Forwarded-For', testIp())
      .send({ membershipId: voter.membershipId, code: voter.code })
      .expect(200);
    const ballot = (signIn.body as VoterSignInResponse).token;
    const as = (path: string, body?: object) =>
      request(server())
        .post(`/api/v1/vote${path}`)
        .set('Authorization', `Bearer ${ballot}`)
        .send(body);
    await as('/confirm-identity').expect(200);
    await as('/ballot', {
      selections: [
        {
          categoryId: event.categoryId,
          choice: 'contester',
          contesterIds: [event.contesterIds[0]],
        },
      ],
    }).expect(200);
    expect(
      await owner.voterParticipation.findFirstOrThrow({ where: { voterId: voter.id } }),
    ).toMatchObject({
      channel: 'kiosk',
    });

    const smsBefore = await owner.smsMessage.count({
      where: { voterId: voter.id, type: 'code_delivery' },
    });
    const again = await device(token)
      .post('/send-code', { membershipId: voter.membershipId })
      .expect(200);
    expect((again.body as KioskSendCodeResponse).state).toBe('voted');
    expect(
      await owner.smsMessage.count({ where: { voterId: voter.id, type: 'code_delivery' } }),
    ).toBe(smsBefore);

    // A kiosk token that no longer runs cannot sign anyone in.
    await request(server())
      .post('/api/v1/vote/sign-in')
      .set('X-Kiosk-Token', 'x'.repeat(43))
      .send({ membershipId: voter.membershipId, code: voter.code })
      .expect(401);
  });
});
