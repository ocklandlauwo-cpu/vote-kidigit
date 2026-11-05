import { Global, Module } from '@nestjs/common';
import { AuditQueryService } from './audit-query.service.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({
  providers: [AuditService, AuditQueryService],
  exports: [AuditService, AuditQueryService],
})
export class AuditModule {}
