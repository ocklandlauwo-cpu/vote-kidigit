import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ApiModule } from '../api.module.js';
import { type RequestContext, RequestContextService } from './request-context.js';

@Controller('context-probe')
class ContextProbeController {
  constructor(private readonly requestContext: RequestContextService) {}

  @Get()
  async probe(): Promise<RequestContext> {
    // Read after an await: the context must survive asynchronous work.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return this.requestContext.getOrThrow();
  }
}

@Module({ imports: [ApiModule], controllers: [ContextProbeController] })
class ProbeModule {}

describe('RequestContextService', () => {
  const service = new RequestContextService();
  const ctx = (requestId: string): RequestContext => ({
    requestId,
    orgId: null,
    userId: null,
    isPlatformAdmin: false,
  });

  it('has no context outside run()', () => {
    expect(service.get()).toBeUndefined();
    expect(() => service.getOrThrow()).toThrow('No request context');
  });

  it('keeps concurrent runs apart across awaits', async () => {
    const seen = await Promise.all(
      ['a', 'b', 'c'].map((id, i) =>
        service.run(ctx(id), async () => {
          await new Promise((resolve) => setTimeout(resolve, 10 - i * 3));
          return service.getOrThrow().requestId;
        }),
      ),
    );
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});

describe('RequestContextMiddleware', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts an anonymous context with a new request id for every request', async () => {
    const [first, second] = await Promise.all([
      request(app.getHttpServer()).get('/api/context-probe').expect(200),
      request(app.getHttpServer()).get('/api/context-probe').expect(200),
    ]);
    const body = first.body as RequestContext;
    expect(body).toMatchObject({ orgId: null, userId: null, isPlatformAdmin: false });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.headers['x-request-id']).toBe(body.requestId);
    expect((second.body as RequestContext).requestId).not.toBe(body.requestId);
  });

  it('keeps a safe caller-supplied request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/context-probe')
      .set('X-Request-Id', 'edge-1234.abc_9')
      .expect(200);
    expect((response.body as RequestContext).requestId).toBe('edge-1234.abc_9');
  });

  it.each([
    ['spaces and markup', 'bad id <script>alert(1)</script>'],
    ['too long', 'a'.repeat(65)],
    ['too short', 'abc'],
  ])('replaces an unsafe caller-supplied request id (%s)', async (_case, supplied) => {
    const response = await request(app.getHttpServer())
      .get('/api/context-probe')
      .set('X-Request-Id', supplied)
      .expect(200);
    const { requestId } = response.body as RequestContext;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-request-id']).toBe(requestId);
  });

  it('also covers routes under the global prefix such as /api/health', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
