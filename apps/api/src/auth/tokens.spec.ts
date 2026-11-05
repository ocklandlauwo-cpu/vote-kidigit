// Integration test of invitations and password reset (Implementation Plan step 10, Backend
// Schema 8.2): the API queues email jobs, a worker in the same process sends them to the memory
// transport, and the links in the emails drive the accept and reset endpoints.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { MeResponseSchema, TokenInfoResponseSchema } from '@vote-kidigit/shared';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { RequestContextService, systemContext } from '../context/request-context.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { MailService, type MailMessage } from '../mail/mail.service.js';
import {
  createOrganization,
  createUser,
  deleteOrganizations,
  ownerClient,
  uniqueSuffix,
} from '../testing/db.js';
import { createTestHttpApp, testIp } from '../testing/http.js';
import { WorkerModule } from '../worker.module.js';
import { verifyPassword } from './passwords.js';
import { TokensService } from './tokens.service.js';
import { tokenHash } from './user-tokens.service.js';

const PASSWORD = 'Uchaguzi2027';
const LOGIN = '/api/v1/auth/login';
const FORGOT = '/api/v1/auth/forgot';
const RESET = '/api/v1/auth/reset';
const ACCEPT = '/api/v1/auth/invite/accept';

/** The error code of an API error response. */
const codeOf = (res: request.Response) => (res.body as { code?: string }).code;

describe('invitations and password reset', () => {
  let app: NestExpressApplication;
  let logs: string[];
  let worker: TestingModule;
  let owner: PrismaClient;
  let outbox: MailMessage[];
  let orgId: string;
  const orgIds: string[] = [];
  const platformUserIds: string[] = [];
  let ip: string;

  const server = () => app.getHttpServer();
  const anon = () => request.agent(server()).set('X-Forwarded-For', ip);

  async function newUser(
    overrides: Parameters<typeof createUser>[2] = {},
    org: string | null = orgId,
  ) {
    const email = `staff-${uniqueSuffix()}@example.test`;
    const id = await createUser(owner, org, { password: PASSWORD, email, ...overrides });
    if (org === null) platformUserIds.push(id);
    return { id, email };
  }

  async function signIn(email: string, password = PASSWORD) {
    const agent = anon();
    await agent.post(LOGIN).send({ email, password }).expect(200);
    return agent;
  }

  /** Waits for the next email to `to` and returns the link token in it. */
  async function waitForMail(to: string): Promise<{ mail: MailMessage; token: string }> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const mail = outbox.find((m) => m.to === to);
      if (mail) {
        outbox.splice(outbox.indexOf(mail), 1);
        const token = /\/app\/(?:invite|reset)\/([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1];
        if (!token) throw new Error(`no link in: ${mail.text}`);
        return { mail, token };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`no email to ${to}`);
  }

  async function requestReset(email: string): Promise<string> {
    await anon().post(FORGOT).send({ email }).expect(202);
    return (await waitForMail(email)).token;
  }

  /** Inserts a token directly (as owner) with the given state. */
  async function insertToken(
    userId: string,
    purpose: 'invite' | 'password_reset',
    state: { expired?: boolean; used?: boolean } = {},
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await owner.userToken.create({
      data: {
        userId,
        purpose,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + (state.expired ? -60_000 : 3_600_000)),
        usedAt: state.used ? new Date() : null,
      },
    });
    return token;
  }

  async function invite(userId: string, organizationId: string | null = orgId): Promise<void> {
    const tokens = app.get(TokensService);
    await app
      .get(RequestContextService)
      .run(systemContext(`test-${uniqueSuffix()}`, organizationId), () =>
        tokens.sendInvitation(userId, organizationId),
      );
  }

  beforeAll(async () => {
    ({ app, logs } = await createTestHttpApp());
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    outbox = worker.get(MailService).outbox;
    owner = ownerClient();
    orgId = await createOrganization(owner, 'Chama cha Walimu');
    orgIds.push(orgId);
  });

  beforeEach(() => {
    ip = testIp();
  });

  afterAll(async () => {
    await deleteOrganizations(owner, orgIds);
    await owner.user.deleteMany({ where: { id: { in: platformUserIds } } });
    await owner.$disconnect();
    await worker.close();
    await app.close();
  });

  describe('forgot password', () => {
    it('answers 202 for an unknown email and sends nothing', async () => {
      const unknown = `nobody-${uniqueSuffix()}@example.test`;
      await anon().post(FORGOT).send({ email: unknown }).expect(202);
      // Jobs run in order: once a later request's email has arrived, the first job is done.
      const user = await newUser();
      await requestReset(user.email);
      expect(outbox.some((m) => m.to === unknown)).toBe(false);
    });

    it('sends nothing to invited or deactivated accounts', async () => {
      const invited = await newUser({ status: 'invited', password: undefined });
      const deactivated = await newUser({ status: 'deactivated' });
      await anon().post(FORGOT).send({ email: invited.email }).expect(202);
      await anon().post(FORGOT).send({ email: deactivated.email }).expect(202);
      const user = await newUser();
      await requestReset(user.email);
      expect(outbox.some((m) => m.to === invited.email || m.to === deactivated.email)).toBe(false);
    });

    it('emails a reset link in the user language, once per minute', async () => {
      const user = await newUser();
      await owner.user.update({ where: { id: user.id }, data: { language: 'en' } });
      await anon().post(FORGOT).send({ email: user.email.toUpperCase() }).expect(202);
      const { mail, token } = await waitForMail(user.email);
      expect(mail.subject).toBe('Reset your Vote-Kidigit password');
      expect(mail.html).toContain(`/app/reset/${token}`);

      await anon().post(FORGOT).send({ email: user.email }).expect(202);
      const other = await newUser();
      await requestReset(other.email);
      expect(outbox.some((m) => m.to === user.email)).toBe(false);
      expect(await owner.userToken.count({ where: { userId: user.id } })).toBe(1);
    });

    it('validates the email', async () => {
      const res = await anon().post(FORGOT).send({ email: 'not-an-email' }).expect(400);
      expect(codeOf(res)).toBe('VALIDATION_FAILED');
    });
  });

  describe('token check', () => {
    it('describes a valid token', async () => {
      const user = await newUser();
      const token = await requestReset(user.email);
      const res = await anon().get(`/api/v1/auth/tokens/${token}`).expect(200);
      expect(TokenInfoResponseSchema.parse(res.body)).toMatchObject({
        purpose: 'password_reset',
        email: user.email,
        fullName: 'Test User',
        organizationName: 'Chama cha Walimu',
      });
    });

    it('rejects unknown, malformed, expired and used tokens', async () => {
      const user = await newUser();
      const unknown = randomBytes(32).toString('base64url');
      const expired = await insertToken(user.id, 'password_reset', { expired: true });
      const used = await insertToken(user.id, 'password_reset', { used: true });
      const check = (token: string) => anon().get(`/api/v1/auth/tokens/${token}`);
      expect(codeOf(await check(unknown).expect(404))).toBe('NOT_FOUND');
      expect(codeOf(await check('short').expect(404))).toBe('NOT_FOUND');
      expect(codeOf(await check(expired).expect(410))).toBe('TOKEN_EXPIRED');
      expect(codeOf(await check(used).expect(409))).toBe('TOKEN_USED');
    });

    it('stores only the hash of the token', async () => {
      const user = await newUser();
      const token = await requestReset(user.email);
      const row = await owner.userToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(Buffer.from(row.tokenHash).equals(Buffer.from(tokenHash(token)))).toBe(true);
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(60 * 60_000, -4);
    });
  });

  describe('reset', () => {
    it('sets the password, clears the lockout and ends every session', async () => {
      const user = await newUser();
      const first = await signIn(user.email);
      const second = await signIn(user.email);
      await owner.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() + 600_000), failedLoginCount: 3 },
      });
      const token = await requestReset(user.email);

      await anon().post(RESET).send({ token, password: 'Mpya2027Kabisa' }).expect(204);

      await first.get('/api/v1/me').expect(401);
      await second.get('/api/v1/me').expect(401);
      await anon().post(LOGIN).send({ email: user.email, password: PASSWORD }).expect(401);
      await signIn(user.email, 'Mpya2027Kabisa');
      const row = await owner.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.failedLoginCount).toBe(0);
      // The session epoch moves after the password transaction, so a sign-in that read the old
      // hash while it was committing is rejected too.
      const saved = await owner.passwordHistory.findFirstOrThrow({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(row.passwordChangedAt?.getTime()).toBeGreaterThan(saved.createdAt.getTime());
      expect(row.passwordHash && (await verifyPassword(row.passwordHash, 'Mpya2027Kabisa'))).toBe(
        true,
      );
      expect(
        await owner.auditLog.count({ where: { entityId: user.id, action: 'auth.password.reset' } }),
      ).toBe(1);
    });

    it('stops working once the password is changed another way', async () => {
      const user = await newUser();
      const token = await requestReset(user.email);
      const agent = await signIn(user.email);
      const me = await agent.get('/api/v1/me').expect(200);
      await agent
        .post('/api/v1/me/password')
        .set('X-CSRF-Token', (me.body as { csrfToken: string }).csrfToken)
        .send({ currentPassword: PASSWORD, newPassword: 'Imebadilika2027' })
        .expect(204);
      const res = await anon().post(RESET).send({ token, password: 'Mpya2027Kabisa' }).expect(404);
      expect(codeOf(res)).toBe('NOT_FOUND');
    });

    it('works once', async () => {
      const user = await newUser();
      const token = await requestReset(user.email);
      await anon().post(RESET).send({ token, password: 'Mpya2027Kabisa' }).expect(204);
      const res = await anon().post(RESET).send({ token, password: 'Nyingine2027X' }).expect(409);
      expect(codeOf(res)).toBe('TOKEN_USED');
    });

    it('rejects expired tokens and invitation tokens', async () => {
      const user = await newUser();
      const expired = await insertToken(user.id, 'password_reset', { expired: true });
      const inviteToken = await insertToken(user.id, 'invite');
      await anon().post(RESET).send({ token: expired, password: 'Mpya2027Kabisa' }).expect(410);
      await anon().post(RESET).send({ token: inviteToken, password: 'Mpya2027Kabisa' }).expect(404);
    });

    it('enforces the password policy', async () => {
      const user = await newUser();
      const token = await insertToken(user.id, 'password_reset');
      for (const password of ['Short1A', 'alllowercase1', 'ALLUPPERCASE1', 'NoNumbersHere']) {
        const res = await anon().post(RESET).send({ token, password }).expect(400);
        expect(codeOf(res)).toBe('VALIDATION_FAILED');
        expect(JSON.stringify(res.body)).not.toContain(password);
      }
      // The token is still usable after rejected attempts.
      await anon().post(RESET).send({ token, password: 'Mpya2027Kabisa' }).expect(204);
    });

    it('rejects the current password and the last 5, but not the 6th', async () => {
      const user = await newUser();
      const passwords = ['Kwanza2027A', 'Pili2027Bb', 'Tatu2027Cc', 'Nne2027Dddd', 'Tano2027Eee'];
      for (const password of passwords) {
        const token = await insertToken(user.id, 'password_reset');
        await anon().post(RESET).send({ token, password }).expect(204);
      }
      // History: the 5 above; PASSWORD (set without history by the fixture) is the 6th back.
      ip = testIp(); // past the 10-per-minute limit of the token routes
      for (const password of passwords) {
        const token = await insertToken(user.id, 'password_reset');
        const res = await anon().post(RESET).send({ token, password }).expect(422);
        expect(codeOf(res)).toBe('PASSWORD_REUSED');
      }
      const token = await insertToken(user.id, 'password_reset');
      await anon().post(RESET).send({ token, password: PASSWORD }).expect(204);
      expect(await owner.passwordHistory.count({ where: { userId: user.id } })).toBe(5);
    }, 90_000); // 11 resets, each verifying up to 6 Argon2id hashes
  });

  describe('invitation', () => {
    it('emails a link, then accepting activates the account and signs in', async () => {
      const user = await newUser({ status: 'invited', password: undefined });
      await invite(user.id);
      const { mail, token } = await waitForMail(user.email);
      expect(mail.subject).toBe('Akaunti yako ya Vote-Kidigit kwa Chama cha Walimu');
      expect(mail.text).toContain('saa 48');

      const info = await anon().get(`/api/v1/auth/tokens/${token}`).expect(200);
      expect(info.body).toMatchObject({ purpose: 'invite', organizationName: 'Chama cha Walimu' });

      const agent = anon();
      const res = await agent
        .post(ACCEPT)
        .send({ token, fullName: 'Asha Mwinyi', password: 'Karibu2027Sana' })
        .expect(200);
      expect(MeResponseSchema.parse(res.body)).toMatchObject({
        id: user.id,
        fullName: 'Asha Mwinyi',
      });
      expect(res.headers['x-session-expires']).toBeDefined();
      await agent.get('/api/v1/me').expect(200);

      const row = await owner.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.status).toBe('active');
      await signIn(user.email, 'Karibu2027Sana');

      const again = await anon()
        .post(ACCEPT)
        .send({ token, fullName: 'Asha Mwinyi', password: 'Karibu2027Sana' })
        .expect(409);
      expect(codeOf(again)).toBe('TOKEN_USED');
    });

    it('invites platform administrators', async () => {
      const user = await newUser({ status: 'invited', password: undefined }, null);
      await invite(user.id, null);
      const { mail, token } = await waitForMail(user.email);
      expect(mail.subject).toContain('Vote-Kidigit');
      await anon()
        .post(ACCEPT)
        .send({ token, fullName: 'Juma Admin', password: 'Karibu2027Sana' })
        .expect(200);
    });

    it('only the newest invitation link works', async () => {
      const user = await newUser({ status: 'invited', password: undefined });
      const old = await insertToken(user.id, 'invite');
      await invite(user.id);
      const { token } = await waitForMail(user.email);
      await anon().get(`/api/v1/auth/tokens/${old}`).expect(404);
      await anon().get(`/api/v1/auth/tokens/${token}`).expect(200);
    });

    it('rejects expired invitations, reset tokens and weak passwords', async () => {
      const user = await newUser({ status: 'invited', password: undefined });
      const expired = await insertToken(user.id, 'invite', { expired: true });
      const reset = await insertToken(user.id, 'password_reset');
      const body = { fullName: 'Asha Mwinyi', password: 'Karibu2027Sana' };
      await anon()
        .post(ACCEPT)
        .send({ ...body, token: expired })
        .expect(410);
      await anon()
        .post(ACCEPT)
        .send({ ...body, token: reset })
        .expect(404);
      const valid = await insertToken(user.id, 'invite');
      const weak = await anon()
        .post(ACCEPT)
        .send({ ...body, token: valid, password: 'dhaifu' });
      expect(weak.status).toBe(400);
      expect(codeOf(weak)).toBe('VALIDATION_FAILED');
    });

    it('does not accept an invitation into a suspended organization', async () => {
      const suspended = await createOrganization(owner);
      orgIds.push(suspended);
      const user = await newUser({ status: 'invited', password: undefined }, suspended);
      const token = await insertToken(user.id, 'invite');
      await owner.organization.update({ where: { id: suspended }, data: { status: 'suspended' } });
      const res = await anon()
        .post(ACCEPT)
        .send({ token, fullName: 'Asha Mwinyi', password: 'Karibu2027Sana' })
        .expect(403);
      expect(codeOf(res)).toBe('ORG_SUSPENDED');
      const row = await owner.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.status).toBe('invited');
    });
  });

  it('never logs link tokens or passwords', async () => {
    const user = await newUser();
    const token = await requestReset(user.email);
    await anon().get(`/api/v1/auth/tokens/${token}`).expect(200);
    await anon().post(RESET).send({ token, password: 'Mpya2027Kabisa' }).expect(204);
    const all = logs.join(' ');
    expect(all).toContain('/api/v1/auth/tokens/');
    expect(all).not.toContain(token);
    expect(all).not.toContain('Mpya2027Kabisa');
  });
});
