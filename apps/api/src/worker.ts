import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PRODUCT_NAME } from '@vote-kidigit/shared';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  // An application context only: the worker never opens an HTTP port.
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log(`${PRODUCT_NAME} worker started`, 'Bootstrap');
}

void bootstrap();
