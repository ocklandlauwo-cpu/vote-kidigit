import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { AuditController, OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';

/** The caller's organization: settings, onboarding and audit log. */
@Module({
  imports: [AuthModule],
  controllers: [OrganizationController, AuditController],
  providers: [OrganizationService],
})
export class OrganizationModule {}
