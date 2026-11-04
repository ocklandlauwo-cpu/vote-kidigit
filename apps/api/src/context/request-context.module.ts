import { Global, Module } from '@nestjs/common';
import { RequestContextMiddleware } from './request-context.middleware.js';
import { RequestContextService } from './request-context.js';

@Global()
@Module({
  providers: [RequestContextService, RequestContextMiddleware],
  exports: [RequestContextService, RequestContextMiddleware],
})
export class RequestContextModule {}
