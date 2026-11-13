// Dashboard cards (App Flow 5.2, Backend Schema 12.4). Every card works in one of three scopes:
// the platform (every organization, DSH-01), the organization (users with event.access_all,
// DSH-02), or the events the user is mapped to (DSH-03, DSH-04). Deactivated and deleted events
// never count. Turnout and voter numbers come from app.event_counts(): numbers only, never
// voters, so the platform dashboard can show them too.
import { Injectable } from '@nestjs/common';
import type {
  AuditEntry,
  DashboardEvents,
  DashboardEventStaff,
  DashboardMyEvents,
  DashboardOrganizations,
  DashboardTies,
  DashboardTurnout,
} from '@vote-kidigit/shared';
import { AuditQueryService } from '../../audit/audit-query.service.js';
import type { AuthState } from '../../auth/auth.types.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

type Scope = { kind: 'platform' } | { kind: 'organization' } | { kind: 'mapped'; userId: string };

const RECENT = 10;

function scopeOf(auth: AuthState): Scope {
  if (auth.isPlatformAdmin) return { kind: 'platform' };
  if (auth.permissions.includes('event.access_all')) return { kind: 'organization' };
  return { kind: 'mapped', userId: auth.userId };
}

/** Events a card may count in this scope. RLS adds the organization (or all, for the platform). */
function eventWhere(scope: Scope): Prisma.VotingEventWhereInput {
  return {
    deletedAt: null,
    isActive: true,
    ...(scope.kind === 'mapped' && { assignments: { some: { userId: scope.userId } } }),
  };
}

/** A card the user's permissions do not cover: the same refusal as a route (403). */
function needs(auth: AuthState, permission: string): void {
  if (!auth.isPlatformAdmin && !auth.permissions.includes(permission)) {
    throw new AppError('FORBIDDEN');
  }
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditQuery: AuditQueryService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /dashboard/events */
  events(auth: AuthState): Promise<DashboardEvents> {
    return this.read(async (tx) => {
      const scope = scopeOf(auth);
      const where = eventWhere(scope);
      const [groups, next] = await Promise.all([
        tx.votingEvent.groupBy({ by: ['status'], where, _count: { _all: true } }),
        tx.votingEvent.findFirst({
          where: { ...where, status: 'scheduled', startAt: { gt: new Date() } },
          orderBy: { startAt: 'asc' },
          select: { id: true, name: true, startAt: true, organization: { select: { name: true } } },
        }),
      ]);
      const n = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
      return {
        byStatus: {
          draft: n('draft'),
          scheduled: n('scheduled'),
          open: n('open'),
          closed: n('closed'),
          results_published: n('results_published'),
        },
        nextToOpen: next
          ? {
              eventId: next.id,
              eventName: next.name,
              organizationName: scope.kind === 'platform' ? next.organization.name : null,
              startAt: next.startAt.toISOString(),
            }
          : null,
      };
    });
  }

  /** GET /dashboard/turnout: Open events, voted of registered. */
  turnout(auth: AuthState): Promise<DashboardTurnout> {
    needs(auth, 'turnout.view');
    return this.read(async (tx) => {
      const scope = scopeOf(auth);
      const open = await tx.votingEvent.findMany({
        where: { ...eventWhere(scope), status: 'open' },
        orderBy: { endAt: 'asc' },
        select: { id: true, name: true, organization: { select: { name: true } } },
      });
      const counts = await this.counts(
        tx,
        open.map((e) => e.id),
      );
      return open.map((event) => ({
        eventId: event.id,
        eventName: event.name,
        organizationName: scope.kind === 'platform' ? event.organization.name : null,
        registered: counts.get(event.id)?.registered ?? 0,
        voted: counts.get(event.id)?.voted ?? 0,
      }));
    });
  }

  /** GET /dashboard/ties: tied categories of the current snapshot without a resolution. */
  ties(auth: AuthState): Promise<DashboardTies> {
    needs(auth, 'results.view');
    return this.read(async (tx) => {
      const scope = scopeOf(auth);
      const stats = await tx.resultCategoryStat.findMany({
        where: {
          hasTie: true,
          snapshot: { isCurrent: true, publishedAt: null, event: eventWhere(scope) },
        },
        select: {
          snapshotId: true,
          categoryId: true,
          category: { select: { name: true, displayOrder: true } },
          snapshot: {
            select: {
              ties: { select: { categoryId: true } },
              event: { select: { id: true, name: true, organization: { select: { name: true } } } },
            },
          },
        },
      });
      return stats
        .filter((s) => !s.snapshot.ties.some((t) => t.categoryId === s.categoryId))
        .sort(
          (a, b) =>
            a.snapshot.event.name.localeCompare(b.snapshot.event.name) ||
            a.category.displayOrder - b.category.displayOrder,
        )
        .map((s) => ({
          eventId: s.snapshot.event.id,
          eventName: s.snapshot.event.name,
          organizationName: scope.kind === 'platform' ? s.snapshot.event.organization.name : null,
          categoryId: s.categoryId,
          categoryName: s.category.name,
        }));
    });
  }

  /** GET /dashboard/activity: the last 10 entries of the platform, organization or mapped events. */
  activity(auth: AuthState): Promise<AuditEntry[]> {
    const scope = scopeOf(auth);
    if (scope.kind === 'platform') needs(auth, 'platform.audit.view');
    else needs(auth, scope.kind === 'organization' ? 'audit.view.org' : 'audit.view.event');
    return this.read(async (tx) => {
      if (scope.kind !== 'mapped') return this.auditQuery.recent(tx, RECENT);
      const mapped = await tx.votingEvent.findMany({
        where: eventWhere(scope),
        select: { id: true },
      });
      return this.auditQuery.recentForEvents(
        tx,
        mapped.map((e) => e.id),
        RECENT,
      );
    });
  }

  /** GET /dashboard/event-staff (DSH-02): moderators and categories per event. */
  eventStaff(auth: AuthState): Promise<DashboardEventStaff> {
    if (scopeOf(auth).kind !== 'organization') throw new AppError('FORBIDDEN');
    return this.read((tx) => this.eventRows(tx, eventWhere({ kind: 'organization' })));
  }

  /** GET /dashboard/my-events (DSH-03, DSH-04): mapped events with the user's role in each. */
  myEvents(auth: AuthState): Promise<DashboardMyEvents> {
    if (auth.isPlatformAdmin) throw new AppError('FORBIDDEN');
    return this.read(async (tx) => {
      const rows = await tx.eventAssignment.findMany({
        where: { userId: auth.userId, event: { deletedAt: null, isActive: true } },
        select: {
          type: true,
          event: { select: { id: true, name: true, status: true, startAt: true, endAt: true } },
        },
        orderBy: { event: { startAt: 'desc' } },
      });
      return rows.map(({ type, event }) => ({
        eventId: event.id,
        eventName: event.name,
        status: event.status,
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
        role: type,
      }));
    });
  }

  /** GET /dashboard/organizations (DSH-01): every organization with its events inside. */
  organizations(auth: AuthState): Promise<DashboardOrganizations> {
    if (!auth.isPlatformAdmin) throw new AppError('FORBIDDEN');
    return this.read(async (tx) => {
      const [orgs, rows, lastActivity] = await Promise.all([
        tx.organization.findMany({
          where: { deletedAt: null },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, status: true },
        }),
        this.eventRows(tx, eventWhere({ kind: 'platform' }), true),
        tx.auditLog.groupBy({
          by: ['organizationId'],
          where: { organizationId: { not: null } },
          _max: { createdAt: true },
        }),
      ]);
      const counts = await this.counts(
        tx,
        rows.map((r) => r.eventId),
      );
      return orgs.map((org) => {
        const own = rows.filter((r) => r.organizationId === org.id);
        const moderators = new Set(own.flatMap((r) => r.moderatorIds));
        const last = lastActivity.find((a) => a.organizationId === org.id)?._max.createdAt;
        return {
          id: org.id,
          name: org.name,
          status: org.status,
          events: own.length,
          moderators: moderators.size,
          categories: own.reduce((sum, r) => sum + r.categories, 0),
          voters: own.reduce((sum, r) => sum + (counts.get(r.eventId)?.registered ?? 0), 0),
          lastActivityAt: last?.toISOString() ?? null,
          eventRows: own.map((r) => ({
            eventId: r.eventId,
            eventName: r.eventName,
            status: r.status,
            moderators: r.moderators,
            categories: r.categories,
          })),
        };
      });
    });
  }

  // -------------------------------------------------------------------------------------------

  private async eventRows(
    tx: Tx,
    where: Prisma.VotingEventWhereInput,
  ): Promise<DashboardEventStaff>;
  private async eventRows(
    tx: Tx,
    where: Prisma.VotingEventWhereInput,
    withIds: true,
  ): Promise<(DashboardEventStaff[number] & { organizationId: string; moderatorIds: string[] })[]>;
  private async eventRows(tx: Tx, where: Prisma.VotingEventWhereInput, withIds = false) {
    const events = await tx.votingEvent.findMany({
      where,
      orderBy: { startAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        organizationId: true,
        assignments: {
          where: { type: 'moderator' },
          select: { userId: true, user: { select: { fullName: true } } },
          orderBy: { user: { fullName: 'asc' } },
        },
        _count: { select: { categories: { where: { isActive: true } } } },
      },
    });
    return events.map((event) => ({
      eventId: event.id,
      eventName: event.name,
      status: event.status,
      moderators: event.assignments.map((a) => a.user.fullName),
      categories: event._count.categories,
      ...(withIds && {
        organizationId: event.organizationId,
        moderatorIds: event.assignments.map((a) => a.userId),
      }),
    }));
  }

  private async counts(
    tx: Tx,
    eventIds: string[],
  ): Promise<Map<string, { registered: number; voted: number }>> {
    if (eventIds.length === 0) return new Map();
    const rows = await tx.$queryRaw<{ event_id: string; registered: bigint; voted: bigint }[]>`
      SELECT event_id, registered, voted FROM app.event_counts(${eventIds}::uuid[])`;
    return new Map(
      rows.map((r) => [r.event_id, { registered: Number(r.registered), voted: Number(r.voted) }]),
    );
  }

  private read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.withContext(this.requestContext.getOrThrow(), fn);
  }
}
