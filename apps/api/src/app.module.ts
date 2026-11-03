import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './redis/redis.module.js';

/**
 * Providers shared by the HTTP API and the worker: validated configuration, PostgreSQL
 * (as vk_api) and Redis. Audit (step 8) and feature services join in later steps.
 */
@Module({
  imports: [AppConfigModule, DatabaseModule, RedisModule],
})
export class AppModule {}
