// Integration test of staff authentication (Implementation Plan step 9, Backend Schema 8.1):
// sign-in, wrong password, lockout, inactive accounts, suspended organizations, CSRF, idle
// expiry, deactivation during a session, sign-out, profile and password change.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MeResponseSchema, type MeResponse, PLATFORM_PERMISSIONS } from '@vote-kidigit/shared';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
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
import { AUTH_CACHE_SECONDS, AuthStateService } from './auth-state.service.js';
import { SESSION_PREFIX } from './session.service.js';

const PASSWORD = 'Uchaguzi2027';
const LOGIN = '/api/v1/auth/login';

describe('staff authentication', () => {
  let app: NestExpressApplication;
  let owner: PrismaClient;
  let redis: RedisService;
  let orgId: string;
  let suspendedOrgId: string;
  let permissionKey: string;
  const orgIds: string[] = [];
  const platformUserIds: string[] = [];

  const server = () => app.getHttpServer();
  /** A cookie-less client from this test's own address. */
  const anon = () => request.agent(server()).set('X-Forwarded-For', ip);

  async function newUser(
    overrides: Parameters<typeof createUser>[2] = {},
    org: string | null = orgId,
  ): Promise<{ id: string; email: string }> {
    const email = `staff-${uniqueSuffix()}@example.test`;
    const id = await createUser(owner, org, { password: PASSWORD, email, ...overrides });
    if (org === null) platformUserIds.push(id);
    return { id, email };
  }

  /** Signs in and returns an agent holding the cookie, plus the response body. */
  async function signIn(email: string, password = PASSWORD) {
    const agent = request.agent(server()).set('X-Forwarded-For', ip);
    const response = await agent.post(LOGIN).send({ email, password }).expect(200);
    return { agent, me: response.body as MeResponse, response };
  }

  function sessionIdOf(response: request.Response): string {
    const cookie = [response.headers['set-cookie'] ?? []]
      .flat()
      .find((c) => c.startsWith('vk.sid='));
    const value = decodeURIComponent(cookie?.split(';')[0]?.slice('vk.sid='.length) ?? '');
    return value.slice(2, value.lastIndexOf('.')); // "s:<sid>.<signature>"
  }

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
    owner = ownerClient();
    redis = app.get(RedisService);
    orgId = await createOrganization(owner);
    suspendedOrgId = await createOrganization(owner);
    orgIds.push(orgId, suspendedOrgId);
    await owner.organization.update({
      where: { id: suspendedOrgId },
      data: { status: 'suspended' },
    });

    permissionKey = `test.auth.${uniqueSuffix()}`;
    await owner.permission.create({
      data: {
        key: permissionKey,
        module: 'Test',
        descriptionEn: 'x',
        descriptionSw: 'x',
        scope: 'org',
      },
    });
  });

  let ip: string;
  beforeEach(() => {
    ip = testIp(); // own per-IP rate-limit counters for every test
  });

  afterAll(async () => {
    await deleteOrganizations(owner, orgIds);
    await owner.user.deleteMany({ where: { id: { in: platformUserIds } } });
    await owner.permission.deleteMany({ where: { key: permissionKey } });
    await owner.$disconnect();
    await app.close();
  });

  describe('sign-in', () => {
    it('signs in and returns the profile, a strict session cookie and the expiry', async () => {
      const user = await newUser({ isOrgSuperAdmin: true });
      const role = await owner.role.create({
        data: { organizationId: orgId, name: `Role ${uniqueSuffix()}` },
      });
      await owner.rolePermission.create({
        data: { roleId: role.id, permissionKey, organizationId: orgId },
      });
      await owner.userRole.create({
        data: { userId: user.id, roleId: role.id, organizationId: orgId },
      });

      const { agent, me, response } = await signIn(` ${user.email.toUpperCase()} `);

      expect(MeResponseSchema.parse(me)).toMatchObject({
        id: user.id,
        isOrgSuperAdmin: true,
        isPlatformAdmin: false,
        organization: { id: orgId, sessionTimeoutMinutes: 15 },
        role: { id: role.id },
        permissions: [permissionKey],
      });
      const cookie = [response.headers['set-cookie'] ?? []].flat().join(';');
      expect(cookie).toMatch(/vk\.sid=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      const expires = Date.parse(String(response.headers['x-session-expires']));
      expect(expires - Date.now()).toBeGreaterThan(14 * 60_000);

      await agent.get('/api/v1/me').expect(200);
      expect(
        await owner.auditLog.count({ where: { action: 'auth.login', entityId: user.id } }),
      ).toBe(1);
      const stored = await owner.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.lastLoginAt).not.toBeNull();
    });

    it('answers a wrong password and an unknown email identically', async () => {
      const user = await newUser();
      const wrong = await anon()
        .post(LOGIN)
        .send({ email: user.email, password: 'Wrong12345' })
        .expect(401);
      const unknown = await anon()
        .post(LOGIN)
        .send({ email: `nobody-${uniqueSuffix()}@example.test`, password: 'Wrong12345' })
        .expect(401);
      expect(wrong.body).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
      expect(unknown.body).toEqual(wrong.body);
      expect(
        await owner.auditLog.count({ where: { action: 'auth.login.failed', entityId: user.id } }),
      ).toBe(1);
    });

    it('locks the account for 15 minutes after 5 wrong passwords, then lets it in again', async () => {
      const user = await newUser();
      for (let i = 0; i < 4; i += 1) {
        await anon().post(LOGIN).send({ email: user.email, password: 'Wrong12345' }).expect(401);
      }
      const locked = await anon()
        .post(LOGIN)
        .send({ email: user.email, password: 'Wrong12345' })
        .expect(423);
      const body = locked.body as { code: string; details: { lockedUntil: string } };
      expect(body.code).toBe('ACCOUNT_LOCKED');
      // Both times come from the database clock (Docker's may differ slightly from Node's).
      const lockedRow = await owner.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(lockedRow.lockedUntil?.toISOString()).toBe(body.details.lockedUntil);
      const minutes =
        ((lockedRow.lockedUntil?.getTime() ?? 0) - (lockedRow.lastFailedLoginAt?.getTime() ?? 0)) /
        60_000;
      expect(minutes).toBeCloseTo(15, 5);

      // Even the right password waits for the unlock time.
      const stillLocked = await anon()
        .post(LOGIN)
        .send({ email: user.email, password: PASSWORD })
        .expect(423);
      expect((stillLocked.body as { details: { lockedUntil: string } }).details.lockedUntil).toBe(
        body.details.lockedUntil,
      );

      await owner.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      await signIn(user.email);
      const stored = await owner.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    });

    it('refuses a deactivated account, revealing it only after a correct password', async () => {
      const user = await newUser({ status: 'deactivated' });
      await anon().post(LOGIN).send({ email: user.email, password: 'Wrong12345' }).expect(401);
      const response = await anon()
        .post(LOGIN)
        .send({ email: user.email, password: PASSWORD })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'ACCOUNT_INACTIVE' });
    });

    it('refuses users of a suspended organization', async () => {
      const user = await newUser({}, suspendedOrgId);
      const response = await anon()
        .post(LOGIN)
        .send({ email: user.email, password: PASSWORD })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'ORG_SUSPENDED' });
    });

    it('refuses invited users who have not set a password', async () => {
      const user = await newUser({ status: 'invited', password: undefined });
      await anon().post(LOGIN).send({ email: user.email, password: PASSWORD }).expect(401);
    });

    it('signs in a platform admin with the platform permissions and no organization', async () => {
      const user = await newUser({}, null);
      const { me } = await signIn(user.email);
      expect(me).toMatchObject({
        isPlatformAdmin: true,
        organization: null,
        permissions: [...PLATFORM_PERMISSIONS],
      });
    });

    it('allows 10 sign-in attempts per minute per address', async () => {
      for (let i = 0; i < 10; i += 1) {
        await anon()
          .post(LOGIN)
          .send({ email: `x${i}-${uniqueSuffix()}@example.test`, password: 'x' })
          .expect(401);
      }
      const response = await anon()
        .post(LOGIN)
        .send({ email: 'x@example.test', password: 'x' })
        .expect(429);
      expect(response.body).toMatchObject({ code: 'RATE_LIMITED' });
    });
  });

  describe('sessions', () => {
    it('rejects requests without a session', async () => {
      const response = await anon().get('/api/v1/me').expect(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('issues a new session at sign-in, so a planted session id is never adopted', async () => {
      // An attacker's own valid session cookie, planted in the victim's browser.
      const attacker = await newUser();
      const victim = await newUser();
      const planted = await signIn(attacker.email);
      const plantedId = sessionIdOf(planted.response);
      // The victim signs in from that browser (same cookie jar).
      const response = await planted.agent
        .post(LOGIN)
        .send({ email: victim.email, password: PASSWORD })
        .expect(200);
      const newId = sessionIdOf(response);
      expect(newId).not.toBe('');
      expect(newId).not.toBe(plantedId);
      expect((response.body as MeResponse).id).toBe(victim.id);
      // The planted id no longer opens anything: the old session was replaced, not reused.
      expect(await redis.exists(`${SESSION_PREFIX}${plantedId}`)).toBe(0);
      const cookie = [planted.response.headers['set-cookie'] ?? []].flat()[0]?.split(';')[0] ?? '';
      await request(server()).get('/api/v1/me').set('Cookie', cookie).expect(401);
    });

    it('requires the CSRF token on state-changing requests', async () => {
      const user = await newUser();
      const { agent, me } = await signIn(user.email);
      const missing = await agent.patch('/api/v1/me').send({ language: 'en' }).expect(403);
      expect(missing.body).toMatchObject({ code: 'FORBIDDEN', details: { reason: 'csrf' } });
      await agent
        .patch('/api/v1/me')
        .set('X-CSRF-Token', 'not-the-token')
        .send({ language: 'en' })
        .expect(403);
      await agent
        .patch('/api/v1/me')
        .set('X-CSRF-Token', me.csrfToken)
        .send({ language: 'en' })
        .expect(200);
    });

    it('renews the idle timeout on every request and ends the session once it lapses', async () => {
      const user = await newUser();
      const { agent, response } = await signIn(user.email);
      const key = `${SESSION_PREFIX}${sessionIdOf(response)}`;

      await redis.expire(key, 60);
      await agent.get('/api/v1/me').expect(200);
      expect(await redis.ttl(key)).toBeGreaterThan(14 * 60); // rolling: back to 15 minutes

      await redis.pexpire(key, 1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const expired = await agent.get('/api/v1/me').expect(401);
      expect(expired.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('ends the session of a user deactivated during it', async () => {
      const user = await newUser();
      const { agent, response } = await signIn(user.email);
      await agent.get('/api/v1/me').expect(200);
      expect(await redis.ttl(`authz:${user.id}`)).toBeLessThanOrEqual(AUTH_CACHE_SECONDS);

      await owner.user.update({ where: { id: user.id }, data: { status: 'deactivated' } });
      await app.get(AuthStateService).invalidateUser(user.id); // what the users API does (step 14)

      await agent.get('/api/v1/me').expect(401);
      expect(await redis.exists(`${SESSION_PREFIX}${sessionIdOf(response)}`)).toBe(0);
      await agent.get('/api/v1/me').expect(401);
    });

    it('ends sessions when the organization is suspended during them', async () => {
      const org = await createOrganization(owner);
      orgIds.push(org);
      const user = await newUser({}, org);
      const { agent } = await signIn(user.email);
      await owner.organization.update({ where: { id: org }, data: { status: 'suspended' } });
      await app.get(AuthStateService).invalidateOrg(org);
      await agent.get('/api/v1/me').expect(401);
    });

    it('signs out', async () => {
      const user = await newUser();
      const { agent, me, response } = await signIn(user.email);
      await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', me.csrfToken).expect(204);
      expect(await redis.exists(`${SESSION_PREFIX}${sessionIdOf(response)}`)).toBe(0);
      await agent.get('/api/v1/me').expect(401);
      expect(
        await owner.auditLog.count({ where: { action: 'auth.logout', entityId: user.id } }),
      ).toBe(1);
    });
  });

  describe('profile', () => {
    it('updates name, language and theme, and audits the change', async () => {
      const user = await newUser();
      const { agent, me } = await signIn(user.email);
      const response = await agent
        .patch('/api/v1/me')
        .set('X-CSRF-Token', me.csrfToken)
        .send({ fullName: 'Asha Mwinyi', language: 'en', themePreference: 'dark' })
        .expect(200);
      expect(response.body).toMatchObject({
        fullName: 'Asha Mwinyi',
        language: 'en',
        themePreference: 'dark',
      });
      const entry = await owner.auditLog.findFirst({
        where: { action: 'me.update', entityId: user.id },
      });
      expect(entry).toMatchObject({
        before: { fullName: 'Test User', language: 'sw', themePreference: 'system' },
        after: { fullName: 'Asha Mwinyi', language: 'en', themePreference: 'dark' },
      });
    });

    it('changes the password, rejecting a wrong current one, the policy and reuse', async () => {
      const user = await newUser();
      const { agent, me } = await signIn(user.email);
      const other = await signIn(user.email); // a second session on another device
      const change = (currentPassword: string, newPassword: string) =>
        agent
          .post('/api/v1/me/password')
          .set('X-CSRF-Token', me.csrfToken)
          .send({ currentPassword, newPassword });

      expect((await change('Wrong12345', 'Mpya2027Siri')).body).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect((await change(PASSWORD, 'short')).status).toBe(400);
      expect((await change(PASSWORD, PASSWORD)).body).toMatchObject({ code: 'PASSWORD_REUSED' });

      await change(PASSWORD, 'Mpya2027Siri').expect(204);
      await agent.get('/api/v1/me').expect(200); // this session continues
      await other.agent.get('/api/v1/me').expect(401); // other sessions end
      await anon().post(LOGIN).send({ email: user.email, password: PASSWORD }).expect(401);
      await signIn(user.email, 'Mpya2027Siri');

      // The previous password is now in the history and cannot come back.
      const again = await signIn(user.email, 'Mpya2027Siri');
      await again.agent
        .post('/api/v1/me/password')
        .set('X-CSRF-Token', again.me.csrfToken)
        .send({ currentPassword: 'Mpya2027Siri', newPassword: 'Mpya2027Siri' })
        .expect(422);
    });
  });
});

export type { TestAgent };
