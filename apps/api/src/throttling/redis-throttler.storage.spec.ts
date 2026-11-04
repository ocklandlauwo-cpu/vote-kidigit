// Integration test against the local Redis: the shared rate-limit counter.
import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { RedisService } from '../redis/redis.service.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

describe('RedisThrottlerStorage', () => {
  const redis = new RedisService({
    get: () => process.env.REDIS_URL ?? '',
  } as unknown as ConfigService<Env, true>);
  const storage = new RedisThrottlerStorage(redis);

  beforeAll(() => redis.onModuleInit());
  afterAll(() => redis.onModuleDestroy());

  it('counts hits in a window and blocks once the limit is passed', async () => {
    const key = randomUUID();
    const first = await storage.increment(key, 60_000, 2, 30_000, 'test');
    const second = await storage.increment(key, 60_000, 2, 30_000, 'test');
    const third = await storage.increment(key, 60_000, 2, 30_000, 'test');
    const fourth = await storage.increment(key, 60_000, 2, 30_000, 'test');

    expect(first).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(first.timeToExpire).toBeGreaterThan(55);
    expect(second).toMatchObject({ totalHits: 2, isBlocked: false });
    expect(third).toMatchObject({ totalHits: 3, isBlocked: true, timeToBlockExpire: 30 });
    expect(fourth.isBlocked).toBe(true);
    expect(await redis.exists(`rl:test:${key}:hits`, `rl:test:${key}:block`)).toBe(2);
  });

  it('keeps separate counters per key and throttler', async () => {
    const key = randomUUID();
    await storage.increment(key, 60_000, 1, 1_000, 'a');
    const other = await storage.increment(key, 60_000, 1, 1_000, 'b');
    expect(other).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('starts a new window when the old one expires', async () => {
    const key = randomUUID();
    await storage.increment(key, 50, 1, 50, 'short');
    await storage.increment(key, 50, 1, 50, 'short');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(await storage.increment(key, 50, 1, 50, 'short')).toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
  });
});
