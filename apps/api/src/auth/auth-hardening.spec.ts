// Regression tests for the security review of step 9: lockout race, account enumeration through
// the lockout, current-password brute force, session revocation without the session index, and
// sign-in rate limits that sessions could reset.
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { MeResponse } from '@vote-kidigit/shared';
import request from 'supertest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { RedisService } from '../redis/redis.service.js';
import {
  createOrganization,
  createUser,
  deleteOrganizations,
  ownerClient,
  uniqueSuffix,
} from '../testing/db.js';
import { createTestHttpApp, testIp } from '../testing/http.js';
import { AuthStateService } from './auth-state.service.js';
import * as passwords from './passwords.js';
import { createHash } from 'node:crypto';

const PASSWORD = 'Uchaguzi2027';
const WRONG = 'Wrong12345';
const LOGIN = '/api/v1/auth/login';

describe('staff authentication hardening', () => {
  let app: NestExpressApplication;
  let owner: PrismaClient;
  let redis: RedisService;
  let orgId: string;

  const server = () => app.getHttpServer();
  /** A cookie-less client from this test's own address. */
  const anon = () => request.agent(server()).set('X-Forwarded-For', ip);
  const login = (email: string, password: string) => anon().post(LOGIN).send({ email, password });

  async function newUser(): Promise<{ id: string; email: string }> {
    const email = `hard-${uniqueSuffix()}@example.test`;
    return { id: await createUser(owner, orgId, { password: PASSWORD, email }), email };
  }

  async function signIn(email: string) {
    const agent = request.agent(server()).set('X-Forwarded-For', ip);
    const response = await agent.post(LOGIN).send({ email, password: PASSWORD }).expect(200);
    return { agent, me: response.body as MeResponse };
  }

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
    owner = ownerClient();
    redis = app.get(RedisService);
    orgId = await createOrganization(owner);
  });

  let ip: string;
  beforeEach(() => {
    ip = testIp(); // own per-IP rate-limit counters for every test
  });

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId]);
    await owner.$disconnect();
    await app.close();
  });

  it('locks the account even when wrong passwords arrive at the same time', async () => {
    const user = await newUser();
    const responses = await Promise.all(Array.from({ length: 8 }, () => login(user.email, WRONG)));
    const codes = responses.map((r) => (r.body as { code: string }).code);
    expect(codes).toContain('ACCOUNT_LOCKED');
    expect(codes.every((c) => c === 'ACCOUNT_LOCKED' || c === 'INVALID_CREDENTIALS')).toBe(true);

    const stored = await owner.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    await login(user.email, PASSWORD).expect(423);
  });

  it('locks unknown emails exactly like real accounts, so the lock reveals nothing', async () => {
    const known = await newUser();
    const unknown = `ghost-${uniqueSuffix()}@example.test`;
    for (let i = 0; i < 4; i += 1) {
      await login(known.email, WRONG).expect(401);
      await login(unknown, WRONG).expect(401);
    }
    const lockedKnown = await login(known.email, WRONG).expect(423);
    const lockedUnknown = await login(` ${unknown.toUpperCase()} `, WRONG).expect(423);
    type Locked = { code: string; message: string; details: { lockedUntil: string } };
    const [a, b] = [lockedKnown.body as Locked, lockedUnknown.body as Locked];
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    expect(b.message).toBe(a.message);
    expect(
      Math.abs(Date.parse(a.details.lockedUntil) - Date.parse(b.details.lockedUntil)),
    ).toBeLessThan(5_000);
    // …and stays locked for the unknown email too (from a new address, so the IP limit is not what answers)
    ip = testIp();
    await login(unknown, WRONG).expect(423);
  });

  it('counts wrong current passwords towards the lockout and ends the sessions at the lock', async () => {
    const user = await newUser();
    const { agent, me } = await signIn(user.email);
    const other = await signIn(user.email);
    const change = () =>
      agent
        .post('/api/v1/me/password')
        .set('X-CSRF-Token', me.csrfToken)
        .send({ currentPassword: WRONG, newPassword: 'Mpya2027Siri' });

    for (let i = 0; i < 4; i += 1) await change().expect(400);
    const locked = await change().expect(423);
    expect(locked.body).toMatchObject({ code: 'ACCOUNT_LOCKED' });

    await agent.get('/api/v1/me').expect(401);
    await other.agent.get('/api/v1/me').expect(401);
    await login(user.email, PASSWORD).expect(423);
    // The failures are audited even though each request failed.
    expect(
      await owner.auditLog.count({ where: { entityId: user.id, action: 'me.password.failed' } }),
    ).toBe(4);
    expect(
      await owner.auditLog.count({ where: { entityId: user.id, action: 'me.password.locked' } }),
    ).toBe(1);
  });

  it('limits password-change attempts to 5 per 15 minutes per session', async () => {
    const user = await newUser();
    const { agent, me } = await signIn(user.email);
    const attempt = () =>
      agent
        .post('/api/v1/me/password')
        .set('X-CSRF-Token', me.csrfToken)
        .send({ currentPassword: PASSWORD, newPassword: 'short' }); // fails validation, no lock
    for (let i = 0; i < 5; i += 1) await attempt().expect(400);
    await attempt().expect(429);
  });

  it('ends sessions issued before a password change even without the session index', async () => {
    const user = await newUser();
    const { agent, me } = await signIn(user.email);
    const other = await signIn(user.email);
    await redis.del(`sess-user:${user.id}`); // the index is lost (expired or flushed)

    await agent
      .post('/api/v1/me/password')
      .set('X-CSRF-Token', me.csrfToken)
      .send({ currentPassword: PASSWORD, newPassword: 'Mpya2027Siri' })
      .expect(204);

    await agent.get('/api/v1/me').expect(200);
    await other.agent.get('/api/v1/me').expect(401);
  });

  it('keeps the sign-in limit per address even for requests carrying a session', async () => {
    const user = await newUser();
    const { agent } = await signIn(user.email); // 1 attempt used
    for (let i = 0; i < 9; i += 1) {
      await agent
        .post(LOGIN)
        .send({ email: `x${i}-${uniqueSuffix()}@example.test`, password: WRONG })
        .expect(401);
    }
    await agent.post(LOGIN).send({ email: user.email, password: PASSWORD }).expect(429);
    await anon().post(LOGIN).send({ email: user.email, password: PASSWORD }).expect(429);
  });

  describe('second review', () => {
    type Locked = { code: string; details: { lockedUntil: string } };
    const lockedUntilOf = (body: unknown) => (body as Locked).details.lockedUntil;

    it('returns the same stored unlock time on every locked response, for unknown emails too', async () => {
      const known = await newUser();
      const unknown = `ghost-${uniqueSuffix()}@example.test`;
      for (let i = 0; i < 5; i += 1) {
        await login(known.email, WRONG);
        await login(unknown, WRONG);
      }
      ip = testIp(); // stay under the per-IP sign-in limit
      const knownTimes = new Set<string>();
      const unknownTimes = new Set<string>();
      for (let i = 0; i < 3; i += 1) {
        knownTimes.add(lockedUntilOf((await login(known.email, WRONG).expect(423)).body));
        unknownTimes.add(lockedUntilOf((await login(unknown, WRONG).expect(423)).body));
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      expect(knownTimes.size).toBe(1);
      expect(unknownTimes.size).toBe(1);
      const [k] = [...knownTimes];
      const [u] = [...unknownTimes];
      expect(u).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(k).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('starts the failure count again after 24 hours without failures, like unknown emails', async () => {
      const user = await newUser();
      await owner.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 4, lastFailedLoginAt: new Date(Date.now() - 25 * 3_600_000) },
      });
      await login(user.email, WRONG).expect(401); // would have been the 5th failure
      expect(await owner.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
        failedLoginCount: 1,
        lockedUntil: null,
      });

      const unknown = `ghost-${uniqueSuffix()}@example.test`;
      await login(unknown, WRONG).expect(401);
      const digest = createHash('sha256').update(unknown).digest('hex');
      const ttl = await redis.ttl(`login-unknown:${digest}:count`);
      expect(ttl).toBeGreaterThan(24 * 3600 - 60);
      expect(ttl).toBeLessThanOrEqual(24 * 3600);
    });

    it('rejects a session issued at the very moment of a password change', async () => {
      const user = await newUser();
      const { agent } = await signIn(user.email);
      // The session's exact issue time, as stored in Redis.
      const [sessionId] = await redis.smembers(`sess-user:${user.id}`);
      const stored = JSON.parse((await redis.get(`sess:${sessionId}`)) ?? '{}') as {
        issuedAt: number;
      };
      expect(stored.issuedAt).toBeGreaterThan(0);
      // A change at exactly that millisecond ends it (comparison is <=).
      await owner.user.update({
        where: { id: user.id },
        data: { passwordChangedAt: new Date(stored.issuedAt) },
      });
      await app.get(AuthStateService).invalidateUser(user.id);
      await agent.get('/api/v1/me').expect(401);
    });

    it('keeps a lock set while a correct password was being verified', async () => {
      const user = await newUser();
      const real = passwords.verifyPassword;
      const spy = jest
        .spyOn(passwords, 'verifyPassword')
        .mockImplementation(async (hash, password) => {
          // A concurrent wrong attempt locks the account during this verification.
          await owner.user.update({
            where: { id: user.id },
            data: { lockedUntil: new Date(Date.now() + 15 * 60_000) },
          });
          return real(hash, password);
        });
      try {
        const response = await login(user.email, PASSWORD).expect(423);
        expect(response.body).toMatchObject({ code: 'ACCOUNT_LOCKED' });
      } finally {
        spy.mockRestore();
      }
      const stored = await owner.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
