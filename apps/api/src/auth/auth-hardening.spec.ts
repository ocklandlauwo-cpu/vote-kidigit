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
});
