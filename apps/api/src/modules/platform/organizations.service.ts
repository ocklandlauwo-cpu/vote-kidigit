import { Injectable, Logger } from '@nestjs/common';
import type {
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  OrganizationDetail,
  OrganizationListQuery,
  OrganizationPage,
  OrganizationSummary,
  PlatformDashboard,
  ReactivateOrganizationRequest,
  SuspendOrganizationRequest,
  UpdateOrganizationRequest,
} from '@vote-kidigit/shared';
import { AuditQueryService } from '../../audit/audit-query.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuthStateService } from '../../auth/auth-state.service.js';
import { TokensService } from '../../auth/tokens.service.js';
import { AppError } from '../../common/app-error.js';
import { errorReason } from '../../common/connection-errors.js';
import { RequestContextService } from '../../context/request-context.js';
import {
  type DbContext,
  enterOrganization,
  PrismaService,
  type Tx,
} from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

const summarySelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  createdAt: true,
  users: {
    where: { deletedAt: null },
    select: { id: true, fullName: true, email: true, status: true, isOrgSuperAdmin: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.OrganizationSelect;

type SummaryRow = Prisma.OrganizationGetPayload<{ select: typeof summarySelect }>;

const ORG_COLUMNS = [
  'name',
  'timeZone',
  'contactEmail',
  'contactPhone',
  'smsSenderId',
  'helpPhone',
  'sessionTimeoutMinutes',
] as const;

/** Lowercase letters, digits and hyphens (Backend Schema 4.1). */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'organization';
}

/**
 * Organizations as the Platform Super Admin manages them (Backend Schema 8.6, 12.3). Lists run
 * with app.org_id = '' (every organization); acting on one organization sets app.org_id to it.
 * Platform admins see organization data read-only, except organization details and status.
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auditQuery: AuditQueryService,
    private readonly authState: AuthStateService,
    private readonly tokens: TokensService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /platform/organizations (PLT-01). */
  async list(query: OrganizationListQuery): Promise<OrganizationPage> {
    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      ...(query.status && { status: query.status }),
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { slug: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };
    const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
    const orderBy: Prisma.OrganizationOrderByWithRelationInput = query.sort.endsWith('name')
      ? { name: direction }
      : { createdAt: direction };
    return this.prisma.withContext(this.context(null), async (tx) => {
      const [rows, total] = await Promise.all([
        tx.organization.findMany({
          where,
          orderBy: [orderBy, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: summarySelect,
        }),
        tx.organization.count({ where }),
      ]);
      return {
        items: rows.map((row) => this.toSummary(row)),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /** GET /platform/organizations/:orgId (PLT-03). */
  detail(orgId: string): Promise<OrganizationDetail> {
    return this.prisma.withContext(this.context(orgId), (tx) => this.loadDetail(tx, orgId));
  }

  /**
   * POST /platform/organizations (PLT-02): the organization, its default roles and its first
   * Org Super Admin (status 'invited') in one transaction, then the invitation email is queued.
   * If queuing fails the organization stays and the response says so ("Resend").
   */
  async create(body: CreateOrganizationRequest): Promise<CreateOrganizationResponse> {
    const { organizationId, superAdminId } = await this.prisma.withContext(
      this.context(null),
      async (tx) => {
        const [taken] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM app.find_user_for_login(${body.superAdmin.email})`;
        if (taken) {
          throw new AppError('VALIDATION_FAILED', 'This email already has an account.', {
            source: 'body',
            issues: [
              { path: 'superAdmin.email', code: 'taken', message: 'already has an account' },
            ],
          });
        }
        const settings = await tx.platformSetting.findUnique({
          where: { id: 1 },
          select: { defaultSessionTimeoutMinutes: true },
        });
        const org = await tx.organization.create({
          data: {
            name: body.name,
            slug: await this.freeSlug(tx, slugify(body.name)),
            timeZone: body.timeZone,
            contactEmail: body.contactEmail ?? null,
            contactPhone: body.contactPhone ?? null,
            smsSenderId: body.smsSenderId ?? null,
            sessionTimeoutMinutes: settings?.defaultSessionTimeoutMinutes ?? 15,
          },
          select: { id: true, name: true, slug: true, timeZone: true },
        });
        await tx.$executeRaw`SELECT app.create_default_roles(${org.id}::uuid)`;

        // The organization's own rows (users, user_roles) are written inside it.
        await enterOrganization(tx, org.id);
        const role = await tx.role.findFirstOrThrow({
          where: { organizationId: org.id, systemKey: 'org_super_admin' },
          select: { id: true },
        });
        const user = await tx.user.create({
          data: {
            organizationId: org.id,
            email: body.superAdmin.email,
            fullName: body.superAdmin.fullName,
            status: 'invited',
            isOrgSuperAdmin: true,
          },
          select: { id: true },
        });
        await tx.userRole.create({
          data: { userId: user.id, roleId: role.id, organizationId: org.id },
        });
        await this.audit.record(tx, {
          action: 'platform.org.create',
          entityType: 'organizations',
          entityId: org.id,
          organizationId: org.id,
          after: {
            ...org,
            superAdmin: { email: body.superAdmin.email, fullName: body.superAdmin.fullName },
          },
        });
        return { organizationId: org.id, superAdminId: user.id };
      },
    );

    const invitationSent = await this.queueInvitation(superAdminId, organizationId);
    return { organization: await this.detail(organizationId), invitationSent };
  }

  /** PATCH /platform/organizations/:orgId (PLT-03 Settings tab). */
  async update(orgId: string, body: UpdateOrganizationRequest): Promise<OrganizationDetail> {
    const select = Object.fromEntries(ORG_COLUMNS.map((c) => [c, true])) as Record<
      (typeof ORG_COLUMNS)[number],
      true
    >;
    const detail = await this.prisma.withContext(this.context(orgId), async (tx) => {
      const before = await tx.organization.findFirst({
        where: { id: orgId, deletedAt: null },
        select,
      });
      if (!before) throw new AppError('NOT_FOUND');
      const after = await tx.organization.update({ where: { id: orgId }, data: body, select });
      await this.audit.record(tx, {
        action: 'platform.org.update',
        entityType: 'organizations',
        entityId: orgId,
        organizationId: orgId,
        before,
        after,
      });
      return this.loadDetail(tx, orgId);
    });
    // Name, time zone and session timeout are part of every signed-in user's state.
    await this.authState.invalidateOrg(orgId);
    return detail;
  }

  /**
   * POST /platform/organizations/:orgId/suspend: the organization's staff are signed out at
   * their next request and cannot sign in until it is reactivated.
   */
  suspend(orgId: string, body: SuspendOrganizationRequest): Promise<OrganizationDetail> {
    return this.setStatus(orgId, 'suspended', body.reason);
  }

  /** POST /platform/organizations/:orgId/reactivate */
  reactivate(orgId: string, body: ReactivateOrganizationRequest): Promise<OrganizationDetail> {
    return this.setStatus(orgId, 'active', body.reason ?? null);
  }

  /** POST /platform/organizations/:orgId/resend-invite: Org Super Admins not yet signed in. */
  async resendInvite(orgId: string): Promise<{ invitationSent: boolean }> {
    const invited = await this.prisma.withContext(this.context(orgId), async (tx) => {
      const org = await tx.organization.findFirst({
        where: { id: orgId, deletedAt: null },
        select: { status: true },
      });
      if (!org) throw new AppError('NOT_FOUND');
      if (org.status !== 'active') throw new AppError('ORG_SUSPENDED');
      const users = await tx.user.findMany({
        where: { organizationId: orgId, isOrgSuperAdmin: true, status: 'invited', deletedAt: null },
        select: { id: true },
      });
      if (users.length === 0) {
        throw new AppError('INVALID_TRANSITION', 'The Org Super Admin has already joined.');
      }
      for (const user of users) {
        await this.audit.record(tx, {
          action: 'platform.org.resend_invite',
          entityType: 'users',
          entityId: user.id,
          organizationId: orgId,
        });
      }
      return users;
    });
    let sent = true;
    for (const user of invited) sent = (await this.queueInvitation(user.id, orgId)) && sent;
    return { invitationSent: sent };
  }

  /** GET /platform/dashboard (DSH-01 cards available so far). */
  dashboard(): Promise<PlatformDashboard> {
    return this.prisma.withContext(this.context(null), async (tx) => {
      const [byStatus, staff, recentActivity] = await Promise.all([
        tx.organization.groupBy({
          by: ['status'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        tx.user.groupBy({
          by: ['status'],
          where: { deletedAt: null, organizationId: { not: null } },
          _count: { _all: true },
        }),
        this.auditQuery.recent(tx, 10),
      ]);
      const orgCount = (status: string) =>
        byStatus.find((row) => row.status === status)?._count._all ?? 0;
      const staffCount = (status: string) =>
        staff.find((row) => row.status === status)?._count._all ?? 0;
      return {
        organizations: {
          total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
          active: orgCount('active'),
          suspended: orgCount('suspended'),
        },
        staffUsers: { active: staffCount('active'), invited: staffCount('invited') },
        recentActivity,
      };
    });
  }

  private async setStatus(
    orgId: string,
    status: 'active' | 'suspended',
    reason: string | null,
  ): Promise<OrganizationDetail> {
    const detail = await this.prisma.withContext(this.context(orgId), async (tx) => {
      // Backend Schema 12.3: suspension is blocked while an event is Open.
      if (status === 'suspended') {
        const open = await tx.votingEvent.count({
          where: { organizationId: orgId, status: 'open', deletedAt: null },
        });
        if (open > 0) {
          throw new AppError('INVALID_TRANSITION', 'An event of this organization is open.', {
            reason: 'EVENT_OPEN',
          });
        }
      }
      // Conditional, so two concurrent requests cannot both change it.
      const changed = await tx.organization.updateMany({
        where: { id: orgId, deletedAt: null, status: status === 'active' ? 'suspended' : 'active' },
        data: { status },
      });
      if (changed.count === 0) {
        const exists = await tx.organization.count({ where: { id: orgId, deletedAt: null } });
        throw new AppError(exists ? 'INVALID_TRANSITION' : 'NOT_FOUND');
      }
      await this.audit.record(tx, {
        action: status === 'suspended' ? 'platform.org.suspend' : 'platform.org.reactivate',
        entityType: 'organizations',
        entityId: orgId,
        organizationId: orgId,
        before: { status: status === 'active' ? 'suspended' : 'active' },
        after: { status },
        reason,
      });
      return this.loadDetail(tx, orgId);
    });
    // Signed-in staff are re-checked at once instead of within 30 s; AuthGuard then ends their
    // sessions.
    await this.authState.invalidateOrg(orgId);
    return detail;
  }

  private async loadDetail(tx: Tx, orgId: string): Promise<OrganizationDetail> {
    const org = await tx.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: {
        ...summarySelect,
        timeZone: true,
        contactEmail: true,
        contactPhone: true,
        smsSenderId: true,
        helpPhone: true,
        sessionTimeoutMinutes: true,
        users: {
          where: { deletedAt: null },
          orderBy: [{ isOrgSuperAdmin: 'desc' }, { fullName: 'asc' }],
          select: {
            id: true,
            fullName: true,
            email: true,
            status: true,
            isOrgSuperAdmin: true,
            lastLoginAt: true,
            userRoles: { select: { role: { select: { name: true } } } },
          },
        },
      },
    });
    if (!org) throw new AppError('NOT_FOUND');
    return {
      ...this.toSummary(org),
      timeZone: org.timeZone,
      contactEmail: org.contactEmail,
      contactPhone: org.contactPhone,
      smsSenderId: org.smsSenderId,
      helpPhone: org.helpPhone,
      sessionTimeoutMinutes: org.sessionTimeoutMinutes,
      staff: org.users.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        status: user.status,
        isOrgSuperAdmin: user.isOrgSuperAdmin,
        roleName: user.userRoles[0]?.role.name ?? null,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      })),
    };
  }

  private toSummary(row: SummaryRow): OrganizationSummary {
    const superAdmin = row.users.find((user) => user.isOrgSuperAdmin);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      superAdmin: superAdmin
        ? {
            id: superAdmin.id,
            fullName: superAdmin.fullName,
            email: superAdmin.email,
            status: superAdmin.status,
          }
        : null,
      staffCount: row.users.length,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** `base`, or `base-2`, `base-3`… when taken by another organization. */
  private async freeSlug(tx: Tx, base: string): Promise<string> {
    const taken = new Set(
      (
        await tx.organization.findMany({
          where: { deletedAt: null, slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((o) => o.slug),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; ; n += 1) {
      if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
    }
  }

  private async queueInvitation(userId: string, orgId: string): Promise<boolean> {
    try {
      await this.tokens.sendInvitation(userId, orgId);
      return true;
    } catch (error: unknown) {
      this.logger.error({ msg: 'invitation not queued', userId, reason: errorReason(error) });
      return false;
    }
  }

  /** Platform context: every organization (null) or one of them. */
  private context(orgId: string | null): DbContext {
    const { userId, requestId } = this.requestContext.getOrThrow();
    return { orgId, userId, isPlatformAdmin: true, requestId };
  }
}
