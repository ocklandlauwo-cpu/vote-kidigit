import './instrument.js'; // Sentry, before anything else
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PRODUCT_NAME } from '@vote-kidigit/shared';
import { errorReason } from './common/connection-errors.js';
import type { Env } from './config/env.schema.js';
import { configureHttpApp } from './http/configure-http-app.js';
import { JsonLogger } from './logging/json-logger.js';

const logger = new JsonLogger();

async function bootstrap(): Promise<void> {
  // Imported here so configuration errors raised while loading modules are reported below.
  const { ApiModule } = await import('./api.module.js');
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
    abortOnError: false,
    logger,
  });
  configureHttpApp(app);
  app.enableShutdownHooks();

  const port = app.get(ConfigService<Env, true>).get('PORT', { infer: true });
  await app.listen(port);
  logger.log(`${PRODUCT_NAME} API listening on port ${port}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  logger.error(`API failed to start. ${errorReason(error)}`, undefined, 'Bootstrap');
  process.exit(1);
});
