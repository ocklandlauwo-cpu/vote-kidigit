import { Injectable } from '@nestjs/common';
import type { AuditEntry, AuditPage, AuditQuery } from '@vote-kidigit/shared';
import type { Tx } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

export interface AuditFilter extends AuditQuery {
  /** undefined: every entry RLS shows; null: platform actions only. */
  organizationId?: string | null;
  eventId?: string;
}

/**
 * Reads the audit log for the audit screens (SYS-01, PLT-05, event activity), newest first.
 * RLS limits what a caller sees; the filter narrows it further.
 */
@Injectable()
export class AuditQueryService {
  async list(tx: Tx, filter: AuditFilter): Promise<AuditPage> {
    const where: Prisma.AuditLogWhereInput = {
      ...(filter.organizationId !== undefined && { organizationId: filter.organizationId }),
      ...(filter.eventId && { eventId: filter.eventId }),
      ...(filter.actorUserId && { actorUserId: filter.actorUserId }),
      ...(filter.action && { action: { startsWith: filter.action } }),
      ...((filter.from || filter.to) && {
        createdAt: {
          ...(filter.from && { gte: new Date(filter.from) }),
          ...(filter.to && { lt: new Date(filter.to) }),
        },
      }),
    };
    const [rows, total] = await Promise.all([
      tx.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      tx.auditLog.count({ where }),
    ]);
    return {
      items: await this.withOrganizationNames(tx, rows),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  /** The newest entries, for dashboard "Recent activity" cards. */
  async recent(tx: Tx, take = 10): Promise<AuditEntry[]> {
    const rows = await tx.auditLog.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
    return this.withOrganizationNames(tx, rows);
  }

  private async withOrganizationNames(
    tx: Tx,
    rows: Prisma.AuditLogGetPayload<object>[],
  ): Promise<AuditEntry[]> {
    const orgIds = [...new Set(rows.flatMap((r) => (r.organizationId ? [r.organizationId] : [])))];
    const orgs = orgIds.length
      ? await tx.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(orgs.map((o) => [o.id, o.name]));
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      organizationName: row.organizationId ? (names.get(row.organizationId) ?? null) : null,
      actorType: row.actorType,
      actorUserId: row.actorUserId,
      actorLabel: row.actorLabel,
      eventId: row.eventId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      before: row.before,
      after: row.after,
      reason: row.reason,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
