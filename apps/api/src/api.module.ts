import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { RequestContextMiddleware } from './context/request-context.middleware.js';
import { HealthModule } from './health/health.module.js';

/** HTTP entry (vk-api): controllers for the staff portal, voter API, USSD and webhooks. */
@Module({
  imports: [AppModule, HealthModule],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every request gets a request context before guards and controllers run.
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
