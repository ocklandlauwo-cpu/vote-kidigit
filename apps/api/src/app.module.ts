import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { RequestContextModule } from './context/request-context.module.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './redis/redis.module.js';

/**
 * Providers shared by the HTTP API and the worker: validated configuration, the request
 * context, PostgreSQL (as vk_api) and Redis. Audit (step 8) and feature services join later.
 */
@Module({
  imports: [AppConfigModule, RequestContextModule, DatabaseModule, RedisModule],
})
export class AppModule {}
