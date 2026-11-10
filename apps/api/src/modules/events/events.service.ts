import { Injectable } from '@nestjs/common';
import {
  type AuditPage,
  type ChecklistResponse,
  ChecklistItemSchema,
  type CreateEventRequest,
  type EventDetail,
  type EventListQuery,
  type EventPage,
  type EventSummary,
  type OrgAuditQuery,
  type UpdateEventRequest,
} from '@vote-kidigit/shared';
import { AuditQueryService } from '../../audit/audit-query.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuthStateService } from '../../auth/auth-state.service.js';
import type { AuthState } from '../../auth/auth.types.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

const summarySelect = {
  id: true,
  name: true,
  status: true,
  isActive: true,
  startAt: true,
  endAt: true,
  updatedAt: true,
  assignments: {
    where: { type: 'moderator' },
    select: { user: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
  },
  _count: {
    select: {
      categories: { where: { isActive: true } },
      voters: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.VotingEventSelect;

type SummaryRow = Prisma.VotingEventGetPayload<{ select: typeof summarySelect }>;

const toSummary = (row: SummaryRow): EventSummary => ({
  id: row.id,
  name: row.name,
  status: row.status,
  isActive: row.isActive,
  startAt: row.startAt.toISOString(),
  endAt: row.endAt.toISOString(),
  activeCategories: row._count.categories,
  voters: row._count.voters,
  moderators: row.assignments.map((a) => a.user.fullName),
  updatedAt: row.updatedAt.toISOString(),
});

const iso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * EVT-01 default order (App Flow 6.1): Open first, then Scheduled by start time, then the rest
 * by last update.
 */
export function byEventListOrder(a: EventSummary, b: EventSummary): number {
  const rank = (s: EventSummary) => (s.status === 'open' ? 0 : s.status === 'scheduled' ? 1 : 2);
  return (
    rank(a) - rank(b) ||
    (rank(a) === 1 ? Date.parse(a.startAt) - Date.parse(b.startAt) : 0) ||
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  );
}

/**
 * Events of the caller's organization (Backend Schema 12.5). Users without event.access_all
 * work only with the events they are assigned to, and never see deactivated ones. Status
 * changes go through app.transition_event (publish and cancel: step 20).
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auditQuery: AuditQueryService,
    private readonly authState: AuthStateService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /events */
  list(actor: AuthState, query: EventListQuery): Promise<EventPage> {
    const allEvents = actor.permissions.includes('event.access_all');
    const where: Prisma.VotingEventWhereInput = {
      deletedAt: null,
      ...(query.status && { status: query.status }),
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' } }),
      ...(!(allEvents && query.includeInactive) && { isActive: true }),
      ...(!allEvents && { assignments: { some: { userId: actor.userId } } }),
    };
    return this.prisma.withContext(this.context(), async (tx) => {
      // An organization has tens of events, not thousands: sorted here by the EVT-01 rules.
      const rows = await tx.votingEvent.findMany({ where, select: summarySelect });
      const items = rows.map(toSummary).sort(byEventListOrder);
      const start = (query.page - 1) * query.pageSize;
      return {
        items: items.slice(start, start + query.pageSize),
        total: items.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /** POST /events: a Draft; a creator without event.access_all is assigned as moderator. */
  async create(actor: AuthState, body: CreateEventRequest): Promise<EventDetail> {
    const ctx = this.context();
    const detail = await this.prisma.withContext(ctx, async (tx) => {
      const event = await tx.votingEvent.create({
        data: {
          organizationId: ctx.orgId,
          name: body.name,
          startAt: new Date(body.startAt),
          endAt: new Date(body.endAt),
          createdBy: actor.userId,
        },
        select: { id: true },
      });
      if (!actor.permissions.includes('event.access_all')) {
        await tx.eventAssignment.create({
          data: {
            organizationId: ctx.orgId,
            eventId: event.id,
            userId: actor.userId,
            type: 'moderator',
            createdBy: actor.userId,
          },
        });
      }
      await this.audit.record(tx, {
        action: 'event.create',
        entityType: 'voting_events',
        entityId: event.id,
        eventId: event.id,
        after: { name: body.name, startAt: body.startAt, endAt: body.endAt },
      });
      return this.loadDetail(tx, event.id);
    });
    await this.authState.invalidateUser(actor.userId);
    return detail;
  }

  /** GET /events/:eventId */
  detail(eventId: string): Promise<EventDetail> {
    return this.prisma.withContext(this.context(), (tx) => this.loadDetail(tx, eventId));
  }

  /** PATCH /events/:eventId: the database decides what may change in the event's status. */
  update(eventId: string, body: UpdateEventRequest): Promise<EventDetail> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const select = {
        name: true,
        startAt: true,
        endAt: true,
        showParty: true,
        resultsVisibility: true,
        reminderBeforeOpenHours: true,
        reminderBeforeCloseMinutes: true,
      } as const;
      const before = await tx.votingEvent.findFirst({
        where: { id: eventId, deletedAt: null },
        select,
      });
      if (!before) throw new AppError('NOT_FOUND');
      const after = await tx.votingEvent.update({
        where: { id: eventId },
        data: {
          ...body,
          ...(body.startAt !== undefined && { startAt: new Date(body.startAt) }),
          ...(body.endAt !== undefined && { endAt: new Date(body.endAt) }),
        },
        select,
      });
      await this.audit.record(tx, {
        action: 'event.update',
        entityType: 'voting_events',
        entityId: eventId,
        eventId,
        before,
        after,
      });
      return this.loadDetail(tx, eventId);
    });
  }

  /** DELETE /events/:eventId: soft delete, Draft or Cancelled only (database). */
  async remove(eventId: string): Promise<void> {
    await this.prisma.withContext(this.context(), async (tx) => {
      const event = await tx.votingEvent.findFirst({
        where: { id: eventId, deletedAt: null },
        select: { name: true, status: true },
      });
      if (!event) throw new AppError('NOT_FOUND');
      if (event.status !== 'draft' && event.status !== 'cancelled') {
        throw new AppError('EVENT_LOCKED', 'Only Draft and Cancelled events can be deleted.');
      }
      await tx.votingEvent.update({ where: { id: eventId }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'event.delete',
        entityType: 'voting_events',
        entityId: eventId,
        eventId,
        before: event,
      });
    });
  }

  /** GET /events/:eventId/checklist (App Flow 6.3). */
  checklist(eventId: string): Promise<ChecklistResponse> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await this.assertExists(tx, eventId);
      const rows = await tx.$queryRaw<unknown[]>`
        SELECT item, ok, detail FROM app.publish_checklist(${eventId}::uuid)`;
      return { items: rows.map((row) => ChecklistItemSchema.parse(row)) };
    });
  }

  /** POST /events/:eventId/activate and /deactivate (PRD 4.3 rule 3). */
  setActive(eventId: string, isActive: boolean): Promise<EventDetail> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await tx.votingEvent.findFirst({
        where: { id: eventId, deletedAt: null },
        select: { status: true, isActive: true },
      });
      if (!event) throw new AppError('NOT_FOUND');
      if (event.isActive === isActive) throw new AppError('INVALID_TRANSITION');
      if (!isActive && event.status === 'open') {
        throw new AppError('INVALID_TRANSITION', 'An open event cannot be deactivated.', {
          reason: 'EVENT_OPEN',
        });
      }
      await tx.votingEvent.update({ where: { id: eventId }, data: { isActive } });
      await this.audit.record(tx, {
        action: isActive ? 'event.activate' : 'event.deactivate',
        entityType: 'voting_events',
        entityId: eventId,
        eventId,
        before: { isActive: !isActive },
        after: { isActive },
      });
      return this.loadDetail(tx, eventId);
    });
  }

  /** GET /events/:eventId/audit: the Activity tab. */
  auditLog(eventId: string, query: OrgAuditQuery): Promise<AuditPage> {
    const ctx = this.context();
    return this.prisma.withContext(ctx, async (tx) => {
      await this.assertExists(tx, eventId);
      return this.auditQuery.list(tx, { ...query, eventId, organizationId: ctx.orgId });
    });
  }

  private async assertExists(tx: Tx, eventId: string): Promise<void> {
    const found = await tx.votingEvent.count({ where: { id: eventId, deletedAt: null } });
    if (!found) throw new AppError('NOT_FOUND');
  }

  /** The event detail inside an existing transaction (used by LifecycleService too). */
  detailIn(tx: Tx, eventId: string): Promise<EventDetail> {
    return this.loadDetail(tx, eventId);
  }

  private async loadDetail(tx: Tx, eventId: string): Promise<EventDetail> {
    const row = await tx.votingEvent.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        ...summarySelect,
        showParty: true,
        resultsVisibility: true,
        reminderBeforeOpenHours: true,
        reminderBeforeCloseMinutes: true,
        firstCodeSentAt: true,
        openedAt: true,
        closedAt: true,
        cancelledAt: true,
        cancelReason: true,
        archivedAt: true,
        createdAt: true,
      },
    });
    if (!row) throw new AppError('NOT_FOUND');
    const [categories, contesters, codes, cancel] = await Promise.all([
      tx.category.count({ where: { eventId } }),
      tx.contester.count({ where: { eventId, status: 'active' } }),
      tx.voter.groupBy({
        by: ['codeStatus'],
        where: { eventId, deletedAt: null },
        _count: { _all: true },
      }),
      row.cancelledAt
        ? tx.auditLog.findFirst({
            where: { eventId, action: 'event.cancel' },
            orderBy: { createdAt: 'desc' },
            select: { actorLabel: true },
          })
        : null,
    ]);
    const codeCount = (status: string) =>
      codes.find((c) => c.codeStatus === status)?._count._all ?? 0;
    return {
      ...toSummary(row),
      showParty: row.showParty,
      resultsVisibility: row.resultsVisibility,
      reminderBeforeOpenHours: row.reminderBeforeOpenHours,
      reminderBeforeCloseMinutes: row.reminderBeforeCloseMinutes,
      firstCodeSentAt: iso(row.firstCodeSentAt),
      openedAt: iso(row.openedAt),
      closedAt: iso(row.closedAt),
      cancelledAt: iso(row.cancelledAt),
      cancelReason: row.cancelReason,
      cancelledBy: cancel?.actorLabel ?? null,
      archivedAt: iso(row.archivedAt),
      categories,
      contesters,
      codeCounts: {
        notSent: codeCount('not_sent'),
        sent: codeCount('sent'),
        delivered: codeCount('delivered'),
        failed: codeCount('failed'),
      },
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Platform administrators have no organization and no events of their own. */
  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
