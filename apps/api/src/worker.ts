import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PRODUCT_NAME } from '@vote-kidigit/shared';
import { errorReason } from './common/connection-errors.js';

async function bootstrap(): Promise<void> {
  // Imported here so configuration errors raised while loading modules are reported below.
  const { WorkerModule } = await import('./worker.module.js');
  // An application context only: the worker never opens an HTTP port.
  const app = await NestFactory.createApplicationContext(WorkerModule, { abortOnError: false });
  app.enableShutdownHooks();
  Logger.log(`${PRODUCT_NAME} worker started`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(`Worker failed to start. ${errorReason(error)}`, 'Bootstrap');
  process.exit(1);
});
