// Integration test of the HTTP pipeline (Implementation Plan step 8): error format, Zod
// validation, database error mapping, rate limiting, security headers and log redaction.
import { Public } from '../auth/decorators.js';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import request from 'supertest';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { zodDto } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { platformContext } from '../testing/db.js';
import { createTestHttpApp } from '../testing/http.js';

const VOTING_CODE = 'K7M4-Q9XR';
const PASSWORD = 'S3cret!Passw0rd';

class ProbeBody extends zodDto(
  z.object({ name: z.string().min(2), count: z.coerce.number().int().positive() }),
) {}

@Public()
@Controller('probe')
class ProbeController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('validate')
  validate(@Body() body: ProbeBody): ProbeBody {
    return body;
  }

  @Get('app-error')
  appError(): never {
    throw new AppError('EVENT_LOCKED', undefined, { eventId: 'e-1' });
  }

  @Post('crash')
  crash(@Body() body: { code?: string }): never {
    // An unexpected error whose message contains user input
    throw new Error(`could not handle code ${body.code ?? ''}`);
  }

  @Get('db-rule')
  async dbRule(): Promise<void> {
    await this.prisma.withContext(
      platformContext(),
      (tx) =>
        tx.$executeRaw`DO $$ BEGIN RAISE EXCEPTION 'VOTING_CLOSED' USING ERRCODE = 'P0001'; END $$`,
    );
  }

  @Get('token/:token')
  token(@Param('token') token: string): { length: number } {
    return { length: token.length };
  }

  @Get('limited')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  limited(): { ok: true } {
    return { ok: true };
  }
}

describe('HTTP pipeline', () => {
  let app: NestExpressApplication;
  let logs: string[];
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, logs } = await createTestHttpApp([ProbeController]));
    // Start from clean rate-limit counters for this client.
    const redis = app.get(RedisService);
    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('error format (Backend Schema 12.1)', () => {
    it('returns an AppError as { code, message, details } with its status', async () => {
      const response = await http().get('/api/probe/app-error').expect(409);
      expect(response.body).toEqual({
        code: 'EVENT_LOCKED',
        message: 'The event is published and can no longer be changed.',
        details: { eventId: 'e-1' },
      });
    });

    it('validates bodies with Zod and lists the issues without echoing input', async () => {
      const response = await http()
        .post('/api/probe/validate')
        .send({ name: 'x', count: 'many', secret: 'should-not-come-back' })
        .expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      const body = response.body as { details: { source: string; issues: { path: string }[] } };
      expect(body.details.source).toBe('body');
      expect(body.details.issues.map((i) => i.path).sort()).toEqual(['count', 'name']);
      expect(JSON.stringify(response.body)).not.toContain('should-not-come-back');
    });

    it('returns the parsed, coerced and stripped body when valid', async () => {
      const response = await http()
        .post('/api/probe/validate')
        .send({ name: 'Asha', count: '3', extra: 'dropped' })
        .expect(201);
      expect(response.body).toEqual({ name: 'Asha', count: 3 });
    });

    it('answers unknown routes with 404 NOT_FOUND', async () => {
      const response = await http().get('/api/no-such-route').expect(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('answers malformed JSON with 400 VALIDATION_FAILED, not the parser message', async () => {
      const response = await http()
        .post('/api/probe/validate')
        .set('Content-Type', 'application/json')
        .send(`{"code":"${VOTING_CODE}",`)
        .expect(400);
      expect(response.body).toEqual({
        code: 'VALIDATION_FAILED',
        message: 'The request is not valid.',
      });
    });

    it('hides unexpected errors behind 500 INTERNAL', async () => {
      const response = await http()
        .post('/api/probe/crash')
        .send({ code: VOTING_CODE })
        .expect(500);
      expect(response.body).toEqual({
        code: 'INTERNAL',
        message: 'Something went wrong on our side.',
      });
    });

    it('maps database rule violations (P0001) to their error code', async () => {
      const response = await http().get('/api/probe/db-rule').expect(409);
      expect(response.body).toMatchObject({ code: 'VOTING_CLOSED' });
    });
  });

  describe('security headers and request ids', () => {
    it('sends Helmet headers and the request id', async () => {
      const response = await http().get('/api/health').expect(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('rate limiting', () => {
    it('returns 429 RATE_LIMITED with Retry-After once the limit is passed', async () => {
      for (let i = 0; i < 3; i += 1) await http().get('/api/probe/limited').expect(200);
      const response = await http().get('/api/probe/limited').expect(429);
      expect(response.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('does not rate limit health checks', async () => {
      for (let i = 0; i < 5; i += 1) await http().get('/api/health').expect(200);
    });
  });

  describe('log redaction', () => {
    it('never writes request bodies, voting codes or passwords to the logs', async () => {
      logs.length = 0;
      await http()
        .post('/api/probe/crash')
        .set('X-Request-Id', 'redaction-test-1')
        .send({ code: VOTING_CODE, password: PASSWORD, note: 'hello' })
        .expect(500);
      await http()
        .post('/api/probe/validate')
        .send({ name: VOTING_CODE.replace('-', ''), count: 'x', password: PASSWORD })
        .expect(400);

      const output = logs.join('');
      expect(output).toContain('redaction-test-1'); // the request was logged…
      expect(output).toContain('"status":500');
      expect(output).toContain('"errorCode":"VALIDATION_FAILED"'); // error codes stay readable
      expect(output).not.toContain(VOTING_CODE); // …without its secrets
      expect(output).not.toContain(VOTING_CODE.replace('-', ''));
      expect(output).not.toContain(PASSWORD);
      expect(output).not.toContain('hello');
      for (const line of logs) expect(() => JSON.parse(line) as unknown).not.toThrow();
    });

    it('logs paths without long tokens or query strings', async () => {
      logs.length = 0;
      const token = 'x'.repeat(43);
      await http().get(`/api/probe/token/${token}?email=someone@example.test`).expect(200);
      const output = logs.join('');
      expect(output).toContain('/api/probe/token/[redacted]');
      expect(output).not.toContain(token);
      expect(output).not.toContain('someone@example.test');
    });
  });
});
