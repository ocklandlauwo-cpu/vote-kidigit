// Integration test: needs Redis from docker-compose.dev.yml (or the CI service) and apps/api/.env.
import { ConfigService } from '@nestjs/config';
import '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { RedisService } from './redis.service.js';

function configWithRedisUrl(url: string): ConfigService<Env, true> {
  return { get: () => url } as unknown as ConfigService<Env, true>;
}

// Importing the config module above has loaded apps/api/.env into process.env.
const redisUrl = process.env.REDIS_URL ?? '';

describe('RedisService', () => {
  it('connects and answers PING', async () => {
    const redis = new RedisService(configWithRedisUrl(redisUrl));
    await redis.onModuleInit();
    expect(await redis.isHealthy()).toBe(true);
    await redis.onModuleDestroy();
  });

  it('fails fast with a clear message, without the password, when the password is wrong', async () => {
    const wrong = new URL(redisUrl);
    wrong.password = 'definitely-wrong-password';
    const redis = new RedisService(configWithRedisUrl(wrong.toString()));

    const failure = redis.onModuleInit();
    await expect(failure).rejects.toThrow(
      `Cannot connect to Redis at ${wrong.hostname}:${wrong.port}/0: WRONGPASS`,
    );
    await expect(failure).rejects.not.toThrow('definitely-wrong-password');
    await redis.onModuleDestroy();
  });

  it('fails fast when nothing listens at REDIS_URL', async () => {
    const redis = new RedisService(configWithRedisUrl('redis://:pw@127.0.0.1:1/0'));
    await expect(redis.onModuleInit()).rejects.toThrow(
      'Cannot connect to Redis at 127.0.0.1:1/0: connect ECONNREFUSED',
    );
    await redis.onModuleDestroy();
  });
});
