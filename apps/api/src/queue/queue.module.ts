import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';
import type { Env } from '../config/env.schema.js';

/** Queue names (Backend Schema 7.9: sms, email, reports, imports, schedule). */
export const EMAIL_QUEUE = 'email';
export const IMPORTS_QUEUE = 'imports';
export const SCHEDULE_QUEUE = 'schedule';
export const SMS_QUEUE = 'sms';

/** ioredis options from REDIS_URL, as BullMQ needs (it creates its own connections). */
export function redisOptionsFromUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    // Required by BullMQ workers: commands wait for the connection instead of failing.
    maxRetriesPerRequest: null,
  };
}

/**
 * BullMQ queues on Redis (Tech Stack 6.1). The API adds jobs; the worker (WorkerModule) runs
 * their processors. Jobs are removed when done and after their last failed attempt, because
 * email jobs can carry link tokens.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: redisOptionsFromUrl(config.get('REDIS_URL', { infer: true })),
        prefix: config.get('QUEUE_PREFIX', { infer: true }),
      }),
    }),
    BullModule.registerQueue({
      name: EMAIL_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    }),
    // Validation and import are deterministic: a failure is recorded on the import, not retried.
    BullModule.registerQueue({
      name: IMPORTS_QUEUE,
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    }),
    // One job per message (PRD SMS-07): up to 3 automatic retries with growing waits.
    BullModule.registerQueue({
      name: SMS_QUEUE,
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    }),
    // The 1-minute sweep (Backend Schema 11.9); a missed run is simply done by the next one.
    BullModule.registerQueue({
      name: SCHEDULE_QUEUE,
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
