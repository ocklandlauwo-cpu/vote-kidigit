import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import {
  type AuditPage,
  OrgAuditQuerySchema,
  type OrganizationSettings,
  UpdateOrganizationSettingsRequestSchema,
} from '@vote-kidigit/shared';
import { RequirePermission, SignedIn } from '../../auth/decorators.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import { OrganizationService } from './organization.service.js';

class UpdateOrganizationBody extends zodDto(UpdateOrganizationSettingsRequestSchema) {}
class OrgAuditQuery extends zodDto(OrgAuditQuerySchema) {}

/** The caller's organization (Backend Schema 12.4). The logo upload arrives in step 17. */
@Controller('v1/organization')
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  /** GET /api/v1/organization */
  @Get()
  @SignedIn()
  get(): Promise<OrganizationSettings> {
    return this.organization.get();
  }

  /** PATCH /api/v1/organization */
  @Patch()
  @RequirePermission('org.settings.manage')
  update(@Body() body: UpdateOrganizationBody): Promise<OrganizationSettings> {
    return this.organization.update(body);
  }
}

/** SYS-01 audit log of the organization. Excel export arrives with report jobs (step 39). */
@Controller('v1/audit')
export class AuditController {
  constructor(private readonly organization: OrganizationService) {}

  /** GET /api/v1/audit */
  @Get()
  @RequirePermission('audit.view.org')
  list(@Query() query: OrgAuditQuery): Promise<AuditPage> {
    return this.organization.auditLog(query);
  }
}
