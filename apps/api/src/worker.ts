import './instrument.js'; // Sentry, before anything else
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PRODUCT_NAME } from '@vote-kidigit/shared';
import { errorReason } from './common/connection-errors.js';
import { JsonLogger } from './logging/json-logger.js';

const logger = new JsonLogger();

async function bootstrap(): Promise<void> {
  // Imported here so configuration errors raised while loading modules are reported below.
  const { WorkerModule } = await import('./worker.module.js');
  // An application context only: the worker never opens an HTTP port.
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    abortOnError: false,
    logger,
  });
  app.enableShutdownHooks();
  logger.log(`${PRODUCT_NAME} worker started`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  logger.error(`Worker failed to start. ${errorReason(error)}`, undefined, 'Bootstrap');
  process.exit(1);
});
