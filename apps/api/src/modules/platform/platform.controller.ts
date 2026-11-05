import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type AuditPage,
  CreateOrganizationRequestSchema,
  type CreateOrganizationResponse,
  type OrganizationDetail,
  OrganizationListQuerySchema,
  type OrganizationPage,
  PlatformAuditQuerySchema,
  type PlatformDashboard,
  type PlatformSettings,
  ReactivateOrganizationRequestSchema,
  SuspendOrganizationRequestSchema,
  UpdateOrganizationRequestSchema,
  UpdatePlatformSettingsRequestSchema,
} from '@vote-kidigit/shared';
import { AuditQueryService } from '../../audit/audit-query.service.js';
import { RequirePermission } from '../../auth/decorators.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import { OrganizationsService } from './organizations.service.js';
import { PlatformSettingsService } from './platform-settings.service.js';

class OrganizationListQuery extends zodDto(OrganizationListQuerySchema) {}
class CreateOrganizationBody extends zodDto(CreateOrganizationRequestSchema) {}
class UpdateOrganizationBody extends zodDto(UpdateOrganizationRequestSchema) {}
class SuspendOrganizationBody extends zodDto(SuspendOrganizationRequestSchema) {}
class ReactivateOrganizationBody extends zodDto(ReactivateOrganizationRequestSchema) {}
class UpdatePlatformSettingsBody extends zodDto(UpdatePlatformSettingsRequestSchema) {}
class PlatformAuditQuery extends zodDto(PlatformAuditQuerySchema) {}

/**
 * Platform Super Admin endpoints (Backend Schema 12.3). Every route needs a platform
 * permission, so other users get 404 (PermissionGuard).
 */
@Controller('v1/platform')
export class PlatformController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly settings: PlatformSettingsService,
    private readonly auditQuery: AuditQueryService,
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /api/v1/platform/dashboard */
  @Get('dashboard')
  @RequirePermission('platform.orgs.manage')
  dashboard(): Promise<PlatformDashboard> {
    return this.organizations.dashboard();
  }

  /** GET /api/v1/platform/organizations */
  @Get('organizations')
  @RequirePermission('platform.orgs.manage')
  list(@Query() query: OrganizationListQuery): Promise<OrganizationPage> {
    return this.organizations.list(query);
  }

  /** POST /api/v1/platform/organizations */
  @Post('organizations')
  @RequirePermission('platform.orgs.manage')
  create(@Body() body: CreateOrganizationBody): Promise<CreateOrganizationResponse> {
    return this.organizations.create(body);
  }

  /** GET /api/v1/platform/organizations/:orgId */
  @Get('organizations/:orgId')
  @RequirePermission('platform.orgs.manage')
  detail(@Param('orgId', IdParamPipe) orgId: string): Promise<OrganizationDetail> {
    return this.organizations.detail(orgId);
  }

  /** PATCH /api/v1/platform/organizations/:orgId */
  @Patch('organizations/:orgId')
  @RequirePermission('platform.orgs.manage')
  update(
    @Param('orgId', IdParamPipe) orgId: string,
    @Body() body: UpdateOrganizationBody,
  ): Promise<OrganizationDetail> {
    return this.organizations.update(orgId, body);
  }

  /** POST /api/v1/platform/organizations/:orgId/suspend */
  @Post('organizations/:orgId/suspend')
  @HttpCode(200)
  @RequirePermission('platform.orgs.manage')
  suspend(
    @Param('orgId', IdParamPipe) orgId: string,
    @Body() body: SuspendOrganizationBody,
  ): Promise<OrganizationDetail> {
    return this.organizations.suspend(orgId, body);
  }

  /** POST /api/v1/platform/organizations/:orgId/reactivate */
  @Post('organizations/:orgId/reactivate')
  @HttpCode(200)
  @RequirePermission('platform.orgs.manage')
  reactivate(
    @Param('orgId', IdParamPipe) orgId: string,
    @Body() body: ReactivateOrganizationBody,
  ): Promise<OrganizationDetail> {
    return this.organizations.reactivate(orgId, body);
  }

  /** POST /api/v1/platform/organizations/:orgId/resend-invite */
  @Post('organizations/:orgId/resend-invite')
  @HttpCode(200)
  @RequirePermission('platform.orgs.manage')
  resendInvite(@Param('orgId', IdParamPipe) orgId: string): Promise<{ invitationSent: boolean }> {
    return this.organizations.resendInvite(orgId);
  }

  /** GET /api/v1/platform/settings */
  @Get('settings')
  @RequirePermission('platform.settings.manage')
  getSettings(): Promise<PlatformSettings> {
    return this.settings.get();
  }

  /** PATCH /api/v1/platform/settings */
  @Patch('settings')
  @RequirePermission('platform.settings.manage')
  updateSettings(@Body() body: UpdatePlatformSettingsBody): Promise<PlatformSettings> {
    return this.settings.update(body);
  }

  /** GET /api/v1/platform/audit (PLT-05): every organization, with an Organization filter. */
  @Get('audit')
  @RequirePermission('platform.audit.view')
  audit(@Query() query: PlatformAuditQuery): Promise<AuditPage> {
    const { userId, requestId } = this.requestContext.getOrThrow();
    const { organizationId, ...filter } = query;
    return this.prisma.withContext(
      { orgId: null, userId, isPlatformAdmin: true, requestId },
      (tx) =>
        this.auditQuery.list(tx, {
          ...filter,
          ...(organizationId && {
            organizationId: organizationId === 'platform' ? null : organizationId,
          }),
        }),
    );
  }
}
