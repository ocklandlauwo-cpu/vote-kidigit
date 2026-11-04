import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { ZodValidationPipe } from './common/zod-validation.pipe.js';
import { RequestContextMiddleware } from './context/request-context.middleware.js';
import { HealthModule } from './health/health.module.js';
import { AccessLogMiddleware } from './logging/access-log.middleware.js';
import { ThrottlingModule } from './throttling/throttling.module.js';

/**
 * HTTP entry (vk-api): controllers for the staff portal, voter API, USSD and webhooks, with the
 * cross-cutting HTTP behaviour of Backend Schema 12.1: { code, message, details } errors, Zod
 * validation, rate limits, request context and access logs.
 */
@Module({
  imports: [AppModule, ThrottlingModule, HealthModule],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // The context starts first, so the access log line carries the request ID.
    consumer
      .apply(RequestContextMiddleware, AccessLogMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
