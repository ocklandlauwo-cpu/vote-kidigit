// Builds the HTTP API for tests exactly as main.ts does (prefix, trust proxy, Helmet, filters,
// pipes, guards, middleware), optionally with extra probe controllers, and captures log lines.
import { Module, type Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ApiModule } from '../api.module.js';
import { configureHttpApp } from '../http/configure-http-app.js';
import { JsonLogger } from '../logging/json-logger.js';

export interface TestHttpApp {
  app: NestExpressApplication;
  /** Every log line written since the app started (or since logs.length = 0). */
  logs: string[];
}

/** A provider replaced in the test app (e.g. a fake EventAccess). */
export interface ProviderOverride {
  provide: unknown;
  useValue: unknown;
}

export async function createTestHttpApp(
  controllers: Type[] = [],
  overrides: ProviderOverride[] = [],
): Promise<TestHttpApp> {
  @Module({ imports: [ApiModule], controllers })
  class TestRootModule {}

  const logs: string[] = [];
  let builder = Test.createTestingModule({ imports: [TestRootModule] });
  for (const { provide, useValue } of overrides) {
    builder = builder.overrideProvider(provide).useValue(useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: new JsonLogger('debug', (line) => logs.push(line)),
  });
  configureHttpApp(app);
  await app.init();
  return { app, logs };
}

/**
 * A random client address for one test. The API trusts one proxy hop, so sending it as
 * X-Forwarded-For makes it the client IP (as the DirectAdmin proxy does in production): each
 * test gets its own per-IP rate-limit counters, independent of tests running in parallel.
 */
export function testIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}
