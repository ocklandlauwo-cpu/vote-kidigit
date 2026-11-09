import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { FilesModule } from '../files/files.module.js';
import { AuditController, OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';

/** The caller's organization: settings, logo, onboarding and audit log. */
@Module({
  imports: [AuthModule, FilesModule],
  controllers: [OrganizationController, AuditController],
  providers: [OrganizationService],
})
export class OrganizationModule {}
