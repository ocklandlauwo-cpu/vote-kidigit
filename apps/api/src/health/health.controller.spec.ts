// Integration test: boots the HTTP API against the local PostgreSQL and Redis.
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createOrganization, deleteOrganizations, ownerClient } from '../testing/db.js';
import { PrismaService } from '../database/prisma.service.js';
import { createTestHttpApp } from '../testing/http.js';

describe('GET /api/health', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 when PostgreSQL and Redis are reachable', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns 503 without details when the database is unavailable', async () => {
    const prisma = app.get(PrismaService);
    const spy = jest.spyOn(prisma, 'isHealthy').mockResolvedValueOnce(false);
    const response = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(response.body).toMatchObject({ status: 'unavailable' });
    expect(JSON.stringify(response.body)).not.toMatch(/postgres|redis|vk_api/i);
    spy.mockRestore();
  });
});

describe('GET /api/health/live-events', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the number of open events with the deploy secret', async () => {
    // Other test files open events in parallel, so the count is checked against this one.
    const owner = ownerClient();
    const orgId = await createOrganization(owner, 'Uchaguzi wa Afya');
    try {
      await owner.votingEvent.create({
        data: {
          organizationId: orgId,
          name: 'AGM 2027',
          status: 'open',
          startAt: new Date(Date.now() - 3_600_000),
          endAt: new Date(Date.now() + 3_600_000),
        },
      });
      const response = await request(app.getHttpServer())
        .get('/api/health/live-events')
        .set('X-Deploy-Secret', process.env.DEPLOY_HEALTH_SECRET ?? '')
        .expect(200);
      const { openEvents } = response.body as { openEvents: number };
      expect(Number.isInteger(openEvents) && openEvents >= 1).toBe(true);
    } finally {
      await deleteOrganizations(owner, [orgId]);
      await owner.$disconnect();
    }
  });

  it.each([
    ['missing', undefined],
    ['wrong', 'not-the-secret'],
  ])('hides the endpoint when the secret is %s', async (_case, secret) => {
    const call = request(app.getHttpServer()).get('/api/health/live-events');
    const response = await (secret ? call.set('X-Deploy-Secret', secret) : call).expect(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
