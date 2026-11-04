import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisService } from '../redis/redis.service.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/** Global limit (Backend Schema 12.1): 300 requests per minute per client. */
export const DEFAULT_LIMIT = { name: 'default', ttl: 60_000, limit: 300 } as const;

/**
 * Rate limiting for the HTTP API. The tracker is the client IP (trust proxy = 1); step 9
 * switches staff requests to their session. Sign-in and voter endpoints add stricter limits
 * with @Throttle; USSD and health routes skip limits with @SkipThrottle.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [DEFAULT_LIMIT],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
})
export class ThrottlingModule {}
