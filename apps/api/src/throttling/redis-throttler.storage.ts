import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import type Redis from 'ioredis';

/** Redis key prefix for rate-limit counters (Backend Schema 7.9: rl:{scope}:{key}). */
export const RATE_LIMIT_PREFIX = 'rl';

/**
 * Atomic fixed-window counter with blocking. Returns [hits, hitsTtlMs, blocked (0/1), blockTtlMs].
 * KEYS[1] = hit counter, KEYS[2] = block marker; ARGV = ttlMs, limit, blockMs.
 */
const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or ARGV[2])
  return { hits, redis.call('PTTL', KEYS[1]), 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local hitsTtl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return { hits, hitsTtl, 1, tonumber(ARGV[3]) }
end
return { hits, hitsTtl, 0, 0 }
`;

/**
 * Rate-limit storage shared by all API processes (Tech Stack 6.1: a small custom Redis storage
 * on ioredis for @nestjs/throttler). Times returned to the guard are in seconds.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${RATE_LIMIT_PREFIX}:${throttlerName}:${key}`;
    const [hits, hitsTtl, blocked, blockTtl] = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      `${base}:hits`,
      `${base}:block`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];

    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(hitsTtl / 1000)),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(blockTtl / 1000)),
    };
  }
}
