import { Injectable } from '@nestjs/common';
import type {
  AuditPage,
  OnboardingItem,
  OrgAuditQuery,
  OrganizationSettings,
  UpdateOrganizationSettingsRequest,
} from '@vote-kidigit/shared';
import { fileUrl, onboardingItems } from '@vote-kidigit/shared';
import { AuditQueryService } from '../../audit/audit-query.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuthStateService } from '../../auth/auth-state.service.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import { FilesService, type Upload } from '../files/files.service.js';

/** Saving the Regional section confirms the time zone, even when it stays the same. */
export const TIME_ZONE_CONFIRMED = 'org.settings.timezone.confirm';

const settingsSelect = {
  id: true,
  name: true,
  slug: true,
  logoFileId: true,
  primaryColor: true,
  timeZone: true,
  contactEmail: true,
  contactPhone: true,
  smsSenderId: true,
  helpPhone: true,
  sessionTimeoutMinutes: true,
  archiveAfterDays: true,
  onboardingDismissedAt: true,
} as const;

/** The caller's own organization: settings (SYS-03), onboarding (App Flow 7.4), audit (SYS-01). */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auditQuery: AuditQueryService,
    private readonly authState: AuthStateService,
    private readonly requestContext: RequestContextService,
    private readonly files: FilesService,
  ) {}

  /** GET /organization (any signed-in staff user of an organization). */
  get(): Promise<OrganizationSettings> {
    return this.prisma.withContext(this.context(), (tx) => this.load(tx));
  }

  /** PATCH /organization: each SYS-03 section sends its own fields. */
  async update(body: UpdateOrganizationSettingsRequest): Promise<OrganizationSettings> {
    const ctx = this.context();
    const settings = await this.prisma.withContext(ctx, async (tx) => {
      const { onboardingDismissed, ...fields } = body;
      const before = await tx.organization.findUniqueOrThrow({
        where: { id: ctx.orgId },
        select: settingsSelect,
      });
      const after = await tx.organization.update({
        where: { id: ctx.orgId },
        data: {
          ...fields,
          ...(onboardingDismissed !== undefined && {
            onboardingDismissedAt: onboardingDismissed ? new Date() : null,
          }),
        },
        select: settingsSelect,
      });
      await this.audit.record(tx, {
        action: 'org.settings.update',
        entityType: 'organizations',
        entityId: ctx.orgId,
        before,
        after,
      });
      if (body.timeZone !== undefined) {
        await this.audit.record(tx, {
          action: TIME_ZONE_CONFIRMED,
          entityType: 'organizations',
          entityId: ctx.orgId,
          after: { timeZone: body.timeZone },
        });
      }
      return this.load(tx);
    });
    // Name, time zone and session timeout are part of every signed-in user's state.
    await this.authState.invalidateOrg(ctx.orgId);
    return settings;
  }

  /** POST /organization/logo: the new logo replaces the old one, whose file is deleted. */
  uploadLogo(upload: Upload | undefined): Promise<OrganizationSettings> {
    const ctx = this.context();
    return this.files.withImage('org_logo', upload, async (tx, file, discard) => {
      const before = await tx.organization.findUniqueOrThrow({
        where: { id: ctx.orgId },
        select: { logoFileId: true },
      });
      await tx.organization.update({ where: { id: ctx.orgId }, data: { logoFileId: file.id } });
      if (before.logoFileId) await discard(before.logoFileId);
      await this.audit.record(tx, {
        action: 'org.logo.update',
        entityType: 'organizations',
        entityId: ctx.orgId,
        before,
        after: { logoFileId: file.id },
      });
      return this.load(tx);
    });
  }

  /** DELETE /organization/logo */
  async removeLogo(): Promise<OrganizationSettings> {
    const ctx = this.context();
    let removed: string[] = [];
    const settings = await this.prisma.withContext(ctx, async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({
        where: { id: ctx.orgId },
        select: { logoFileId: true },
      });
      if (before.logoFileId) {
        await tx.organization.update({ where: { id: ctx.orgId }, data: { logoFileId: null } });
        removed = await this.files.deleteRows(tx, [before.logoFileId]);
        await this.audit.record(tx, {
          action: 'org.logo.remove',
          entityType: 'organizations',
          entityId: ctx.orgId,
          before,
          after: { logoFileId: null },
        });
      }
      return this.load(tx);
    });
    await this.files.removeFromDisk(removed);
    return settings;
  }

  /** GET /audit (SYS-01): the organization's audit log with filters. */
  auditLog(query: OrgAuditQuery): Promise<AuditPage> {
    const ctx = this.context();
    return this.prisma.withContext(ctx, (tx) =>
      this.auditQuery.list(tx, { ...query, organizationId: ctx.orgId }),
    );
  }

  private async load(tx: Tx): Promise<OrganizationSettings> {
    const ctx = this.context();
    const org = await tx.organization.findFirst({
      where: { id: ctx.orgId, deletedAt: null },
      select: settingsSelect,
    });
    if (!org) throw new AppError('NOT_FOUND');
    const [confirmed, moderators, events] = await Promise.all([
      tx.auditLog.count({ where: { organizationId: org.id, action: TIME_ZONE_CONFIRMED } }),
      tx.userRole.count({
        where: { role: { systemKey: 'moderator' }, user: { deletedAt: null } },
      }),
      tx.votingEvent.count({ where: { deletedAt: null } }),
    ]);
    const done: Record<OnboardingItem, boolean> = {
      timeZone: confirmed > 0,
      branding: org.primaryColor !== null && org.logoFileId !== null,
      smsSender: org.smsSenderId !== null,
      moderator: moderators > 0,
      firstEvent: events > 0,
    };
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      primaryColor: org.primaryColor,
      timeZone: org.timeZone,
      contactEmail: org.contactEmail,
      contactPhone: org.contactPhone,
      smsSenderId: org.smsSenderId,
      helpPhone: org.helpPhone,
      sessionTimeoutMinutes: org.sessionTimeoutMinutes,
      archiveAfterDays: org.archiveAfterDays,
      logoUrl: org.logoFileId ? fileUrl(org.logoFileId) : null,
      onboarding: {
        dismissed: org.onboardingDismissedAt !== null,
        items: onboardingItems.map((key) => ({ key, done: done[key] })),
      },
    };
  }

  /** Platform administrators have no organization of their own. */
  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
