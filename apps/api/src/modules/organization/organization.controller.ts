import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type AuditPage,
  OrgAuditQuerySchema,
  type OrganizationSettings,
  UpdateOrganizationSettingsRequestSchema,
  UPLOAD_FIELD,
} from '@vote-kidigit/shared';
import { RequirePermission, SignedIn } from '../../auth/decorators.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import type { Upload } from '../files/files.service.js';
import { OrganizationService } from './organization.service.js';

class UpdateOrganizationBody extends zodDto(UpdateOrganizationSettingsRequestSchema) {}
class OrgAuditQuery extends zodDto(OrgAuditQuerySchema) {}

/** The caller's organization (Backend Schema 12.4). */
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

  /** POST /api/v1/organization/logo — multipart field "file": JPG or PNG up to 2 MB (SYS-03). */
  @Post('logo')
  @RequirePermission('org.settings.manage')
  @UseInterceptors(FileInterceptor(UPLOAD_FIELD))
  uploadLogo(@UploadedFile() file: Upload | undefined): Promise<OrganizationSettings> {
    return this.organization.uploadLogo(file);
  }

  /** DELETE /api/v1/organization/logo — the "Remove" button of the logo field. */
  @Delete('logo')
  @RequirePermission('org.settings.manage')
  removeLogo(): Promise<OrganizationSettings> {
    return this.organization.removeLogo();
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
