import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { OrganizationsService } from './organizations.service.js';
import { PlatformController } from './platform.controller.js';
import { PlatformSettingsService } from './platform-settings.service.js';

/** Platform Super Admin: organizations, platform settings and the platform audit log. */
@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [OrganizationsService, PlatformSettingsService],
})
export class PlatformModule {}
