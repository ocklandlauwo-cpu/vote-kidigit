import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PRODUCT_NAME } from '@vote-kidigit/shared';
import { errorReason } from './common/connection-errors.js';
import type { Env } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  // Imported here so configuration errors raised while loading modules are reported below.
  const { ApiModule } = await import('./api.module.js');
  const app = await NestFactory.create(ApiModule, { abortOnError: false });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const port = app.get(ConfigService<Env, true>).get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`${PRODUCT_NAME} API listening on port ${port}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(`API failed to start. ${errorReason(error)}`, 'Bootstrap');
  process.exit(1);
});
