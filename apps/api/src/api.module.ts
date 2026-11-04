import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { CsrfGuard } from './auth/csrf.guard.js';
import { SessionThrottlerGuard } from './auth/session-throttler.guard.js';
import { SessionService } from './auth/session.service.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { ZodValidationPipe } from './common/zod-validation.pipe.js';
import { RequestContextMiddleware } from './context/request-context.middleware.js';
import { HealthModule } from './health/health.module.js';
import { AccessLogMiddleware } from './logging/access-log.middleware.js';
import { ThrottlingModule } from './throttling/throttling.module.js';

/**
 * HTTP entry (vk-api): controllers for the staff portal, voter API, USSD and webhooks, with the
 * cross-cutting HTTP behaviour of Backend Schema 12.1: { code, message, details } errors, Zod
 * validation, rate limits, staff sessions, CSRF, request context and access logs.
 *
 * Global guards run in this order: rate limit (per session or IP) → staff session (unless
 * @Public) → CSRF on state-changing requests with a session.
 */
@Module({
  imports: [AppModule, ThrottlingModule, AuthModule, HealthModule],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useExisting: SessionThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useExisting: CsrfGuard },
  ],
})
export class ApiModule implements NestModule {
  constructor(private readonly sessions: SessionService) {}

  configure(consumer: MiddlewareConsumer): void {
    // The context starts first, so the access log line carries the request ID; the session
    // (one shared instance and Redis connection) is loaded before guards run.
    consumer
      .apply(
        RequestContextMiddleware,
        AccessLogMiddleware,
        (req: Request, res: Response, next: NextFunction) => this.sessions.use(req, res, next),
      )
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
