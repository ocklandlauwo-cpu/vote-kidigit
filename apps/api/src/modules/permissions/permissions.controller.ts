import { Controller, Get } from '@nestjs/common';
import type { PermissionListResponse } from '@vote-kidigit/shared';
import { RequirePermission } from '../../auth/decorators.js';
import { PermissionsService } from './permissions.service.js';

@Controller('v1/permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  /** GET /api/v1/permissions — the catalogue for the role editor (Backend Schema 12.3). */
  @Get()
  @RequirePermission('roles.manage')
  async list(): Promise<PermissionListResponse> {
    return { items: await this.permissions.list() };
  }
}
