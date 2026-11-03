import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PRODUCT_NAME } from '@vote-kidigit/shared';
import { ApiModule } from './api.module.js';

const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiModule);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  // Validated configuration replaces process.env in step 3.
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  await app.listen(port);
  Logger.log(`${PRODUCT_NAME} API listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
