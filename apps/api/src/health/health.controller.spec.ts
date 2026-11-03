// Integration test: boots the HTTP API against the local PostgreSQL and Redis.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ApiModule } from '../api.module.js';
import { PrismaService } from '../database/prisma.service.js';

describe('GET /api/health', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    app.setGlobalPrefix('api');
    await app.init();
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
